import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareToPose } from '../src/recognition/poseCoach.js';

const { poses } = JSON.parse(readFileSync(new URL('../public/models/hand_poses.json', import.meta.url)));

test('every static letter has a 3-D reference pose and 5 finger tolerances', () => {
  assert.equal(Object.keys(poses).length, 24);
  for (const p of Object.values(poses)) {
    assert.equal(p.points.length, 21);
    assert.equal(p.points[0].length, 3);
    assert.equal(p.tolerance.length, 5);
  }
});

test('the reference pose matches itself, at any position and scale', () => {
  const moved = poses.L.points.map(([x, y, z]) => [x * 0.3 + 0.5, y * 0.3 + 0.4, z * 0.3]);
  assert.deepEqual(compareToPose(moved, poses.L).status, ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('a different letter is flagged on the fingers that differ', () => {
  // B (four fingers up, thumb folded) against L (index up, thumb out): thumb and folded fingers differ.
  const { status } = compareToPose(poses.B.points, poses.L);
  assert.notEqual(status[0], 'ok', 'thumb');
  assert.ok(status.slice(2).some((s) => s === 'off'), 'middle/ring/pinky');
});
