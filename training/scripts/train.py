"""Trains, evaluates and exports the static ASL letter classifier.

    python scripts/train.py            # evaluate, train, export and convert to TensorFlow.js
    python scripts/train.py --quick    # skip the model comparison

Writes:
    reports/evaluation.md              human-readable results (copied into training/README.md)
    reports/metrics.json               machine-readable results
    export/asl_mlp_weights.json        trained weights + scaler + metadata (converter input)
    ../web/public/models/asl_tfjs/     TensorFlow.js LayersModel used by the game
                                       (via web/scripts/convert-model.mjs, run automatically if node is on PATH)
    ../web/test/fixtures/parity.json   raw landmarks + expected outputs for the JS parity test
"""
import argparse
import json
import os
import shutil
import subprocess
import time

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from features import FEATURE_DIM, features_batch, mirror, normalise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
STATIC_LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # J and Z need motion -> excluded
SEED = 7
AUG_COPIES = 6
# Letters used in the game must reach this F1 when tested on a dataset held out of training.
RELIABLE_F1 = 0.85


def augment(X, y, groups, rng, copies=AUG_COPIES):
    """Geometric augmentation on raw landmarks: mirror, roll, yaw, aspect, depth scale, jitter."""
    out_X, out_y, out_g = [X, mirror(X)], [y, y], [groups, groups]
    for _ in range(copies):
        A = X - X[:, :1]
        n = len(A)
        roll = rng.uniform(-0.35, 0.35, n)  # +-20 deg in image plane
        yaw = rng.uniform(-0.3, 0.3, n)  # +-17 deg around vertical axis
        c, s = np.cos(roll), np.sin(roll)
        x, yy = A[..., 0] * c[:, None] - A[..., 1] * s[:, None], A[..., 0] * s[:, None] + A[..., 1] * c[:, None]
        z = A[..., 2] * rng.uniform(0.6, 1.4, n)[:, None]
        cy, sy = np.cos(yaw), np.sin(yaw)
        x, z = x * cy[:, None] + z * sy[:, None], -x * sy[:, None] + z * cy[:, None]
        x = x * rng.uniform(0.85, 1.15, n)[:, None]
        B = np.stack([x, yy, z], axis=-1)
        scale = np.linalg.norm(B[:, 9, :2], axis=1)[:, None, None]
        B = B + rng.normal(0, 0.02, B.shape) * scale
        flip = rng.random(n) < 0.5
        B[flip] = mirror(B[flip])
        out_X.append(B.astype(np.float32))
        out_y.append(y)
        out_g.append(groups)
    return np.concatenate(out_X), np.concatenate(out_y), np.concatenate(out_g)


def make_mlp():
    return make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(128, 64), activation="relu", alpha=1e-3, batch_size=256,
                      learning_rate_init=2e-3, max_iter=200, early_stopping=True, n_iter_no_change=12,
                      random_state=SEED),
    )


MODELS = {
    "mlp_128_64": make_mlp,
    "logistic_regression": lambda: make_pipeline(StandardScaler(), LogisticRegression(C=2.0, max_iter=3000)),
    "knn_5": lambda: make_pipeline(StandardScaler(), KNeighborsClassifier(5, weights="distance")),
    "random_forest": lambda: RandomForestClassifier(300, n_jobs=-1, random_state=SEED),
}


def predict_proba_tta(model, X):
    """Average predictions of the hand and its mirror image -> exactly mirror-invariant."""
    return (model.predict_proba(features_batch(X)) + model.predict_proba(features_batch(mirror(X)))) / 2


def fit(model_fn, X, y, g, rng):
    Xa, ya, _ = augment(X, y, g, rng)
    m = model_fn()
    m.fit(features_batch(Xa), ya)
    return m


def evaluate_cv(model_fn, X, y, g, folds=5):
    rng = np.random.default_rng(SEED)
    cv = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=SEED)
    pred, conf = np.empty(len(y), dtype=object), np.zeros(len(y))
    for tr, te in cv.split(X, y, g):
        m = fit(model_fn, X[tr], y[tr], g[tr], rng)
        p = predict_proba_tta(m, X[te])
        pred[te] = m.classes_[p.argmax(1)]
        conf[te] = p.max(1)
    return pred.astype(str), conf


