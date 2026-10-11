"""Trains the ASL letter classifier with TensorFlow/Keras, with hyperparameter tuning.

    .venv-tf/bin/python scripts/train_tf.py            # tune + evaluate + export (~1 h on 4 CPU cores)
    .venv-tf/bin/python scripts/train_tf.py --trials 6 # quicker search

Model: standardised 118-d landmark features -> Dense(ReLU) [+ Dropout] x k -> Dense(24, softmax),
trained with categorical cross-entropy (one-hot labels, optional label smoothing) and Adam,
early-stopped on a held-out 10% of training groups.

Tuning (random search over a fixed candidate list):
  * objective = mean accuracy on a dataset left out of training (leave-one-source-out). This is
    the closest proxy for "a new person in front of a new webcam".
  * the reported estimate is NESTED: for each held-out dataset, hyperparameters are chosen using
    only the other two datasets (train on one, validate on the other, both ways), then a model
    with those settings is trained on both and scored on the held-out one.
  * the production model uses the configuration with the best (non-nested) leave-one-source-out
    accuracy, trained on all data.

Outputs:
  checkpoints/                      Keras checkpoint (model + optimizer state, scaler, config)
  export/asl_mlp_weights.json       exported from the checkpoint, converted to ../web/public/models/asl_tfjs/
  ../web/test/fixtures/parity.json  checkpoint predictions the TF.js model must reproduce
  reports/                          evaluation.md, metrics.json
"""
import argparse
import json
import os
import time

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import keras  # noqa: E402
import numpy as np  # noqa: E402
import tensorflow as tf  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support  # noqa: E402
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

import train as base  # shared augmentation, export, templates, report helpers  # noqa: E402
from checkpoint import load_checkpoint, save_checkpoint  # noqa: E402
from features import FEATURE_DIM, features_batch, mirror  # noqa: E402

SEED = base.SEED
LETTERS = base.STATIC_LETTERS
ROOT = base.ROOT
AUG_COPIES = 4
MAX_EPOCHS = 120

SPACE = {
    "hidden": [(64,), (128,), (64, 32), (128, 64), (256, 128), (128, 128, 64)],
    "dropout": [0.0, 0.1, 0.25, 0.4],
    "l2": [0.0, 1e-5, 1e-4, 1e-3],
    "lr": [3e-4, 1e-3, 3e-3],
    "batch": [64, 128, 256],
    "label_smoothing": [0.0, 0.05, 0.1],
}


def sample_configs(n, seed=SEED):
    rng = np.random.default_rng(seed)
    out, seen = [], set()
    while len(out) < n:
        c = {k: v[rng.integers(len(v))] for k, v in SPACE.items()}
        key = json.dumps(c, sort_keys=True, default=list)
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


# ---------------------------------------------------------------- data prep
class Prepared:
    """Augmented + standardised training features for one training set (reused across configs)."""

    def __init__(self, X, y, g, seed=SEED):
        rng = np.random.default_rng(seed)
        # early-stopping split by group, before augmentation (no leakage between copies)
        tr, va = next(GroupShuffleSplit(1, test_size=0.1, random_state=seed).split(X, y, g))
        Xa, ya, _ = base.augment(X[tr], y[tr], g[tr], rng, copies=AUG_COPIES)
        Fa = features_batch(Xa)
        self.scaler = StandardScaler().fit(Fa)
        self.x_tr = self.scaler.transform(Fa).astype(np.float32)
        self.y_tr = onehot(ya)
        # validation: the untouched hand and its mirror (both orientations matter)
        Xv = np.concatenate([X[va], mirror(X[va])])
        self.x_va = self.scaler.transform(features_batch(Xv)).astype(np.float32)
        self.y_va = onehot(np.concatenate([y[va], y[va]]))


def onehot(y):
    idx = np.array([LETTERS.index(c) for c in y])
    return np.eye(len(LETTERS), dtype=np.float32)[idx]


