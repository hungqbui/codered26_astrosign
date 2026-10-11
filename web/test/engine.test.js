import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activateEffect, applyLetter, confirmSpeed, createGame, difficulty, drainEvents, findTarget,
  spawnBubble, spawnRock, update,
} from '../src/game/engine.js';

const LETTERS = ['B', 'C', 'L', 'V', 'Y'];

function rock(g, side, letters, y) {
  const o = spawnRock(g, side, { letters });
  o.y = y;
  return o;
}

test('a sign hits every matching target on your side (and nothing on the other side)', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  const far = rock(g, 0, ['B'], 0.2);
  const near = rock(g, 0, ['B'], 0.7);
  const other = rock(g, 0, ['C'], 0.9);
  const theirs = rock(g, 1, ['B'], 0.95);
  const hit = applyLetter(g, 0, 'B');
  assert.deepEqual(hit.map((o) => o.id), [near.id, far.id], 'most urgent first');
  assert.ok(!g.objects.includes(far) && !g.objects.includes(near));
  assert.ok(g.objects.includes(other) && g.objects.includes(theirs));
  assert.equal(g.players[0].destroyed, 2);
  assert.equal(g.players[0].combo, 2);
  assert.equal(g.players[0].hits, 1, 'one sign counts as one letter');
  const multi = drainEvents(g).find((e) => e.type === 'multi');
  assert.equal(multi.count, 2);
});

test('a sign advances every sequence waiting on that letter', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  const a = rock(g, 0, ['C', 'L'], 0.4);
  const b = rock(g, 0, ['C', 'Y'], 0.5);
  const single = rock(g, 0, ['C'], 0.6);
  applyLetter(g, 0, 'C');
  assert.equal(a.idx, 1);
  assert.equal(b.idx, 1);
  assert.ok(!g.objects.includes(single));
  applyLetter(g, 0, 'L');
  assert.ok(!g.objects.includes(a));
  assert.ok(g.objects.includes(b));
});

test('multi-kill bonus scales with the number of kills', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  for (let i = 0; i < 3; i++) rock(g, 0, ['V'], 0.3 + i * 0.1);
  applyLetter(g, 0, 'V');
  const multi = drainEvents(g).find((e) => e.type === 'multi');
  assert.equal(multi.count, 3);
  assert.equal(multi.bonus, 200);
});

test('a sign that clears a Nova orb and the asteroids it would sweep counts each once', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  const b = spawnBubble(g, 0, 'nova');
  b.letters = ['B']; b.idx = 0; b.y = 0.3;
  rock(g, 0, ['B'], 0.5); rock(g, 0, ['C'], 0.6);
  applyLetter(g, 0, 'B');
  assert.equal(g.objects.filter((o) => o.side === 0).length, 0);
  assert.equal(g.players[0].destroyed, 2);
});

test('sequences advance in order and only the next letter counts', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  const o = rock(g, 0, ['C', 'L', 'Y'], 0.3);
  assert.equal(applyLetter(g, 0, 'L'), null); // wrong order -> miss
  applyLetter(g, 0, 'C');
  assert.equal(o.idx, 1);
  applyLetter(g, 0, 'L');
  applyLetter(g, 0, 'Y');
  assert.ok(!g.objects.includes(o));
  assert.equal(g.players[0].destroyed, 1);
});

test('impacts damage only the owning player; shield absorbs one', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  rock(g, 1, ['B'], 0.999);
  update(g, 0.05);
  assert.equal(g.players[0].health, 100);
  assert.equal(g.players[1].health, 88);
  activateEffect(g, 1, 'shield');
  rock(g, 1, ['B'], 0.999);
  update(g, 0.05);
  assert.equal(g.players[1].health, 88);
  rock(g, 1, ['B'], 0.999);
  update(g, 0.05);
  assert.equal(g.players[1].health, 76);
});

test('combo grows with consecutive kills and resets on a miss', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  for (let i = 0; i < 4; i++) { rock(g, 0, ['V'], 0.5); applyLetter(g, 0, 'V'); }
  assert.equal(g.players[0].combo, 4);
  applyLetter(g, 0, 'Y');
  assert.equal(g.players[0].combo, 0);
  assert.equal(g.players[0].maxCombo, 4);
});

test('clearing a bubble activates its effect', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  const b = spawnBubble(g, 0, 'slow');
  b.y = 0.3;
  for (const L of [...b.letters]) applyLetter(g, 0, L);
  assert.equal(confirmSpeed(g, 1), 0.5);
  assert.equal(confirmSpeed(g, 0), 1);
  update(g, 7);
  assert.equal(confirmSpeed(g, 1), 1);
});

test('attack sends rocks to the opponent after a warning', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  g.players[0].nextSpawn = g.players[1].nextSpawn = 999;
  activateEffect(g, 0, 'attack');
  drainEvents(g);
  update(g, 0.5);
  assert.equal(g.objects.filter((o) => o.side === 1).length, 0);
  for (let i = 0; i < 10; i++) update(g, 0.3);
  const hostile = g.objects.filter((o) => o.side === 1 && o.hostile);
  assert.ok(hostile.length >= 2);
  assert.equal(g.objects.filter((o) => o.side === 0).length, 0);
});

