// In-browser inference with TensorFlow.js for the MLP trained by training/scripts/train.py
// and converted by scripts/convert-model.mjs (public/models/asl_tfjs/).
//
// Only the CPU backend is bundled: the model is ~25k parameters, so a forward pass is far
// cheaper than the hand tracking itself, and the whole pipeline stays off the GPU.
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { loadLayersModel } from '@tensorflow/tfjs-layers';
import { features, FEATURE_DIM, mirrorPoints } from './features.js';

export async function initTf() {
  await tf.setBackend('cpu');
  await tf.ready();
}

export class LetterClassifier {
  /** @param {import('@tensorflow/tfjs-layers').LayersModel} model */
  constructor(model) {
    const meta = model.getUserDefinedMetadata() ?? {};
    if (!meta.classes) throw new Error('Model is missing its class list (userDefinedMetadata.classes)');
    if (meta.featureDim !== FEATURE_DIM) throw new Error(`Model expects ${meta.featureDim} features, code produces ${FEATURE_DIM}`);
    this.model = model;
    this.classes = meta.classes;
    this.gameLetters = meta.gameLetters;
    this.metrics = meta.metrics;
    // Warm up so the first real frame does not pay for kernel setup.
    this.predictFeaturesBatch([new Float32Array(FEATURE_DIM)]);
  }

  static async load(url) {
    await initTf();
    return new LetterClassifier(await loadLayersModel(url));
  }

  /** Class probabilities for several feature vectors in one forward pass. */
  predictFeaturesBatch(rows) {
    const flat = new Float32Array(rows.length * FEATURE_DIM);
    rows.forEach((r, i) => flat.set(r, i * FEATURE_DIM));
    const out = tf.tidy(() => this.model.predict(tf.tensor2d(flat, [rows.length, FEATURE_DIM])).dataSync());
    const n = this.classes.length;
    return rows.map((_, i) => out.slice(i * n, (i + 1) * n));
  }

  predictFeatures(f) {
    return this.predictFeaturesBatch([f])[0];
  }

  /**
   * Probabilities for a hand given as points in height units, averaged with its mirror
   * image (the model was trained with mirror augmentation, so both hands are first-class).
   */
  predictPoints(P) {
    const [a, b] = this.predictFeaturesBatch([features(P), features(mirrorPoints(P))]);
    for (let i = 0; i < a.length; i++) a[i] = (a[i] + b[i]) / 2;
    return a;
  }

  top(probs, allowed = null) {
    let best = -1;
    let bestP = -1;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > bestP) { bestP = probs[i]; best = i; }
    }
    const letter = this.classes[best];
    return { letter, confidence: bestP, allowed: !allowed || allowed.includes(letter) };
  }
}
