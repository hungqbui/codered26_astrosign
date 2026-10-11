// MediaPipe Hand Landmarker in a Web Worker, so hand tracking never blocks rendering.
//
// Protocol:
//   main -> worker  { type: 'init', wasmBase, model: ArrayBuffer }
//   worker -> main  { type: 'ready' } | { type: 'error', message }
//   main -> worker  { type: 'frame', id, ts, bitmap: ImageBitmap }         (bitmap transferred)
//   worker -> main  { type: 'result', id, landmarks, handedness, ms, bitmap } (bitmap sent back so
//                    the previews can draw the exact frame the landmarks came from)
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe loads its Emscripten glue with importScripts(), which module workers don't allow;
// it then falls back to self.import(). Evaluate the (classic) script in global scope so it
// defines self.ModuleFactory exactly as importScripts would.
self.import = async (url) => {
  const src = await (await fetch(url)).text();
  (0, eval)(`${src}\n;self.ModuleFactory = ModuleFactory;`);
};

let landmarker = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const fileset = await FilesetResolver.forVisionTasks(data.wasmBase);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(data.model), delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: e?.message ?? String(e) });
    }
    return;
  }
  if (data.type === 'frame') {
    const t0 = performance.now();
    let res = { landmarks: [], handedness: [] };
    try {
      res = landmarker.detectForVideo(data.bitmap, data.ts);
    } catch (e) {
      self.postMessage({ type: 'warn', message: e?.message ?? String(e) });
    }
    self.postMessage({
      type: 'result',
      id: data.id,
      landmarks: res.landmarks ?? [],
      handedness: (res.handedness ?? res.handednesses ?? []).map((h) => h.map((c) => ({ categoryName: c.categoryName, score: c.score }))),
      ms: performance.now() - t0,
      bitmap: data.bitmap,
    }, [data.bitmap]);
  }
};