def evaluate_source_holdout(model_fn, X, y, g, src, fl, train_on_flipped=True):
    """Train on two sources, test on the third. Also splits the score by photo orientation:
    original photos are mostly right hands (79%), flipped ones mostly left hands."""
    rng = np.random.default_rng(SEED)
    res, pooled = {}, np.empty(len(y), dtype=object)
    for s in np.unique(src):
        tr, te = src != s, src == s
        if not train_on_flipped:
            tr = tr & ~fl
        m = fit(model_fn, X[tr], y[tr], g[tr], rng)
        p = predict_proba_tta(m, X[te])
        pr = m.classes_[p.argmax(1)]
        pooled[te] = pr
        res[s] = {"n": int(te.sum()), "accuracy": float(accuracy_score(y[te], pr)),
                  "macro_f1": float(f1_score(y[te], pr, average="macro"))}
        if fl[te].any():
            ok = pr == y[te]
            res[s]["accuracy_original"] = float(ok[~fl[te]].mean())
            res[s]["accuracy_flipped"] = float(ok[fl[te]].mean())
    return res, pooled.astype(str)


def threshold_table(y, pred, conf):
    rows = []
    for t in [0.0, 0.5, 0.6, 0.7, 0.8, 0.9]:
        keep = conf >= t
        rows.append({"threshold": t, "coverage": float(keep.mean()),
                     "accuracy": float((pred[keep] == y[keep]).mean()) if keep.any() else None})
    return rows


