import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOSS } from '../src/game/boss.js';
import {
  activateEffect, applyLetter, createGame, difficulty, drainEvents, spawnRock, update,
} from '../src/game/engine.js';

const LETTERS = ['B', 'C', 'L', 'V', 'Y'];
const boss = (seed = 1) => {
  const g = createGame({ letters: LETTERS, seed, mode: 'boss' });
  g.players.forEach((p) => { p.nextSpawn = Infinity; p.nextBubble = Infinity; });
  g.boss.nextCore = Infinity;
  g.boss.nextAttack = Infinity;
  return g;
};
const rock = (g, side, letters, y = 0.5) => { const o = spawnRock(g, side, { letters }); o.y = y; return o; };

test('destroying asteroids damages the boss and credits the player', () => {
  const g = boss();
  rock(g, 0, ['B']);
  applyLetter(g, 0, 'B');
  assert.equal(g.boss.hp, BOSS.maxHp - BOSS.killDamagePerLetter);
  assert.equal(g.boss.damageBy[0], BOSS.killDamagePerLetter);
  rock(g, 1, ['C', 'L']);
  applyLetter(g, 1, 'C'); applyLetter(g, 1, 'L');
  assert.equal(g.boss.damageBy[1], 2 * BOSS.killDamagePerLetter);
});

test('impacts drain the shared team pool, not a player', () => {
  const g = boss();
  rock(g, 1, ['B'], 0.999);
  update(g, 0.05);
  assert.equal(g.team.health, BOSS.teamHp - 12);
  assert.equal(g.players[1].health, 100);
});

test('core link must be signed in turn by alternating players', () => {
  const g = boss();
  g.boss.nextCore = 0;
  update(g, 0.01);
  const c = g.boss.core;
  assert.ok(c);
  assert.deepEqual(c.owners, [c.owners[0], 1 - c.owners[0], c.owners[0], 1 - c.owners[0]]);
  const other = 1 - c.owners[0];
  // wrong player can't take the first letter
  assert.notEqual(applyLetter(g, other, c.letters[0]), 'core');
  for (let i = 0; i < 4; i++) assert.equal(applyLetter(g, c.owners[i], c.letters[i]), 'core');
  assert.equal(g.boss.core, null);
  assert.equal(g.boss.hp, BOSS.maxHp - BOSS.coreDamage);
  assert.ok(g.boss.staggerUntil > g.t);
});

test('crossing a phase threshold raises a shield that needs BOTH nodes', () => {
  const g = boss();
  g.boss.hp = Math.floor(BOSS.maxHp * BOSS.phaseAt[0]) + 5;
  rock(g, 0, ['B']);
  applyLetter(g, 0, 'B');
  assert.equal(g.boss.phase, 1);
  assert.ok(g.boss.shield);
  const hpShielded = g.boss.hp;
  rock(g, 0, ['C']);
  applyLetter(g, 0, 'C');
  assert.equal(g.boss.hp, hpShielded, 'invulnerable while shielded');
  const nodes = g.objects.filter((o) => o.kind === 'node');
  assert.equal(nodes.length, 2);
  for (const n of nodes) { n.y = 0.3; for (const L of [...n.letters]) applyLetter(g, n.side, L); }
  assert.equal(g.boss.shield, null);
  assert.ok(drainEvents(g).some((e) => e.type === 'bossShieldBreak'));
});

test('an expired shield node heals the boss and drops the shield', () => {
  const g = boss();
  g.boss.hp = Math.floor(BOSS.maxHp * BOSS.phaseAt[0]) + 5;
  rock(g, 0, ['B']);
  applyLetter(g, 0, 'B');
  const hp = g.boss.hp;
  update(g, BOSS.shieldLife + 0.1);
  assert.equal(g.boss.shield, null);
  assert.ok(g.boss.hp > hp);
  assert.ok(g.boss.hp <= Math.floor(BOSS.maxHp * BOSS.phaseAt[0]));
  assert.equal(g.objects.filter((o) => o.kind === 'node').length, 0);
});

