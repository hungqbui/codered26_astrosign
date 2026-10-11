// Copies the MediaPipe WASM runtime and hand model into public/ so the game runs fully offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
mkdirSync(join(root, 'public/mediapipe'), { recursive: true });
cpSync(wasmSrc, join(root, 'public/mediapipe'), { recursive: true });

const model = join(root, 'public/models/hand_landmarker.task');
const trained = join(root, '../training/data/hand_landmarker.task');
if (!existsSync(model)) {
  if (existsSync(trained)) cpSync(trained, model);
  else {
    const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hand model download failed: ${res.status}`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  }
}
console.log('MediaPipe assets ready in public/');
