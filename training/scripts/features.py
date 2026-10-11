"""Landmark -> feature vector. Mirrored 1:1 by web/src/recognition/features.js.

Input: (21, 3) MediaPipe landmarks in "height units" (x and z multiplied by W/H).
Steps:
  1. translate so the wrist (landmark 0) is the origin
  2. divide by the hand size = mean 2-D distance of all landmarks from the wrist
  3. features = 63 normalised coordinates + 55 pairwise 3-D distances between
     the wrist, the 5 fingertips and 5 knuckle/base joints (rotation invariant cues)
Hand orientation is kept on purpose: G/H vs U, P vs K and Q vs G differ mostly by
how the hand is rotated.
"""
import numpy as np

KEY_POINTS = [0, 4, 8, 12, 16, 20, 2, 5, 9, 13, 17]
PAIRS = [(i, j) for a, i in enumerate(KEY_POINTS) for j in KEY_POINTS[a + 1:]]
FEATURE_DIM = 63 + len(PAIRS)


def normalise(P):
    Q = P - P[0]
    size = np.mean(np.linalg.norm(Q[1:, :2], axis=1))
    return Q / max(size, 1e-6)


def mirror(P):
    """Reflect a hand left<->right (used for left-hand canonicalisation and augmentation)."""
    M = P.copy()
    M[..., 0] = -M[..., 0]
    return M


def features(P):
    Q = normalise(np.asarray(P, dtype=np.float64))
    d = [np.linalg.norm(Q[i] - Q[j]) for i, j in PAIRS]
    return np.concatenate([Q.reshape(-1), d]).astype(np.float32)


def features_batch(X):
    return np.stack([features(p) for p in X])