# ---------------------------------------------------------------- model
def build(cfg):
    reg = keras.regularizers.l2(cfg["l2"]) if cfg["l2"] else None
    layers = [keras.Input((FEATURE_DIM,))]
    for i, units in enumerate(cfg["hidden"]):
        layers.append(keras.layers.Dense(units, activation="relu", kernel_regularizer=reg, name=f"dense_{i + 1}"))
        if cfg["dropout"]:
            layers.append(keras.layers.Dropout(cfg["dropout"]))
    layers.append(keras.layers.Dense(len(LETTERS), activation="softmax", name=f"dense_{len(cfg['hidden']) + 1}"))
    model = keras.Sequential(layers)
    model.compile(
        optimizer=keras.optimizers.Adam(cfg["lr"]),
        loss=keras.losses.CategoricalCrossentropy(label_smoothing=cfg["label_smoothing"]),
        metrics=["accuracy"],
    )
    return model


class Trained:
    def __init__(self, model, scaler, epochs):
        self.model, self.scaler, self.epochs = model, scaler, epochs

    def proba(self, X, tta=True):
        p = self.model.predict(self.scaler.transform(features_batch(X)), verbose=0, batch_size=2048)
        if tta:  # average with the mirror image, exactly like the browser
            p = (p + self.model.predict(self.scaler.transform(features_batch(mirror(X))), verbose=0, batch_size=2048)) / 2
        return p

    def predict(self, X):
        return np.array(LETTERS)[self.proba(X).argmax(1)]


def fit(cfg, prep, seed=SEED):
    keras.utils.set_random_seed(seed)
    model = build(cfg)
    stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=12, restore_best_weights=True)
    hist = model.fit(prep.x_tr, prep.y_tr, validation_data=(prep.x_va, prep.y_va), epochs=MAX_EPOCHS,
                     batch_size=cfg["batch"], callbacks=[stop], verbose=0, shuffle=True)
    best_epoch = int(np.argmin(hist.history["val_loss"])) + 1
    return Trained(model, prep.scaler, best_epoch)