test('freeze stops movement on the freezing side only', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  const a = rock(g, 0, ['B'], 0.5);
  const b = rock(g, 1, ['B'], 0.5);
  activateEffect(g, 0, 'freeze');
  update(g, 1);
  assert.equal(a.y, 0.5);
  assert.ok(b.y > 0.5);
});

test('heal is capped at max health', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  g.players[0].health = 90;
  activateEffect(g, 0, 'heal');
  assert.equal(g.players[0].health, 100);
});

test('offensive bubbles respect cooldowns', () => {
  const g = createGame({ letters: LETTERS, seed: 5 });
  activateEffect(g, 0, 'attack');
  activateEffect(g, 0, 'slow');
  g.players[0].health = 100;
  for (let i = 0; i < 30; i++) {
    const b = spawnBubble(g, 0);
    assert.ok(!['attack', 'slow'].includes(b.effect));
    g.objects = [];
  }
});

test('difficulty ramps up', () => {
  const a = difficulty(1);
  const b = difficulty(8);
  assert.ok(b.spawnInterval < a.spawnInterval);
  assert.ok(b.fallTime < a.fallTime);
  assert.ok(b.maxActive > a.maxActive);
  assert.equal(Math.max(...a.seq.map(([n]) => n)), 1);
  assert.ok(Math.max(...b.seq.map(([n]) => n)) >= 3);
});

test('both players get the same asteroid stream', () => {
  const g = createGame({ letters: LETTERS, seed: 42 });
  for (let i = 0; i < 200; i++) update(g, 0.1);
  const words = (s) => g.objects.filter((o) => o.side === s && o.kind === 'rock').map((o) => o.letters.join(''));
  assert.deepEqual(words(0), words(1));
});

test('last player standing wins', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  g.players[0].health = 5;
  rock(g, 0, ['B'], 0.999);
  update(g, 0.05);
  assert.equal(g.over, true);
  assert.equal(g.winner, 1);
});

test('an unattended game ends', () => {
  const g = createGame({ letters: LETTERS, seed: 9 });
  for (let i = 0; i < 20 * 60 * 10 && !g.over; i++) update(g, 1 / 20);
  assert.equal(g.over, true);
});

// ---- new ability orbs ----
test('nova detonates every on-screen asteroid on its own side only', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  rock(g, 0, ['B'], 0.2); rock(g, 0, ['C', 'L'], 0.6); rock(g, 0, ['V'], -0.5); // last one not on screen yet
  const other = rock(g, 1, ['B'], 0.5);
  activateEffect(g, 0, 'nova');
  assert.equal(g.objects.filter((o) => o.side === 0).length, 1);
  assert.ok(g.objects.includes(other));
  assert.equal(g.players[0].destroyed, 2);
  assert.ok(drainEvents(g).some((e) => e.type === 'effect' && e.effect === 'nova' && e.count === 2));
});

test('haste speeds up confirmation and cancels out against slow', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  activateEffect(g, 0, 'haste');
  assert.equal(confirmSpeed(g, 0), 1.6);
  activateEffect(g, 1, 'slow'); // P1 is slowed while hasted
  assert.ok(Math.abs(confirmSpeed(g, 0) - 0.8) < 1e-9);
  update(g, 8);
  assert.equal(confirmSpeed(g, 0), 1);
});

test('leech transfers health but is never lethal', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  g.players[0].health = 50;
  activateEffect(g, 0, 'leech');
  assert.equal(g.players[1].health, 88);
  assert.equal(g.players[0].health, 62);
  g.players[1].health = 5;
  g.players[1].graceUntil.leech = 0;
  activateEffect(g, 0, 'leech');
  assert.equal(g.players[1].health, 1);
});

test('reflect bounces the next offensive orb back to the sender, once', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  activateEffect(g, 1, 'reflect');
  activateEffect(g, 0, 'slow');
  assert.equal(confirmSpeed(g, 0), 0.5, 'sender is slowed');
  assert.equal(confirmSpeed(g, 1), 1);
  const ev = drainEvents(g);
  assert.ok(ev.some((e) => e.type === 'reflect' && e.side === 1 && e.to === 0));
  assert.ok(ev.some((e) => e.type === 'effect' && e.effect === 'slow' && e.reflected && e.target === 0));
  // reflect is used up
  g.players[0].cooldown.attack = 0;
  activateEffect(g, 0, 'attack');
  assert.ok(g.pendingAttacks.every((a) => a.side === 1));
});

test('reflected leech drains the sender', () => {
  const g = createGame({ letters: LETTERS, seed: 3 });
  activateEffect(g, 1, 'reflect');
  activateEffect(g, 0, 'leech');
  assert.equal(g.players[0].health, 88);
  assert.equal(g.players[1].health, 100);
});

test('every effect can be offered and activated', () => {
  const g = createGame({ letters: LETTERS, seed: 11 });
  g.players[0].health = 40;
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const b = spawnBubble(g, 0);
    seen.add(b.effect);
    g.objects = [];
  }
  for (const k of ['attack', 'slow', 'shield', 'heal', 'freeze', 'nova', 'haste', 'reflect', 'leech']) assert.ok(seen.has(k), k);
});