test('boss telegraphs, then attacks both sides with a volley', () => {
  const g = boss(4);
  g.boss.nextAttack = 0;
  let tele = null;
  for (let i = 0; i < 40 && !tele; i++) { update(g, 0.05); tele = drainEvents(g).find((e) => e.type === 'bossTelegraph'); }
  assert.ok(tele);
  g.boss.telegraph.kind = 'volley'; g.boss.telegraph.side = -1;
  update(g, BOSS.telegraph + 0.05);
  update(g, 1);
  assert.ok(g.objects.some((o) => o.side === 0 && o.fromBoss));
  assert.ok(g.objects.some((o) => o.side === 1 && o.fromBoss));
});

test('reflect turns a boss attack into boss damage', () => {
  const g = boss();
  activateEffect(g, 0, 'reflect');
  g.boss.nextAttack = 0;
  update(g, 0.01);
  g.boss.telegraph.kind = 'meteor'; g.boss.telegraph.side = 0;
  update(g, BOSS.telegraph + 0.05);
  assert.equal(g.objects.filter((o) => o.side === 0).length, 0);
  assert.equal(g.boss.hp, BOSS.maxHp - BOSS.reflectDamage);
});

test('co-op orbs: attack hits the boss, leech and heal restore the team, slow slows the boss', () => {
  const g = boss();
  g.team.health = 100;
  activateEffect(g, 0, 'attack');
  assert.equal(g.boss.hp, BOSS.maxHp - BOSS.attackOrbDamage);
  activateEffect(g, 1, 'leech');
  assert.equal(g.team.health, 100 + BOSS.leechHeal);
  activateEffect(g, 1, 'heal');
  assert.equal(g.team.health, 132);
  activateEffect(g, 0, 'slow');
  assert.ok(g.boss.slowUntil > g.t);
  assert.equal(g.players[1].slowUntil, 0, 'teammate is not slowed');
});

test('victory when the boss falls, defeat when the team pool empties', () => {
  const g = boss();
  g.boss.hp = 5;
  rock(g, 0, ['B']);
  applyLetter(g, 0, 'B');
  update(g, 0.01);
  assert.equal(g.over, true);
  assert.equal(g.winner, 'team');
  const h = boss();
  h.team.health = 5;
  rock(h, 0, ['B'], 0.999);
  update(h, 0.05);
  assert.equal(h.winner, 'boss');
});

test('an unattended boss fight ends in defeat', () => {
  const g = createGame({ letters: LETTERS, seed: 9, mode: 'boss' });
  for (let i = 0; i < 20 * 60 * 15 && !g.over; i++) update(g, 1 / 20);
  assert.equal(g.winner, 'boss');
});

test('co-op power-ups are shared by the whole team', () => {
  const g = boss();
  activateEffect(g, 0, 'shield');
  assert.ok(g.players[0].shieldUntil > g.t && g.players[1].shieldUntil > g.t);
  activateEffect(g, 1, 'haste');
  assert.ok(g.players[0].hasteUntil > g.t && g.players[1].hasteUntil > g.t);
  rock(g, 0, ['B']); rock(g, 1, ['C']); rock(g, 1, ['L']);
  activateEffect(g, 0, 'nova');
  assert.equal(g.objects.filter((o) => o.kind === 'rock').length, 0);
  const ev = drainEvents(g).filter((e) => e.type === 'effect' && e.effect === 'nova');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].shared, true);
  assert.equal(ev[0].count, 3);
});

test('versus power-ups stay personal', () => {
  const g = createGame({ letters: LETTERS, seed: 1 });
  activateEffect(g, 0, 'shield');
  assert.ok(g.players[0].shieldUntil > g.t);
  assert.equal(g.players[1].shieldUntil, 0);
});