# ---------------------------------------------------------------- tuning
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=16)
    args = ap.parse_args()
    t_start = time.time()
    tf.config.threading.set_inter_op_parallelism_threads(2)

    d = np.load(os.path.join(ROOT, "data", "landmarks.npz"))
    keep = np.isin(d["y"], LETTERS)
    X, y, src, g, fl = d["X"][keep], d["y"][keep], d["source"][keep], d["group"][keep], d["flipped"][keep]
    sources = list(np.unique(src))
    configs = sample_configs(args.trials)
    print(f"{len(y)} samples, sources {sources}, {len(configs)} configs", flush=True)

    cache = {}

    def prepared(mask, key):
        if key not in cache:
            cache[key] = Prepared(X[mask], y[mask], g[mask])
        return cache[key]

    # score[(train_sources, test_source)][config_index] = accuracy
    score = {}

    def run(train_srcs, test_src, ci):
        k = (tuple(train_srcs), test_src)
        score.setdefault(k, {})
        if ci not in score[k]:
            prep = prepared(np.isin(src, train_srcs), tuple(train_srcs))
            m = fit(configs[ci], prep)
            te = src == test_src
            score[k][ci] = float(accuracy_score(y[te], m.predict(X[te])))
        return score[k][ci]

    # 1) non-nested leave-one-source-out score of every config (used to pick production config)
    loso = []
    for ci, cfg in enumerate(configs):
        t0 = time.time()
        accs = {s: run([o for o in sources if o != s], s, ci) for s in sources}
        loso.append(accs)
        print(f"[{ci + 1:2d}/{len(configs)}] {cfg} -> " + " ".join(f"{s}:{a:.3f}" for s, a in accs.items())
              + f"  mean {np.mean(list(accs.values())):.3f} ({time.time() - t0:.0f}s)", flush=True)
    best_ci = int(np.argmax([np.mean(list(a.values())) for a in loso]))
    best = configs[best_ci]
    print("best config:", best, flush=True)

    # 2) nested estimate: choose the config for held-out s using only the other two sources
    nested = {}
    for s in sources:
        inner = [o for o in sources if o != s]
        inner_scores = [np.mean([run([a], b, ci) for a, b in [(inner[0], inner[1]), (inner[1], inner[0])]])
                        for ci in range(len(configs))]
        ci = int(np.argmax(inner_scores))
        nested[s] = {"config": configs[ci], "accuracy": run(inner, s, ci)}
        print(f"nested {s}: chose #{ci + 1}, accuracy {nested[s]['accuracy']:.3f}", flush=True)

    # 3) full evaluation of the chosen config (same protocols as train.py)
    metrics = evaluate(best, X, y, g, src, fl)
    metrics["tuning"] = {
        "objective": "mean leave-one-source-out accuracy",
        "space": {k: [list(v) if isinstance(v, tuple) else v for v in vals] for k, vals in SPACE.items()},
        "trials": [{"config": {**c, "hidden": list(c["hidden"])}, "loso": a, "mean": float(np.mean(list(a.values())))}
                   for c, a in zip(configs, loso)],
        "best": {**best, "hidden": list(best["hidden"])},
        "nested": {s: {"config": {**v["config"], "hidden": list(v["config"]["hidden"])}, "accuracy": v["accuracy"]}
                   for s, v in nested.items()},
        "nested_mean": float(np.mean([v["accuracy"] for v in nested.values()])),
    }

    # 4) production model on all data
    final = fit(best, Prepared(X, y, g))
    metrics["final_epochs"] = final.epochs
    # The checkpoint is the source of truth: the web model is exported from it.
    save_checkpoint(final.model, final.scaler, {
        "framework": metrics["framework"],
        "hyperparameters": metrics["tuning"]["best"],
        "epochs": final.epochs,
        "classes": LETTERS,
        "gameLetters": metrics["game_letters"],
        "featureSpec": "wrist-origin, mean-2D-distance scale, 63 coords + 55 key-point distances",
        "metrics": {"cv_accuracy": metrics["cv"]["accuracy"], "cv_macro_f1": metrics["cv"]["macro_f1"],
                    "unseen_dataset_accuracy_nested": metrics["tuning"]["nested_mean"]},
    })
    ck = load_checkpoint()
    base.convert_to_tfjs(ck.export())

    idx = np.random.default_rng(1).choice(len(X), 40, replace=False)
    with open(os.path.join(ROOT, "..", "web", "test", "fixtures", "parity.json"), "w") as fh:
        json.dump({"landmarks": X[idx].round(6).tolist(),
                   "features": features_batch(X[idx]).round(6).tolist(),
                   "proba": ck.predict_proba(X[idx], tta=False).round(6).tolist(),
                   "classes": LETTERS}, fh)
    base.export_templates(d, os.path.join(ROOT, "..", "web", "public", "models", "hand_poses.json"))

    metrics["train_seconds"] = round(time.time() - t_start)
    with open(os.path.join(ROOT, "reports", "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=1)
    write_report(metrics)
    print(f"done in {metrics['train_seconds'] / 60:.1f} min; game letters {''.join(metrics['game_letters'])}")


def evaluate(cfg, X, y, g, src, fl):
    m = {"framework": f"TensorFlow {tf.__version__} / Keras {keras.__version__}", "n_samples": int(len(y)),
         "n_flipped": int(fl.sum()), "per_source": {s: int((src == s).sum()) for s in np.unique(src)},
         "per_letter": {L: int((y == L).sum()) for L in LETTERS}}

    # grouped 5-fold CV
    pred, conf = np.empty(len(y), dtype=object), np.zeros(len(y))
    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    for tr, te in cv.split(X, y, g):
        t = fit(cfg, Prepared(X[tr], y[tr], g[tr]))
        p = t.proba(X[te])
        pred[te], conf[te] = np.array(LETTERS)[p.argmax(1)], p.max(1)
    pred = pred.astype(str)
    p_, r_, f_, n_ = precision_recall_fscore_support(y, pred, labels=LETTERS, zero_division=0)
    cm = confusion_matrix(y, pred, labels=LETTERS)
    conf_pairs = sorted(((int(cm[i, j]), LETTERS[i], LETTERS[j]) for i in range(24) for j in range(24)
                         if i != j and cm[i, j] > 0), reverse=True)[:12]
    m["models"] = {"keras_mlp_" + "_".join(map(str, cfg["hidden"])): {
        "cv_accuracy": float(accuracy_score(y, pred)), "cv_macro_f1": float(f1_score(y, pred, average="macro"))}}
    m["cv"] = {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(f1_score(y, pred, average="macro")),
               "per_letter": {L: {"precision": float(p_[i]), "recall": float(r_[i]), "f1": float(f_[i]), "n": int(n_[i])}
                              for i, L in enumerate(LETTERS)},
               "top_confusions": [{"true": a, "pred": b, "count": c} for c, a, b in conf_pairs],
               "thresholds": base.threshold_table(y, pred, conf), "confusion_matrix": cm.tolist()}

    # leave-one-source-out, with and without flipped-photo landmarks in training
    for key, use_flipped in [("source_holdout", True), ("source_holdout_no_flipped_training", False)]:
        res, pooled = {}, np.empty(len(y), dtype=object)
        for s in np.unique(src):
            tr, te = src != s, src == s
            if not use_flipped:
                tr = tr & ~fl
            pr = fit(cfg, Prepared(X[tr], y[tr], g[tr])).predict(X[te])
            pooled[te] = pr
            res[s] = {"n": int(te.sum()), "accuracy": float(accuracy_score(y[te], pr)),
                      "macro_f1": float(f1_score(y[te], pr, average="macro"))}
            if fl[te].any():
                ok = pr == y[te]
                res[s]["accuracy_original"] = float(ok[~fl[te]].mean())
                res[s]["accuracy_flipped"] = float(ok[fl[te]].mean())
        m[key] = res
        if use_flipped:
            _, _, lo_f, _ = precision_recall_fscore_support(y, pooled.astype(str), labels=LETTERS, zero_division=0)
            m["source_holdout_f1"] = {L: float(lo_f[i]) for i, L in enumerate(LETTERS)}
    m["game_letters"] = [L for L in LETTERS if m["source_holdout_f1"][L] >= base.RELIABLE_F1]
    return m


def write_report(m):
    base.write_report(m)  # standard tables (CV, unseen dataset, left/right, per letter, thresholds)
    t = m["tuning"]
    L = ["\n### Hyperparameter search (TensorFlow/Keras, categorical cross-entropy)\n",
         f"{m['framework']}. Random search over {len(t['trials'])} configurations; objective = mean accuracy "
         "on a dataset left out of training. Sorted best first.\n",
         "| # | hidden | dropout | L2 | lr | batch | label smoothing | " + " | ".join(t["trials"][0]["loso"]) + " | mean |",
         "|---|---|---|---|---|---|---|" + "---|" * (len(t["trials"][0]["loso"]) + 1)]
    for i, tr in enumerate(sorted(t["trials"], key=lambda r: -r["mean"])):
        c = tr["config"]
        L.append(f"| {i + 1} | {'-'.join(map(str, c['hidden']))} | {c['dropout']} | {c['l2']} | {c['lr']} | {c['batch']} | "
                 f"{c['label_smoothing']} | " + " | ".join(f"{v:.3f}" for v in tr["loso"].values()) + f" | **{tr['mean']:.3f}** |")
    L.append("\n**Nested estimate** (hyperparameters chosen without the test dataset): "
             + ", ".join(f"{s} {v['accuracy']:.3f}" for s, v in t["nested"].items())
             + f"; mean **{t['nested_mean']:.3f}**.")
    b = t["best"]
    L.append(f"\n**Production model:** hidden {'-'.join(map(str, b['hidden']))}, dropout {b['dropout']}, L2 {b['l2']}, "
             f"lr {b['lr']}, batch {b['batch']}, label smoothing {b['label_smoothing']}; "
             f"trained on all data for {m['final_epochs']} epochs (early-stopping optimum).")
    with open(os.path.join(ROOT, "reports", "evaluation.md"), "a") as fh:
        fh.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
