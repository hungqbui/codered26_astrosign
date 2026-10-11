"""Builds one unified hand-landmark table from the three raw datasets.

Output: data/landmarks.npz with
    X        float32 (N, 21, 3)  landmark coords in "height units":
                                 x' = x * W/H, y' = y, z' = z * W/H
                                 (MediaPipe normalises x and z by width and y by height,
                                 so this restores the true hand proportions)
    y        <U1  (N,)          letter label
    source   <U16 (N,)          dataset of origin (used for source-held-out evaluation)
    group    <U64 (N,)          id of the original photo/recording (keeps augmented copies together)
    flipped  bool  (N,)         landmarks from a horizontally flipped copy of the photo

Every photo is also run through MediaPipe flipped. MediaPipe is not mirror-equivariant: its
landmarks for a real left hand differ from the mirror image of the right-hand landmarks, so
synthetic mirroring alone leaves left hands under-represented (see training/README.md).

Images are run through the same MediaPipe Hand Landmarker model the browser game uses.
"""
import glob
import io
import json
import os
import sys

import numpy as np
import pyarrow.parquet as pq
from PIL import Image, ImageOps

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# The ASLNow! JSON files do not store the frame size. They were captured from desktop
# webcams in the browser; we assume the common 4:3 frame and jitter the aspect ratio
# during training so the classifier does not depend on that assumption.
ASLNOW_ASPECT = 4 / 3


def make_detector():
    opts = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=os.path.join(DATA, "hand_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
    )
    return vision.HandLandmarker.create_from_options(opts)


def detect(detector, pil_img):
    img = pil_img.convert("RGB")
    w, h = img.size
    # Very small images detect poorly; upscale so the short side is at least 256px.
    if min(w, h) < 256:
        s = 256 / min(w, h)
        img = img.resize((round(w * s), round(h * s)), Image.BILINEAR)
        w, h = img.size
    res = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(img)))
    if not res.hand_landmarks:
        return None
    lm = res.hand_landmarks[0]
    a = w / h
    return np.array([[p.x * a, p.y, p.z * a] for p in lm], dtype=np.float32)


def both_orientations(detector, img):
    """Landmarks for the photo and for its mirror image (whichever MediaPipe finds)."""
    out = []
    for flipped, im in [(False, img), (True, ImageOps.mirror(img))]:
        arr = detect(detector, im)
        if arr is not None:
            out.append((arr, flipped))
    return out


def load_aslnow():
    rows = []
    for letter in LETTERS:
        for f in sorted(glob.glob(os.path.join(DATA, "asl-now", letter, "*.json"))):
            pts = json.load(open(f))
            if len(pts) != 21:
                continue
            arr = np.array([[p["x"] * ASLNOW_ASPECT, p["y"], p["z"] * ASLNOW_ASPECT] for p in pts], dtype=np.float32)
            rows.append((arr, letter, "aslnow", os.path.basename(f), False))
    return rows, 0


def load_marxulia(detector):
    t = pq.read_table(os.path.join(DATA, "raw", "asl_v03.parquet"))
    labels = t.column("label").to_pylist()
    images = t.column("image").to_pylist()
    rows, missed = [], 0
    for lab, im in zip(labels, images):
        path = im["path"] or ""
        if "_aug_" in path:  # 400 synthetic copies of a single photo per letter; skip
            continue
        img = Image.open(io.BytesIO(im["bytes"]))
        found = both_orientations(detector, img)
        missed += not found
        rows += [(arr, LETTERS[lab], "marxulia", path, fl) for arr, fl in found]
    return rows, missed


def load_aslletters(detector):
    rows, missed = [], 0
    for letter in LETTERS:
        for f in sorted(glob.glob(os.path.join(DATA, "raw", "asl_letters", "*", "train_val", letter, "*.jpg"))):
            found = both_orientations(detector, Image.open(f))
            missed += not found
            # Roboflow exports name files "<orig>_jpg.rf.<hash>.jpg"; group by the original name.
            rows += [(arr, letter, "asl_letters", os.path.basename(f).split("_jpg")[0], fl) for arr, fl in found]
    return rows, missed


def main():
    detector = make_detector()
    all_rows = []
    for name, fn in [("aslnow", load_aslnow), ("marxulia", lambda: load_marxulia(detector)),
                     ("asl_letters", lambda: load_aslletters(detector))]:
        rows, missed = fn()
        print(f"{name:12s} kept {len(rows):5d} (incl. flipped)  photos with no hand detected {missed}", file=sys.stderr)
        all_rows += rows
    np.savez_compressed(
        os.path.join(DATA, "landmarks.npz"),
        X=np.stack([r[0] for r in all_rows]),
        y=np.array([r[1] for r in all_rows]),
        source=np.array([r[2] for r in all_rows]),
        group=np.array([f"{r[2]}:{r[1]}:{r[3]}" for r in all_rows]),
        flipped=np.array([r[4] for r in all_rows]),
    )


if __name__ == "__main__":
    main()
