// Compares a player's hand with a reference pose, finger by finger (practice coach).
import { normalise } from './features.js';

export const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

/**
 * @param {number[][]} points player's hand, canonical right-hand orientation, height units
 * @param {{points:number[][], tolerance:number[]}} pose reference from hand_poses.json
 * @returns {{errors:number[], status:('ok'|'close'|'off')[], normalised:number[][]}}
 *   status: 'ok' within the 75th-percentile spread of real signers, 'close' within 1.6x, else 'off'
 */
export function compareToPose(points, pose) {
  const Q = normalise(points);
  const T = pose.points;
  // Outer two joints (DIP + tip) of each finger: that's where handshapes differ.
  // Must match finger_errors() in training/scripts/train.py, which learns the tolerances.
  const errors = FINGERS.map((joints) => {
    let s = 0;
    for (const j of joints.slice(2)) s += Math.hypot(Q[j][0] - T[j][0], Q[j][1] - T[j][1]);
    return s / 2;
  });
  const status = errors.map((e, i) => {
    const tol = Math.max(pose.tolerance[i], 0.12);
    return e <= tol ? 'ok' : e <= tol * 1.6 ? 'close' : 'off';
  });
  return { errors, status, normalised: Q };
}
