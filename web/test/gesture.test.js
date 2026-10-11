import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GestureConfirmer } from '../src/recognition/gestureConfirm.js';
import { PlayerAssigner } from '../src/recognition/playerAssign.js';

const CLASSES = ['A', 'B', 'C'];
const probs = (letter, p = 0.95) => Float32Array.from(CLASSES.map((c) => (c === letter ? p : (1 - p) / 2)));

function run(gc, frames, ctx) {
  const out = [];
  for (const f of frames) {
    const r = gc.update(f, 33, ctx);
    if (r) out.push(r);
  }
  return out;
}

test('a held pose confirms once after the hold duration', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 330, smoothing: 1 });
  const got = run(gc, Array(9).fill(probs('B')));
  assert.deepEqual(got, []);
  assert.ok(gc.state.progress > 0.8);
  assert.deepEqual(run(gc, Array(2).fill(probs('B'))), ['B']);
  // keeps holding: no repeat
  assert.deepEqual(run(gc, Array(40).fill(probs('B'))), []);
  assert.equal(gc.state.needsRelease, true);
});

test('repeating a letter requires a release', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 200, smoothing: 1, releaseMs: 150 });
  assert.deepEqual(run(gc, Array(10).fill(probs('A'))), ['A']);
  run(gc, Array(8).fill(null)); // hand away for ~260 ms
  assert.deepEqual(run(gc, Array(10).fill(probs('A'))), ['A']);
});

test('a changed pose counts without a release', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 200, smoothing: 1 });
  assert.deepEqual(run(gc, [...Array(10).fill(probs('A')), ...Array(10).fill(probs('C'))]), ['A', 'C']);
});

test('low confidence never confirms', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 200, smoothing: 1, threshold: 0.6 });
  assert.deepEqual(run(gc, Array(60).fill(probs('A', 0.5))), []);
  assert.equal(gc.state.display.letter, 'A');
});

test('a single-frame dropout does not reset progress', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 330, smoothing: 1 });
  const got = run(gc, [...Array(5).fill(probs('B')), null, ...Array(6).fill(probs('B'))]);
  assert.deepEqual(got, ['B']);
});

test('slow effect halves confirmation speed', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 330, smoothing: 1 });
  assert.deepEqual(run(gc, Array(15).fill(probs('B')), { speed: 0.5 }), []);
  assert.deepEqual(run(gc, Array(6).fill(probs('B')), { speed: 0.5 }), ['B']);
});

test('letters outside the allowed set are ignored', () => {
  const gc = new GestureConfirmer(CLASSES, { holdMs: 100, smoothing: 1 });
  assert.deepEqual(run(gc, Array(10).fill(probs('C')), { allowed: ['A', 'B'] }), []);
});

// ---- player assignment ----
const hand = (cx, label, score = 0.95) => ({
  // raw (un-mirrored) camera coords: mirrored screen x = 1 - cx
  landmarks: Array.from({ length: 21 }, () => ({ x: 1 - cx, y: 0.5, z: 0 })),
  handedness: label,
  handScore: score,
});

test('players are assigned by screen side, whichever hand they use', () => {
  const pa = new PlayerAssigner();
  // two right hands: still left-most -> P1, right-most -> P2
  const [p1, p2] = pa.assign([hand(0.7, 'Right'), hand(0.3, 'Right')], 0);
  assert.ok(p1.screen.x < 0.5 && p2.screen.x > 0.5);
  assert.equal(p1.hand, 'right');
  assert.equal(p2.hand, 'right');
});

test('the detected handedness is reported for hints and mirroring', () => {
  const pa = new PlayerAssigner();
  const [p1, p2] = pa.assign([hand(0.3, 'Left'), hand(0.7, 'Right')], 0);
  assert.equal(p1.hand, 'left');
  assert.equal(p2.hand, 'right');
  const swapped = new PlayerAssigner({ swapLabels: true }).assign([hand(0.3, 'Left')], 0);
  assert.equal(swapped[0].hand, 'right');
});

test('a lone hand goes to the player whose half it is in', () => {
  const pa = new PlayerAssigner();
  assert.ok(pa.assign([hand(0.2, 'Right')], 0)[0]);
  assert.ok(pa.assign([hand(0.8, 'Left')], 2000)[1]);
});

test('a hand drifting just past the midline keeps its player', () => {
  const pa = new PlayerAssigner();
  pa.assign([hand(0.46, 'Right')], 0);
  const r = pa.assign([hand(0.53, 'Right')], 50);
  assert.ok(r[0], 'still P1');
  assert.equal(r[1], null);
});

test('a brief dropout of one player does not move the other', () => {
  const pa = new PlayerAssigner();
  pa.assign([hand(0.25, 'Left'), hand(0.75, 'Right')], 0);
  const [p1, p2] = pa.assign([hand(0.73, 'Right')], 100);
  assert.equal(p1, null);
  assert.ok(p2);
});

test('duplicate detections of one hand are merged', () => {
  const pa = new PlayerAssigner();
  const r = pa.assign([hand(0.3, 'Right', 0.9), hand(0.31, 'Left', 0.5)], 0);
  assert.equal(r.filter(Boolean).length, 1);
});
