// Geometry of the 3-D pose coach (three.js scene graph only; no WebGL needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { HandRig } from '../src/render/handViewer3d.js';
import { compareToPose } from '../src/recognition/poseCoach.js';

const { poses } = JSON.parse(readFileSync(new URL('../public/models/hand_poses.json', import.meta.url)));
const vecs = (pts) => pts.map(([x, y, z]) => new THREE.Vector3(x, -y, -z));

test('joints sit on the landmarks and every bone spans its two joints', () => {
  const rig = new HandRig(new THREE.Group(), { color: 0x38e1ff, opacity: 1, joint: 0.08, bone: 0.05 });
  const P = vecs(poses.L.points);
  rig.update(P);
  rig.joints.forEach((j, i) => assert.ok(j.position.distanceTo(P[i]) < 1e-9));
  for (const { c: [a, b], m } of rig.bones) {
    const mid = P[a].clone().add(P[b]).multiplyScalar(0.5);
    assert.ok(m.position.distanceTo(mid) < 1e-6, 'bone centred between joints');
    assert.ok(Math.abs(m.scale.y - P[a].distanceTo(P[b])) < 1e-6, 'bone length');
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
    const dir = P[b].clone().sub(P[a]).normalize();
    assert.ok(Math.abs(Math.abs(axis.dot(dir)) - 1) < 1e-6, 'bone points along the finger');
  }
});

test('fingers are coloured by their match status', () => {
  const rig = new HandRig(new THREE.Group(), { color: 0x38e1ff, opacity: 1, joint: 0.08, bone: 0.05 });
  const { status, normalised } = compareToPose(poses.B.points, poses.L);
  rig.update(vecs(normalised), status);
  const want = { ok: 0x3dff7a, close: 0xffc13d, off: 0xff4a4a };
  rig.fingerMats.forEach((m, i) => assert.equal(m.color.getHex(), want[status[i]]));
});
