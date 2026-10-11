"""Keras checkpoint of the ASL letter classifier: save, load, and re-export to the web app.

A checkpoint directory (default: training/checkpoints/) contains
    asl_mlp.keras   the trained Keras model, including optimizer state (resumable)
    scaler.json     StandardScaler mean/scale applied to the 118 features before the model
    config.json     hyperparameters, classes, game letters, feature spec, versions, metrics

Usage:
    .venv-tf/bin/python scripts/checkpoint.py export      # checkpoint -> export/asl_mlp_weights.json -> TF.js
    .venv-tf/bin/python scripts/checkpoint.py info        # print config + sanity-check predictions

In Python:
    from checkpoint import load_checkpoint
    clf = load_checkpoint()
    probs = clf.predict_proba(landmarks)      # (N, 21, 3) landmarks in height units
"""
import argparse
import json
import os
import time

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import keras  # noqa: E402
import numpy as np  # noqa: E402

from features import FEATURE_DIM, features_batch, mirror  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DEFAULT_DIR = os.path.join(ROOT, "checkpoints")
EXPORT_PATH = os.path.join(ROOT, "export", "asl_mlp_weights.json")


def save_checkpoint(model, scaler, config, path=DEFAULT_DIR):
    os.makedirs(path, exist_ok=True)
    model.save(os.path.join(path, "asl_mlp.keras"))
    with open(os.path.join(path, "scaler.json"), "w") as fh:
        json.dump({"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()}, fh)
    with open(os.path.join(path, "config.json"), "w") as fh:
        json.dump({**config, "featureDim": FEATURE_DIM, "savedAt": time.strftime("%Y-%m-%d %H:%M"),
                   "keras": keras.__version__}, fh, indent=1)


class Checkpoint:
    def __init__(self, path=DEFAULT_DIR):
        self.model = keras.models.load_model(os.path.join(path, "asl_mlp.keras"))
        s = json.load(open(os.path.join(path, "scaler.json")))
        self.mean, self.scale = np.array(s["mean"]), np.array(s["scale"])
        self.config = json.load(open(os.path.join(path, "config.json")))
        self.classes = self.config["classes"]

    def predict_features(self, F):
        return self.model.predict((np.asarray(F) - self.mean) / self.scale, verbose=0)

    def predict_proba(self, X, tta=True):
        """Landmarks (N, 21, 3) -> class probabilities, mirror-averaged like the browser."""
        p = self.predict_features(features_batch(X))
        if tta:
            p = (p + self.predict_features(features_batch(mirror(np.asarray(X))))) / 2
        return p

    def export(self, path=EXPORT_PATH):
        """Writes the shared asl-mlp-v1 JSON consumed by web/scripts/convert-model.mjs.
        Dropout layers are inactive at inference and therefore omitted."""
        dense = [l for l in self.model.layers if isinstance(l, keras.layers.Dense)]
        c = self.config
        out = {
            "format": "asl-mlp-v1",
            "trainedWith": c.get("framework", f"Keras {keras.__version__}"),
            "featureSpec": c["featureSpec"],
            "featureDim": FEATURE_DIM,
            "classes": self.classes,
            "gameLetters": c["gameLetters"],
            "scaler": {"mean": self.mean.round(6).tolist(), "scale": self.scale.round(6).tolist()},
            "layers": [{"W": l.get_weights()[0].T.round(6).tolist(), "b": l.get_weights()[1].round(6).tolist()}
                       for l in dense],
            "activation": "relu",
            "output": "softmax",
            "hyperparameters": c["hyperparameters"],
            "metrics": c.get("metrics", {}),
            "trainedAt": c.get("savedAt", "")[:10],
        }
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(out, fh, separators=(",", ":"))
        return path


def load_checkpoint(path=DEFAULT_DIR):
    return Checkpoint(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["export", "info"])
    ap.add_argument("--dir", default=DEFAULT_DIR)
    args = ap.parse_args()
    ck = Checkpoint(args.dir)
    if args.command == "info":
        print(json.dumps(ck.config, indent=1))
        ck.model.summary()
        d = np.load(os.path.join(ROOT, "data", "landmarks.npz"))
        keep = np.isin(d["y"], ck.classes)
        X, y = d["X"][keep][:500], d["y"][keep][:500]
        acc = (np.array(ck.classes)[ck.predict_proba(X).argmax(1)] == y).mean()
        print(f"sanity check on 500 (training) samples: accuracy {acc:.3f}")
    else:
        import train as base
        path = ck.export()
        print("wrote", path)
        base.convert_to_tfjs(path)


if __name__ == "__main__":
    main()
