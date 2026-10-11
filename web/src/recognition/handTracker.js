// Webcam + MediaPipe Hand Landmarker (two hands, video mode) + per-player classification.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { toPoints } from './features.js';
import { PlayerAssigner } from './playerAssign.js';

const BASE = import.meta.env.BASE_URL;

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'denied' | 'notfound' | 'inuse' | 'unsupported' | 'other'
  }
}

export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser does not support webcam access (a secure https:// or localhost page is required).');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // 960x540 is plenty for MediaPipe (its detector works at 192 px) and keeps CPU cost down.
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user', frameRate: { ideal: 30 } },
    });
  } catch (e) {
    const map = {
      NotAllowedError: ['denied', 'Camera permission was denied.'],
      SecurityError: ['denied', 'Camera access is blocked on this page.'],
      NotFoundError: ['notfound', 'No webcam was found.'],
      OverconstrainedError: ['notfound', 'No suitable webcam was found.'],
      NotReadableError: ['inuse', 'The webcam is already in use by another application.'],
    };
    const [kind, msg] = map[e.name] ?? ['other', `Could not start the webcam (${e.name || e.message}).`];
    throw new CameraError(kind, msg);
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  return stream;
}

const STARTUP_TIMEOUT_MS = 30000;

/** Rejects if `promise` takes longer than `ms`, naming the step that stalled. */
function withTimeout(promise, ms, step) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hand tracker start-up stalled while ${step} (no response after ${ms / 1000}s).`)), ms);
    }),
  ]);
}

/** Downloads the hand model with visible progress (it is ~7.5 MB). */
async function fetchModel(url, onStatus) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the hand model (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onStatus(`Downloading hand model… ${Math.round((got / total) * 100)}%`);
  }
  return out;
}

export async function loadHandModel(onStatus = () => {}) {
  return withTimeout(fetchModel(`${BASE}models/hand_landmarker.task`, onStatus), 120000, 'downloading the hand model');
}

export async function createLandmarker(onStatus = () => {}) {
  const step = (msg) => { console.info(`[hand tracker] ${msg}`); onStatus(msg); };
  step('Loading hand-tracking runtime…');
  const fileset = await withTimeout(FilesetResolver.forVisionTasks(`${BASE}mediapipe`), STARTUP_TIMEOUT_MS, 'loading the runtime');
  const model = await withTimeout(fetchModel(`${BASE}models/hand_landmarker.task`, onStatus), 120000, 'downloading the hand model');
  console.info(`[hand tracker] model downloaded (${(model.length / 1e6).toFixed(1)} MB)`);
  const opts = (delegate) => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  // The whole pipeline runs on the player's CPU by default: MediaPipe's WASM/XNNPACK
  // backend is fast enough for two hands, and avoids flaky WebGL drivers entirely.
  // ?delegate=GPU opts into WebGL (verified with a self-test, falls back to CPU).
  const wantGpu = new URLSearchParams(location.search).get('delegate')?.toUpperCase() === 'GPU';
  if (wantGpu) {
    try {
      step('Starting hand tracker (GPU)…');
      const gpu = await withTimeout(HandLandmarker.createFromOptions(fileset, opts('GPU')), STARTUP_TIMEOUT_MS, 'starting the GPU tracker');
      // Some WebGL implementations initialise fine but silently return no hands.
      const img = await loadImage(`${BASE}models/selftest_hand.jpg`).catch(() => null);
      if (!img || selfTest(gpu, img)) return { landmarker: gpu, delegate: 'GPU' };
      console.warn('GPU hand tracking failed its self-test; using CPU');
      gpu.close();
    } catch (e) {
      console.warn('GPU delegate unavailable, falling back to CPU', e);
    }
  }
  step('Starting hand tracker (CPU)…');
  const cpu = await withTimeout(HandLandmarker.createFromOptions(fileset, opts('CPU')), STARTUP_TIMEOUT_MS, 'starting the CPU tracker');
  console.info('[hand tracker] ready (CPU)');
  return { landmarker: cpu, delegate: 'CPU' };
}

let selfTestTs = 1;
function selfTest(landmarker, img) {
  try {
    return (landmarker.detectForVideo(img, selfTestTs++).landmarks ?? []).length > 0;
  } catch (e) {
    console.warn('hand tracker self-test threw', e);
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/**
 * Runs detection on the newest video frame and returns per-player hand info:
 * [{ landmarks, hand, screen, probs, points } | null, same for P2]
 */
export class HandTracker {
  constructor(video, { landmarker, delegate }, classifier) {
    this.video = video;
    this.landmarker = landmarker;
    this.delegate = delegate;
    this.classifier = classifier;
    this.assigner = new PlayerAssigner();
    this.lastVideoTime = -1;
    this.players = [null, null];
    this.fps = 0;
    this._lastT = 0;
  }

  set swapLabels(v) { this.assigner.swapLabels = v; }
  get swapLabels() { return this.assigner.swapLabels; }

  /** @returns {boolean} true if a new frame was processed */
  tick(now) {
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = v.currentTime;
    // Snapshot the frame and detect on the snapshot. Previews draw this same snapshot, so the
    // skeleton always lines up with the picture (drawing the live <video> instead would show a
    // newer frame than the landmarks, and the skeleton would trail a moving hand).
    if (!this.frame) this.frame = document.createElement('canvas');
    if (this.frame.width !== v.videoWidth || this.frame.height !== v.videoHeight) {
      this.frame.width = v.videoWidth;
      this.frame.height = v.videoHeight;
    }
    this.frame.getContext('2d').drawImage(v, 0, 0);
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(this.frame, now);
    this.detectMs = performance.now() - t0;
    this.process(res.landmarks ?? [], res.handedness ?? res.handednesses ?? [], now);
    return true;
  }

  /** Player assignment + classification for one detection result (cheap; main thread). */
  process(landmarks, handedness, now) {
    const v = this.video;
    const hands = landmarks.map((lm, i) => {
      const cat = handedness?.[i]?.[0];
      return { landmarks: lm, handedness: cat?.categoryName ?? 'Right', handScore: cat?.score ?? 0.5 };
    });
    const assigned = this.assigner.assign(hands, now);
    const aspect = v.videoWidth / v.videoHeight;
    this.players = assigned.map((d) => {
      if (!d) return null;
      // Canonicalise left hands to right-hand orientation; the classifier also averages
      // with the mirror image, so this mainly keeps features in the densest training region.
      const points = toPoints(d.landmarks, aspect, d.hand === 'left');
      return { ...d, points, probs: this.classifier.predictPoints(points) };
    });
    const dt = now - this._lastT;
    this._lastT = now;
    if (dt > 0) this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;
  }

  missingFor(now) { return this.assigner.missingFor(now); }
}

/**
 * Same interface as HandTracker, but MediaPipe runs in a Web Worker (handWorker.js), so the
 * main thread only snapshots frames, assigns players and classifies (~1 ms). Rendering runs at
 * full frame rate however slow the tracking is on a given machine.
 */
export class WorkerHandTracker extends HandTracker {
  // Frames are downscaled before tracking: MediaPipe's detector works at 192 px anyway, and a
  // smaller bitmap is cheaper to create, transfer and convert.
  static MAX_WIDTH = 640;

  constructor(video, worker, classifier) {
    super(video, { landmarker: null, delegate: 'CPU (worker)' }, classifier);
    this.worker = worker;
    this.busy = false;
    this.nextId = 1;
    this.frame = null; // ImageBitmap of the frame the current landmarks came from
    worker.onmessage = ({ data }) => this.onMessage(data);
  }

  /** Starts the worker and resolves once the tracker is ready. */
  static async create(video, classifier, model) {
    const worker = new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hand tracking worker did not start in time.')), 45000);
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'Hand tracking worker failed to load.')); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); resolve(); }
        if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
      };
      const wasmBase = new URL(`${BASE}mediapipe`, location.href).href;
      const buf = model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
      worker.postMessage({ type: 'init', wasmBase, model: buf }, [buf]);
    });
    worker.onerror = null;
    return new WorkerHandTracker(video, worker, classifier);
  }

  tick(now) {
    const v = this.video;
    if (this.busy || v.readyState < 2 || v.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = v.currentTime;
    this.busy = true;
    const scale = Math.min(1, WorkerHandTracker.MAX_WIDTH / v.videoWidth);
    const id = this.nextId++;
    createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * scale), resizeHeight: Math.round(v.videoHeight * scale), resizeQuality: 'low' })
      .then((bitmap) => this.worker.postMessage({ type: 'frame', id, ts: now, bitmap }, [bitmap]))
      .catch((e) => { console.warn('frame capture failed', e); this.busy = false; });
    return false;
  }

  onMessage(data) {
    if (data.type === 'warn') { console.warn('[hand worker]', data.message); return; }
    if (data.type !== 'result') return;
    this.busy = false;
    this.detectMs = data.ms;
    this.frame?.close?.();
    this.frame = data.bitmap;
    this.process(data.landmarks, data.handedness, performance.now());
  }
}
