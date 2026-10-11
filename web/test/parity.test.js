// The browser feature extraction + MLP must reproduce the Python training pipeline exactly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as tf from '@tensorflow/tfjs-core';
import { loadLayersModel } from '@tensorflow/tfjs-layers';
import { initTf, LetterClassifier } from '../src/recognition/classifier.js';
import { features, FEATURE_DIM, toPoints } from '../src/recognition/features.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url)));
const dir = new URL('../public/models/asl_tfjs/', import.meta.url);
const json = JSON.parse(readFileSync(new URL('model.json', dir)));
const bin = readFileSync(new URL('weights.bin', dir));
await initTf();
const tfModel = await loadLayersModel(tf.io.fromMemory({
  modelTopology: json.modelTopology,
  weightSpecs: json.weightsManifest[0].weights,
  weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
  userDefinedMetadata: json.userDefinedMetadata,
}));
const clf = new LetterClassifier(tfModel);
const model = json.userDefinedMetadata;

test('feature vectors match Python', () => {
  assert.equal(FEATURE_DIM, model.featureDim);
  assert.ok(tfModel.countParams() < 100_000, 'the classifier should stay small');
  fx.landmarks.forEach((P, i) => {
    const f = features(P);
    f.forEach((v, j) => assert.ok(Math.abs(v - fx.features[i][j]) < 1e-3, `sample ${i} feature ${j}: ${v} vs ${fx.features[i][j]}`));
  });
});

test('TensorFlow.js model reproduces scikit-learn probabilities', () => {
  assert.deepEqual(clf.classes, fx.classes);
  fx.landmarks.forEach((P, i) => {
    const p = clf.predictFeatures(features(P));
    p.forEach((v, j) => assert.ok(Math.abs(v - fx.proba[i][j]) < 2e-3, `sample ${i} class ${j}`));
  });
});

test('mirror-averaged prediction is identical for a hand and its mirror image', () => {
  const P = fx.landmarks[0];
  const M = P.map(([x, y, z]) => [-x, y, z]);
  const a = clf.predictPoints(P);
  const b = clf.predictPoints(M);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6));
});

test('toPoints restores aspect ratio and mirrors', () => {
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: i / 40, y: 0.5, z: 0.01 }));
  const P = toPoints(lm, 16 / 9);
  assert.ok(Math.abs(P[20][0] - (20 / 40) * (16 / 9)) < 1e-9);
  assert.ok(Math.abs(toPoints(lm, 16 / 9, true)[20][0] + P[20][0]) < 1e-9);
});

test('game letters are a subset of the classes', () => {
  assert.ok(model.gameLetters.length >= 8);
  for (const L of model.gameLetters) assert.ok(model.classes.includes(L));
  assert.ok(!model.classes.includes('J') && !model.classes.includes('Z'));
});