// ---- co-op options ----
const coop = (opts) => {
  const g = createGame({ letters: LETTERS, seed: 1, mode: 'boss', ...opts });
  g.players.forEach((p) => { p.nextSpawn = Infinity; p.nextBubble = Infinity; });
  g.boss.nextCore = Infinity;
  g.boss.nextAttack = Infinity;
  return g;
};

test('power-up sharing can be turned off', () => {
  const g = coop({ shareOrbs: false });
  activateEffect(g, 0, 'shield');
  assert.ok(g.players[0].shieldUntil > g.t);
  assert.equal(g.players[1].shieldUntil, 0);
  rock(g, 0, ['B']); rock(g, 1, ['C']);
  activateEffect(g, 0, 'nova');
  assert.equal(g.objects.filter((o) => o.side === 1).length, 1, 'nova only clears own side');
  // team-level orbs still hit the boss / heal the team
  activateEffect(g, 1, 'attack');
  assert.ok(g.boss.hp < BOSS.maxHp);
});

test('shared targets: a sign hits matching targets on BOTH sides, credited to the signer', () => {
  const g = coop({ shareTargets: true });
  const mine = rock(g, 0, ['B'], 0.2);
  const theirs = rock(g, 1, ['B'], 0.8);
  const other = rock(g, 1, ['C'], 0.5);
  applyLetter(g, 0, 'B');
  assert.ok(!g.objects.includes(mine) && !g.objects.includes(theirs));
  assert.ok(g.objects.includes(other));
  assert.equal(g.players[0].destroyed, 2, 'credited to the shooter');
  assert.equal(g.boss.damageBy[0], 2 * BOSS.killDamagePerLetter);
  const hits = drainEvents(g).filter((e) => e.type === 'hit');
  assert.deepEqual(hits.map((e) => e.targetSide), [1, 0], 'most urgent first');
});

test('a core letter also blasts matching asteroids', () => {
  const g = coop({});
  g.boss.nextCore = 0;
  update(g, 0.01);
  const c = g.boss.core;
  const o = rock(g, c.owners[0], [c.letters[0]], 0.5);
  assert.equal(applyLetter(g, c.owners[0], c.letters[0]), 'core');
  assert.equal(c.idx, 1);
  assert.ok(!g.objects.includes(o));
});

test('personal targets: a player cannot shoot the other side', () => {
  const g = coop({ shareTargets: false });
  rock(g, 1, ['B'], 0.8);
  assert.equal(applyLetter(g, 0, 'B'), null);
});

test('shared targets spawn asteroids more often', () => {
  const count = (shareTargets) => {
    const g = createGame({ letters: LETTERS, seed: 5, mode: 'boss', shareTargets });
    g.boss.nextAttack = Infinity; g.boss.nextCore = Infinity;
    let n = 0;
    for (let i = 0; i < 20 * 60; i++) { update(g, 1 / 20); n += drainEvents(g).filter((e) => e.type === 'spawn' && !e.fromBoss).length; g.objects = []; }
    return n;
  };
  const personal = count(false);
  const shared = count(true);
  assert.ok(shared > personal * 1.6, `shared ${shared} vs personal ${personal}`);
});

test('shared targets: a letter the teammate already cleared does not break your combo', () => {
  const g = coop({ shareTargets: true });
  g.players[1].combo = 5;
  rock(g, 0, ['B'], 0.6);
  applyLetter(g, 0, 'B');
  assert.equal(applyLetter(g, 1, 'B'), null);
  assert.equal(g.players[1].combo, 5);
});

test('shared targets: each side gets its own random stream; versus stays mirrored', () => {
  const words = (opts) => {
    const g = createGame({ letters: LETTERS, seed: 21, ...opts });
    if (g.boss) { g.boss.nextAttack = Infinity; g.boss.nextCore = Infinity; }
    const seen = [[], []];
    for (let i = 0; i < 20 * 40; i++) {
      update(g, 1 / 20);
      for (const e of drainEvents(g)) if (e.type === 'spawn' && !e.fromBoss) seen[e.side].push(g.objects.find((o) => o.id === e.id).letters.join(''));
      g.objects = g.objects.filter((o) => o.y < 0.5);
    }
    return seen;
  };
  const shared = words({ mode: 'boss', shareTargets: true });
  assert.notDeepEqual(shared[0], shared[1]);
  const versus = words({});
  assert.deepEqual(versus[0], versus[1]);
});