def export_mlp(model, path, letters_for_game, metrics):
    scaler, mlp = model.named_steps["standardscaler"], model.named_steps["mlpclassifier"]
    out = {
        "format": "asl-mlp-v1",
        "featureSpec": "wrist-origin, mean-2D-distance scale, 63 coords + 55 key-point distances",
        "featureDim": FEATURE_DIM,
        "classes": [str(c) for c in mlp.classes_],
        "gameLetters": letters_for_game,
        "scaler": {"mean": scaler.mean_.round(6).tolist(), "scale": scaler.scale_.round(6).tolist()},
        "layers": [{"W": W.T.round(6).tolist(), "b": b.round(6).tolist()}  # W: (out, in)
                   for W, b in zip(mlp.coefs_, mlp.intercepts_)],
        "activation": "relu",
        "output": "softmax",
        "metrics": {"cv_accuracy": metrics["cv"]["accuracy"], "cv_macro_f1": metrics["cv"]["macro_f1"]},
        "trainedAt": time.strftime("%Y-%m-%d"),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()

    d = np.load(os.path.join(ROOT, "data", "landmarks.npz"))
    keep = np.isin(d["y"], STATIC_LETTERS)
    X, y, src, g, fl = d["X"][keep], d["y"][keep], d["source"][keep], d["group"][keep], d["flipped"][keep]
    print(f"{len(y)} samples, {len(np.unique(g))} groups, sources:",
          {s: int((src == s).sum()) for s in np.unique(src)})

    metrics = {"n_samples": int(len(y)), "n_flipped": int(fl.sum()), "per_source": {s: int((src == s).sum()) for s in np.unique(src)},
               "per_letter": {L: int((y == L).sum()) for L in STATIC_LETTERS}, "models": {}}

    names = ["mlp_128_64"] if args.quick else list(MODELS)
    for name in names:
        t0 = time.time()
        pred, conf = evaluate_cv(MODELS[name], X, y, g)
        metrics["models"][name] = {"cv_accuracy": float(accuracy_score(y, pred)),
                                   "cv_macro_f1": float(f1_score(y, pred, average="macro"))}
        print(f"{name:20s} acc {metrics['models'][name]['cv_accuracy']:.3f} "
              f"F1 {metrics['models'][name]['cv_macro_f1']:.3f} ({time.time() - t0:.0f}s)")
        if name == "mlp_128_64":
            mlp_pred, mlp_conf = pred, conf

    p, r, f, n = precision_recall_fscore_support(y, mlp_pred, labels=STATIC_LETTERS, zero_division=0)
    cm = confusion_matrix(y, mlp_pred, labels=STATIC_LETTERS)
    confusions = sorted(((int(cm[i, j]), STATIC_LETTERS[i], STATIC_LETTERS[j]) for i in range(24) for j in range(24)
                         if i != j and cm[i, j] > 0), reverse=True)[:12]
    metrics["cv"] = {
        "accuracy": float(accuracy_score(y, mlp_pred)),
        "macro_f1": float(f1_score(y, mlp_pred, average="macro")),
        "per_letter": {L: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]), "n": int(n[i])}
                       for i, L in enumerate(STATIC_LETTERS)},
        "top_confusions": [{"true": a, "pred": b, "count": c} for c, a, b in confusions],
        "thresholds": threshold_table(y, mlp_pred, mlp_conf),
        "confusion_matrix": cm.tolist(),
    }
    metrics["source_holdout"], lo_pred = evaluate_source_holdout(make_mlp, X, y, g, src, fl)
    # Ablation: the same evaluation without flipped-photo landmarks in training.
    metrics["source_holdout_no_flipped_training"], _ = evaluate_source_holdout(make_mlp, X, y, g, src, fl, False)
    _, _, lo_f, _ = precision_recall_fscore_support(y, lo_pred, labels=STATIC_LETTERS, zero_division=0)
    metrics["source_holdout_f1"] = {L: float(lo_f[i]) for i, L in enumerate(STATIC_LETTERS)}
    # "Reliable" = holds up on a dataset (people, cameras, lighting) the model never saw.
    game_letters = [L for i, L in enumerate(STATIC_LETTERS) if lo_f[i] >= RELIABLE_F1]
    metrics["game_letters"] = game_letters
    print("CV", metrics["cv"]["accuracy"], "holdout", metrics["source_holdout"])
    print("game letters:", "".join(game_letters))

    # Final model on all data.
    final = fit(make_mlp, X, y, g, np.random.default_rng(SEED))
    sk_path = os.path.join(ROOT, "export", "asl_mlp_weights.json")
    export_mlp(final, sk_path, game_letters, metrics)
    convert_to_tfjs(sk_path)

    # Parity fixtures for the JS implementation (raw landmarks -> features -> probabilities).
    idx = np.random.default_rng(1).choice(len(X), 40, replace=False)
    fx = {"landmarks": X[idx].round(6).tolist(),
          "features": features_batch(X[idx]).round(6).tolist(),
          "proba": final.predict_proba(features_batch(X[idx])).round(6).tolist(),
          "classes": [str(c) for c in final.classes_]}
    os.makedirs(os.path.join(ROOT, "..", "web", "test", "fixtures"), exist_ok=True)
    with open(os.path.join(ROOT, "..", "web", "test", "fixtures", "parity.json"), "w") as fh:
        json.dump(fx, fh)

    export_templates(d, os.path.join(ROOT, "..", "web", "public", "models", "hand_poses.json"))

    os.makedirs(os.path.join(ROOT, "reports"), exist_ok=True)
    with open(os.path.join(ROOT, "reports", "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=1)
    write_report(metrics)


def convert_to_tfjs(sk_path):
    """Builds the TensorFlow.js model the game loads (needs `npm install` in web/)."""
    web = os.path.join(ROOT, "..", "web")
    node = shutil.which("node")
    if not node or not os.path.isdir(os.path.join(web, "node_modules", "@tensorflow")):
        print("NOTE: run `cd web && npm install && node scripts/convert-model.mjs` to build the TF.js model")
        return
    subprocess.run([node, "scripts/convert-model.mjs", os.path.abspath(sk_path)], cwd=web, check=True)


FINGERS = {"thumb": [1, 2, 3, 4], "index": [5, 6, 7, 8], "middle": [9, 10, 11, 12],
           "ring": [13, 14, 15, 16], "pinky": [17, 18, 19, 20]}


def finger_errors(Q, T):
    """Mean 2-D distance of each finger's two outer joints (DIP + tip) between normalised hands
    Q and T, in hand-size units. The outer joints are where handshapes differ; the knuckles barely move."""
    return np.array([np.linalg.norm(Q[j[2:], :2] - T[j[2:], :2], axis=-1).mean() for j in FINGERS.values()])


def export_templates(d, path):
    """Reference pose per letter for the practice coach and the guide cards.

    * points: medoid hand from the single-signer Marxulia photos, 3-D (z is MediaPipe's relative
      depth), wrist at the origin, scaled to unit hand size. Orientation: right hand in the raw
      (un-mirrored) camera frame.
    * tolerance: per finger, the 75th percentile of the distance between real samples of that
      letter (all datasets, either orientation) and the reference. The coach marks a finger as
      "off" when the player's error exceeds it, so the bar reflects how much real signers vary.
    """
    out = {}
    for L in STATIC_LETTERS:
        m = (d["y"] == L) & (d["source"] == "marxulia") & ~d["flipped"]
        P = np.stack([normalise(p) for p in d["X"][m]])
        dist = np.linalg.norm(P[:, None, :, :2] - P[None, :, :, :2], axis=-1).mean(-1).sum(-1)
        T = P[dist.argmin()]
        errs = []
        for p in d["X"][d["y"] == L]:
            e1, e2 = finger_errors(normalise(p), T), finger_errors(normalise(mirror(p)), T)
            errs.append(e1 if e1.sum() <= e2.sum() else e2)
        tol = np.percentile(np.array(errs), 75, axis=0)
        out[L] = {"points": T.astype(np.float64).round(4).tolist(), "tolerance": tol.astype(np.float64).round(3).tolist()}
    with open(path, "w") as fh:
        json.dump({"orientation": "right hand, raw camera frame", "fingers": FINGERS, "poses": out},
                  fh, separators=(",", ":"))


def write_report(m):
    L = []
    L.append(f"Samples: **{m['n_samples']}** ({', '.join(f'{k}: {v}' for k, v in m['per_source'].items())}), "
             f"of which {m['n_flipped']} are MediaPipe landmarks of horizontally flipped photos\n")
    L.append("### Model comparison (5-fold StratifiedGroupKFold, mirror test-time averaging)\n")
    L.append("| model | accuracy | macro F1 |\n|---|---|---|")
    for k, v in m["models"].items():
        L.append(f"| {k} | {v['cv_accuracy']:.3f} | {v['cv_macro_f1']:.3f} |")
    L.append("\n### Generalisation to an unseen dataset (train on the other two sources)\n")
    L.append("| held-out source | n | accuracy | macro F1 |\n|---|---|---|---|")
    for k, v in m["source_holdout"].items():
        L.append(f"| {k} | {v['n']} | {v['accuracy']:.3f} | {v['macro_f1']:.3f} |")
    L.append("\n### Left vs. right hands (unseen dataset)\n")
    L.append("Original photos are mostly right hands, flipped photos mostly left hands. Training with or without "
             "MediaPipe landmarks of flipped photos (synthetic mirroring is used in both cases):\n")
    L.append("| held-out source | training | original (≈right) | flipped (≈left) |\n|---|---|---|---|")
    for k, v in m["source_holdout"].items():
        if "accuracy_flipped" not in v:
            continue
        b = m["source_holdout_no_flipped_training"][k]
        L.append(f"| {k} | mirror augmentation only | {b['accuracy_original']:.3f} | {b['accuracy_flipped']:.3f} |")
        L.append(f"| {k} | + flipped-photo landmarks | {v['accuracy_original']:.3f} | {v['accuracy_flipped']:.3f} |")
    L.append("\n### Per-letter results (MLP, grouped CV)\n")
    L.append("| letter | n | precision | recall | F1 | F1 unseen dataset | in game |\n|---|---|---|---|---|---|---|")
    for k, v in m["cv"]["per_letter"].items():
        L.append(f"| {k} | {v['n']} | {v['precision']:.2f} | {v['recall']:.2f} | {v['f1']:.2f} | "
                 f"{m['source_holdout_f1'][k]:.2f} | "
                 f"{'yes' if k in m['game_letters'] else '-'} |")
    L.append("\n### Confidence threshold vs. accuracy (MLP, grouped CV)\n")
    L.append("| threshold | coverage | accuracy |\n|---|---|---|")
    for r in m["cv"]["thresholds"]:
        L.append(f"| {r['threshold']:.1f} | {r['coverage']:.3f} | {r['accuracy']:.3f} |")
    L.append("\n### Most frequent confusions\n")
    L.append(", ".join(f"{c['true']}→{c['pred']} ({c['count']})" for c in m["cv"]["top_confusions"]))
    with open(os.path.join(ROOT, "reports", "evaluation.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
