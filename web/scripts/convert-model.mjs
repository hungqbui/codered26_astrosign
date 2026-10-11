// Converts the MLP weights exported by training/scripts/train_tf.py (or train.py) into a TensorFlow.js
// LayersModel (public/models/asl_tfjs/model.json + weights.bin).
//
//   node scripts/convert-model.mjs [path/to/asl_mlp_weights.json]
//
// The StandardScaler is folded into the first Dense layer, so the TF.js model takes the raw
// 118-value feature vector and outputs the 24 letter probabilities (softmax).
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as tfl from '@tensorflow/tfjs-layers';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, '../training/export/asl_mlp_weights.json');
const outDir = join(root, 'public/models/asl_tfjs');

const sk = JSON.parse(readFileSync(src, 'utf8'));
if (sk.format !== 'asl-mlp-v1') throw new Error(`unexpected input format ${sk.format}`);
await tf.setBackend('cpu');

// sklearn layer: out = act(x · W + b); the export stores W as (out, in).
const kernels = sk.layers.map(({ W }) => W[0].map((_, i) => W.map((row) => row[i]))); // -> (in, out)
const biases = sk.layers.map(({ b }) => b.slice());

// Fold standardisation z = (x - mean) / scale into layer 1:
//   z·W + b = x·(W / scale) + (b - (mean / scale)·W)
const { mean, scale } = sk.scaler;
const W0 = kernels[0];
biases[0] = biases[0].map((bo, o) => bo - W0.reduce((s, row, i) => s + (mean[i] / scale[i]) * row[o], 0));
kernels[0] = W0.map((row, i) => row.map((w) => w / scale[i]));

const model = tfl.sequential({ name: 'asl_letter_mlp' });
sk.layers.forEach(({ b }, li) => {
  const last = li === sk.layers.length - 1;
  model.add(tfl.layers.dense({
    units: b.length,
    activation: last ? 'softmax' : 'relu',
    inputShape: li === 0 ? [sk.featureDim] : undefined,
    name: `dense_${li + 1}`,
  }));
});
model.setWeights(kernels.flatMap((k, i) => [tf.tensor2d(k), tf.tensor1d(biases[i])]));
model.setUserDefinedMetadata({
  classes: sk.classes,
  gameLetters: sk.gameLetters,
  featureDim: sk.featureDim,
  featureSpec: sk.featureSpec,
  metrics: sk.metrics,
  trainedAt: sk.trainedAt,
  trainedWith: sk.trainedWith ?? 'scikit-learn MLPClassifier',
  hyperparameters: sk.hyperparameters ?? null,
});

mkdirSync(outDir, { recursive: true });
await model.save(tf.io.withSaveHandler(async (a) => {
  writeFileSync(join(outDir, 'weights.bin'), Buffer.from(a.weightData));
  writeFileSync(join(outDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    generatedBy: `TensorFlow.js tfjs-layers v${tfl.version_layers}`,
    convertedBy: `web/scripts/convert-model.mjs (from ${sk.trainedWith ?? "scikit-learn MLPClassifier"})`,
    modelTopology: a.modelTopology,
    weightsManifest: [{ paths: ['weights.bin'], weights: a.weightSpecs }],
    userDefinedMetadata: a.userDefinedMetadata,
  }));
  return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
}));
console.log(`TF.js model written to ${outDir} (${model.countParams()} parameters, classes ${sk.classes.join('')})`);
