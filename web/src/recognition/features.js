// Landmark -> feature vector. Must stay identical to training/scripts/features.py
// (verified by test/parity.test.js against fixtures exported by the training script).

const KEY_POINTS = [0, 4, 8, 12, 16, 20, 2, 5, 9, 13, 17];
export const PAIRS = [];
for (let a = 0; a < KEY_POINTS.length; a++) {
  for (let b = a + 1; b < KEY_POINTS.length; b++) PAIRS.push([KEY_POINTS[a], KEY_POINTS[b]]);
}
export const FEATURE_DIM = 63 + PAIRS.length;

/**
 * Converts MediaPipe normalised landmarks to "height units" (true proportions).
 * MediaPipe normalises x and z by the frame width and y by the frame height.
 * @param {{x:number,y:number,z:number}[]} lm
 * @param {number} aspect frame width / height
 * @param {boolean} mirror reflect left<->right (canonicalises left hands)
 */
export function toPoints(lm, aspect, mirror = false) {
  const s = mirror ? -aspect : aspect;
  return lm.map((p) => [p.x * s, p.y, p.z * s]);
}

export function mirrorPoints(P) {
  return P.map(([x, y, z]) => [-x, y, z]);
}

export function normalise(P) {
  const [ox, oy, oz] = P[0];
  const Q = P.map(([x, y, z]) => [x - ox, y - oy, z - oz]);
  let size = 0;
  for (let i = 1; i < 21; i++) size += Math.hypot(Q[i][0], Q[i][1]);
  size = Math.max(size / 20, 1e-6);
  return Q.map(([x, y, z]) => [x / size, y / size, z / size]);
}

export function features(P) {
  const Q = normalise(P);
  const out = new Float32Array(FEATURE_DIM);
  let k = 0;
  for (const p of Q) { out[k++] = p[0]; out[k++] = p[1]; out[k++] = p[2]; }
  for (const [i, j] of PAIRS) {
    out[k++] = Math.hypot(Q[i][0] - Q[j][0], Q[i][1] - Q[j][1], Q[i][2] - Q[j][2]);
  }
  return out;
}