test('shared targets: duplicates of letters in play are reduced but still possible', () => {
  const GAME = ['B', 'C', 'F', 'H', 'I', 'K', 'L', 'N', 'O', 'Q', 'V', 'W', 'X', 'Y'];
  let dup = 0;
  let expected = 0; // what pure chance would give: |letters in play| / |alphabet| per spawn
  for (let seed = 1; seed <= 40; seed++) {
    const g = createGame({ letters: GAME, seed, mode: 'boss', shareTargets: true });
    g.boss.nextAttack = Infinity; g.boss.nextCore = Infinity;
    for (let i = 0; i < 20 * 30; i++) {
      const live = new Set(g.objects.map((o) => o.letters[o.idx]));
      update(g, 1 / 20);
      for (const e of drainEvents(g)) {
        if (e.type !== 'spawn' || e.fromBoss) continue;
        const first = g.objects.find((o) => o.id === e.id).letters[0];
        expected += live.size / GAME.length;
        if (live.has(first)) dup++;
        live.add(first);
      }
      g.objects = g.objects.filter((o) => o.y < 0.6); // asteroids get cleared as in play
    }
  }
  assert.ok(dup > 0, 'duplicates still happen');
  assert.ok(dup < expected * 0.8, `duplicates reduced: ${dup} vs ~${Math.round(expected)} by pure chance`);
});

// ---- continuous difficulty ----

test('boss has 3x health and difficulty rises continuously as it weakens', () => {
  assert.equal(BOSS.maxHp, 4500);
  const g = boss();
  const at = (frac) => { g.boss.hp = Math.round(BOSS.maxHp * frac); g.boss.shield = null; update(g, 0.001); return g.level; };
  const levels = [1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0.02].map(at);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], `level rises: ${levels.map((l) => l.toFixed(2))}`);
  assert.ok(Math.abs(levels[0] - BOSS.levelRange[0]) < 1e-6);
  assert.ok(levels.at(-1) > BOSS.levelRange[1] - 0.2);
  // spawn pacing and fall speed follow smoothly (no plateaus between phases)
  const sp = levels.map((l) => difficulty(l).spawnInterval);
  for (let i = 1; i < sp.length; i++) assert.ok(sp[i] < sp[i - 1]);
});

test('boss attack and core timers tighten with damage taken; phases still trigger at 66% / 33%', () => {
  const g = boss();
  g.boss.nextAttack = 0;
  update(g, 0.01);
  g.boss.telegraph.at = g.boss.clock; // fire now
  update(g, 0.01);
  const fullGap = g.boss.nextAttack - g.boss.clock;
  const h = boss();
  h.boss.hp = Math.round(BOSS.maxHp * 0.1);
  h.boss.phase = 2;
  h.boss.nextAttack = 0;
  update(h, 0.01);
  h.boss.telegraph.at = h.boss.clock;
  update(h, 0.01);
  const lowGap = h.boss.nextAttack - h.boss.clock;
  assert.ok(lowGap < fullGap - 1.5, `attacks come faster: ${fullGap.toFixed(2)}s -> ${lowGap.toFixed(2)}s`);
  // phase thresholds unchanged
  const p = boss();
  p.boss.hp = Math.floor(BOSS.maxHp * BOSS.phaseAt[1]) + 5;
  p.boss.phase = 1;
  rock(p, 0, ['B']);
  applyLetter(p, 0, 'B');
  assert.equal(p.boss.phase, 2);
  assert.ok(p.boss.shield);
});
