// Pure game simulation: no DOM, no rendering. The presentation layer reads `game` and
// drains `game.events` every frame.
//
// Coordinates are per side: x in [0,1] across that player's half, y in [0,1] from the top of
// the playfield (0) to the base (1).
import { BALANCE, EFFECT_KEYS, OFFENSIVE } from './effects.js';
import { makeRng } from './rng.js';
import { liveLetters, randomWord } from './words.js';
import {
  BOSS, bossDamage, bossEffect, bossOver, coreLetter, initBoss, nodeCleared, nodeExpired, teamDamage, updateBoss,
} from './boss.js';

export const LEVEL_SECONDS = 22;
export const MAX_LEVEL = 12;

/** Difficulty curve. Exported for tests and the README. */
/**
 * Difficulty curve. `level` may be fractional (the co-op boss scales it continuously with its
 * health): speeds and intervals interpolate smoothly, the discrete parts (word lengths, how many
 * asteroids fit on screen) step at whole levels.
 */
export function difficulty(level) {
  const L = Math.min(Math.max(level, 1), MAX_LEVEL);
  const Li = Math.floor(L);
  const seq = Li <= 1 ? [[1, 1]]
    : Li === 2 ? [[1, 0.8], [2, 0.2]]
    : Li === 3 ? [[1, 0.6], [2, 0.35], [3, 0.05]]
    : Li <= 5 ? [[1, 0.45], [2, 0.35], [3, 0.2]]
    : Li <= 8 ? [[1, 0.35], [2, 0.35], [3, 0.2], [4, 0.1]]
    : [[1, 0.3], [2, 0.3], [3, 0.25], [4, 0.15]];
  return {
    level: L,
    spawnInterval: Math.max(1.05, 3.0 - 0.2 * (L - 1)),
    fallTime: Math.max(5.2, 10.5 - 0.5 * (L - 1)),
    maxActive: Math.min(7, 2 + Li),
    seq,
    bubbleInterval: Math.max(11, 18 - 0.6 * (L - 1)),
    bubbleLength: Li < 4 ? 3 : 4,
    bubbleLife: Math.max(7.5, 10 - 0.25 * (L - 1)),
  };
}

export function comboMultiplier(combo) {
  return Math.min(3, 1 + 0.25 * Math.floor(combo / 3));
}

export function impactDamage(remainingLetters) {
  return 12 + 6 * (remainingLetters - 1);
}

function newPlayer(i) {
  return {
    index: i,
    health: BALANCE.maxHealth,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0, // letters that hit a target
    misses: 0, // confirmed letters with no target
    destroyed: 0,
    impacts: 0,
    bubbles: 0,
    shieldUntil: 0,
    slowUntil: 0,
    freezeUntil: 0,
    hasteUntil: 0,
    reflectUntil: 0,
    graceUntil: { attack: 0, slow: 0, leech: 0 }, // victim protection
    cooldown: { attack: 0, slow: 0, freeze: 0, nova: 0, haste: 0, leech: 0 }, // per-user cooldown
    nextSpawn: 1.2,
    nextBubble: 26,
    alive: true,
  };
}

export function createGame({
  letters, seed = Date.now() & 0xffff, startLevel = 1, mode = 'versus', shareOrbs = true, shareTargets = false,
} = {}) {
  if (!letters?.length) throw new Error('createGame needs a letter set');
  const g = {
    mode, // 'versus' | 'boss'
    // Co-op options (ignored in versus):
    shareOrbs, // Shield/Freeze/Haste/Reflect/Nova apply to both players
    shareTargets, // either player may shoot anything on either side; spawns are more frequent
    letters,
    t: 0,
    level: startLevel,
    startLevel,
    over: false,
    winner: null, // 0 | 1 | 'draw'
    players: [newPlayer(0), newPlayer(1)],
    objects: [],
    events: [],
    nextId: 1,
    // Identical seeds -> both players get the same asteroid stream (fair duel).
    // Shared-target co-op: one sign clears matching letters on both sides, so mirrored streams
    // would hand out free kills; each side gets its own stream there.
    spawnRng: [makeRng(seed), makeRng(mode === 'boss' && shareTargets ? seed ^ 0x5bd1e995 : seed)],
    fxRng: [makeRng(seed ^ 0x9e37), makeRng(seed ^ 0x9e37)],
    pendingAttacks: [],
  };
  if (mode === 'boss') initBoss(g);
  return g;
}

const isBoss = (g) => g.mode === 'boss';
const sharedTargets = (g) => isBoss(g) && g.shareTargets;

// Co-op spawn pacing: personal targets spawn 1.6x slower than versus (two players, one boss);
// shared targets spawn faster (0.8x) with more on screen, since either player can clear them.
export const SHARED_TARGET_SPAWN = 0.8;
export const SHARED_TARGET_EXTRA_ACTIVE = 2;

const isFrozen = (g, side) => g.players[side].freezeUntil > g.t;


function pickX(g, side, rng) {
  // Spread asteroids out: try a few lanes and keep the one furthest from recent spawns.
  const recent = g.objects.filter((o) => o.side === side && o.y < 0.35).map((o) => o.x);
  let best = 0.5;
  let bestD = -1;
  for (let i = 0; i < 5; i++) {
    const x = rng.range(0.14, 0.86);
    const d = recent.length ? Math.min(...recent.map((r) => Math.abs(r - x))) : 1;
    if (d > bestD) { bestD = d; best = x; }
  }
  return best;
}

export function spawnRock(g, side, { letters, hostile = false, speedScale = 1, rng = g.spawnRng[side], meteor = false, boss = false } = {}) {
  const d = difficulty(g.level);
  const len = letters ? letters.length : rng.weighted(d.seq);
  const word = letters ?? randomWord(rng, g.letters, len, liveLetters(g));
  const fall = d.fallTime * (1 + 0.45 * (word.length - 1)) / speedScale;
  const o = {
    id: g.nextId++,
    side,
    kind: 'rock',
    hostile,
    letters: word,
    idx: 0,
    x: pickX(g, side, rng),
    y: -0.06,
    speed: 1.06 / fall,
    r: (0.055 + 0.012 * (word.length - 1)) * (meteor ? 1.25 : 1),
    meteor,
    fromBoss: boss || meteor,
    seed: rng.int(0, 1e6),
    born: g.t,
    dying: false,
  };
  g.objects.push(o);
  g.events.push({ type: 'spawn', side, id: o.id, hostile, fromBoss: o.fromBoss, x: o.x });
  return o;
}

export function spawnBubble(g, side, effect) {
  const p = g.players[side];
  const rng = g.fxRng[side];
  const d = difficulty(g.level);
  if (!effect) {
    const opp = g.players[1 - side];
    const options = [];
    if (isBoss(g)) return spawnBubble(g, side, rng.weighted(coopOptions(g, p)));
    if (g.t >= p.cooldown.attack && g.t >= opp.graceUntil.attack) options.push(['attack', 3]);
    if (g.t >= p.cooldown.slow && g.t >= opp.graceUntil.slow && opp.slowUntil <= g.t) options.push(['slow', 2]);
    if (p.shieldUntil <= g.t) options.push(['shield', 2]);
    if (p.health < BALANCE.maxHealth - 5) options.push(['heal', p.health < 50 ? 4 : 2]);
    if (g.t >= p.cooldown.freeze) options.push(['freeze', 2]);
    const crowd = g.objects.filter((o) => o.side === side && o.kind === 'rock').length;
    if (g.t >= p.cooldown.nova) options.push(['nova', crowd >= 3 ? 3 : 1]);
    if (g.t >= p.cooldown.haste && p.hasteUntil <= g.t) options.push(['haste', 2]);
    if (p.reflectUntil <= g.t) options.push(['reflect', 1.5]);
    if (g.t >= p.cooldown.leech && g.t >= opp.graceUntil.leech && opp.health > 25) options.push(['leech', 2]);
    if (!options.length) options.push(['shield', 1]);
    effect = rng.weighted(options);
  }
  const o = {
    id: g.nextId++,
    side,
    kind: 'bubble',
    effect,
    letters: randomWord(rng, g.letters, d.bubbleLength, liveLetters(g)),
    idx: 0,
    x: rng.range(0.25, 0.75),
    x0: 0,
    y: -0.1,
    r: 0.085,
    life: d.bubbleLife,
    age: 0,
    seed: rng.int(0, 1e6),
    born: g.t,
    dying: false,
  };
  o.x0 = o.x;
  g.objects.push(o);
  g.events.push({ type: 'bubbleSpawn', side, id: o.id, effect });
  return o;
}

/** Orb options in co-op: offensive orbs hit the boss, Heal/Leech restore the team pool. */
function coopOptions(g, p) {
  const o = [['attack', 3], ['shield', 2], ['nova', 2], ['haste', 2]];
  if (g.boss.slowUntil <= g.t) o.push(['slow', 2]);
  if (g.team.health < g.team.max - 5) o.push(['heal', g.team.health < g.team.max / 2 ? 4 : 2], ['leech', 2]);
  if (g.t >= p.cooldown.freeze) o.push(['freeze', 2]);
  if (p.reflectUntil <= g.t) o.push(['reflect', 1.5]);
  return o;
}

const floats = (o) => o.kind === 'bubble' || o.kind === 'node';

/** Seconds until the object stops being destroyable (impact for rocks, expiry for bubbles). */
export function urgency(o) {
  if (floats(o)) return o.life - o.age;
  return Math.max(0, (1 - o.y) / o.speed);
}

/**
 * Targeting rule: among the player's objects whose NEXT required letter matches, choose the
 * one with the least time left (closest to impact / expiry). Ties go to the older object.
 * Co-op with shared targets: objects on BOTH sides are candidates; ties prefer the player's own
 * side, then the older object.
 */
export function findTarget(g, side, letter) {
  return findTargets(g, side, letter)[0] ?? null;
}

/**
 * Every object a player's letter applies to: their own side's objects (both sides with co-op
 * shared targets) whose NEXT required letter matches, most urgent first (least time left;
 * ties: own side, then older). Signing a letter hits ALL of them at once.
 */
export function findTargets(g, side, letter) {
  const anySide = sharedTargets(g);
  const out = [];
  for (const o of g.objects) {
    if ((!anySide && o.side !== side) || o.dying || o.letters[o.idx] !== letter) continue;
    if (o.kind === 'rock' && o.y < 0) continue; // not on screen yet
    out.push(o);
  }
  return out.sort((a, b) => urgency(a) - urgency(b) || (b.side === side) - (a.side === side) || a.id - b.id);
}

// Bonus for clearing several targets with one sign.
export const MULTI_BONUS = 100;

export function applyLetter(g, side, letter) {
  if (g.over) return null;
  const p = g.players[side];
  const core = isBoss(g) && coreLetter(g, side, letter);
  if (core) p.score += 50;
  const targets = findTargets(g, side, letter);
  if (!targets.length) {
    if (core) return 'core';
    p.misses++;
    // Shared targets: both players see the same "next" target, so one often signs a letter the
    // teammate has just cleared. That shouldn't cost a combo.
    const soft = sharedTargets(g);
    if (!soft) {
      if (p.combo >= 3) g.events.push({ type: 'comboBreak', side, combo: p.combo });
      p.combo = 0;
    }
    g.events.push({ type: 'miss', side, letter, soft });
    return null;
  }
  if (!core) p.hits++; // one sign = one letter (accuracy), however many targets it hits
  let kills = 0;
  for (const o of targets) {
    if (o.dying || !g.objects.includes(o)) continue; // e.g. swept away by a Nova cleared in this same sign
    o.idx++;
    const complete = o.idx >= o.letters.length;
    g.events.push({ type: 'hit', side, id: o.id, letter, complete, x: o.x, y: o.y, kind: o.kind, targetSide: o.side });
    if (!complete) {
      p.score += 25;
      continue;
    }
    kills++;
    o.dying = true;
    p.combo++;
    p.maxCombo = Math.max(p.maxCombo, p.combo);
    const mult = comboMultiplier(p.combo);
    const gained = Math.round((o.kind === 'rock' ? 100 * o.letters.length : 300) * mult);
    p.score += gained;
    g.objects = g.objects.filter((x) => x !== o);
    if (o.kind === 'bubble') {
      p.bubbles++;
      activateEffect(g, side, o.effect, { x: o.x, y: o.y });
      if (isBoss(g)) bossDamage(g, side, BOSS.bubbleDamage, { x: o.x, y: o.y, side: o.side });
    } else if (o.kind === 'node') {
      nodeCleared(g, o.side);
    } else {
      p.destroyed++;
      if (isBoss(g)) bossDamage(g, side, BOSS.killDamagePerLetter * o.letters.length * mult, { x: o.x, y: o.y, side: o.side });
    }
    g.events.push({ type: 'destroy', side, id: o.id, obj: o, score: gained, combo: p.combo, mult });
  }
  if (kills >= 2) {
    const bonus = MULTI_BONUS * (kills - 1);
    p.score += bonus;
    g.events.push({ type: 'multi', side, count: kills, bonus, letter });
  }
  return core ? 'core' : targets;
}

/** Effects that benefit the player who cleared the orb (both players in co-op: shared). */
function applySelfEffect(g, side, effect, extra) {
  const p = g.players[side];
  const B = BALANCE;
  switch (effect) {
    case 'shield':
      p.shieldUntil = g.t + B.shieldDuration;
      break;
    case 'heal':
      p.health = Math.min(B.maxHealth, p.health + B.healAmount);
      break;
    case 'freeze':
      p.freezeUntil = g.t + B.freezeDuration;
      p.cooldown.freeze = g.t + B.freezeCooldown;
      break;
    case 'haste':
      p.hasteUntil = g.t + B.hasteDuration;
      p.cooldown.haste = g.t + B.hasteCooldown;
      break;
    case 'reflect':
      p.reflectUntil = g.t + B.reflectDuration;
      break;
    case 'nova': {
      // Detonate every asteroid on this side that is on screen (incoming attack rocks too).
      const hit = g.objects.filter((o) => o.side === side && o.kind === 'rock' && o.y > -0.05);
      const mult = comboMultiplier(p.combo);
      for (const o of hit) {
        o.dying = true;
        const gained = Math.round(50 * o.letters.length * mult);
        p.score += gained;
        p.destroyed++;
        g.events.push({ type: 'destroy', side, id: o.id, obj: o, score: gained, combo: p.combo, mult, nova: true });
        if (isBoss(g)) bossDamage(g, side, BOSS.killDamagePerLetter * o.letters.length * 0.5, { x: o.x, y: o.y });
      }
      g.objects = g.objects.filter((o) => !hit.includes(o));
      p.cooldown.nova = g.t + B.novaCooldown;
      extra.count = hit.length;
      break;
    }
    default:
  }
}

export function activateEffect(g, side, effect, origin = null) {
  const p = g.players[side];
  const B = BALANCE;
  if (isBoss(g)) {
    const extra = {};
    if (bossEffect(g, side, effect, extra)) {
      g.events.push({ type: 'effect', side, effect, target: side, reflected: false, origin, coop: true, ...extra });
      return;
    }
    // Co-op: every other power-up is shared by the whole team (unless sharing is turned off).
    extra.count = 0;
    for (const s2 of g.shareOrbs ? [0, 1] : [side]) {
      const e2 = {};
      applySelfEffect(g, s2, effect, e2);
      extra.count += e2.count ?? 0;
    }
    g.events.push({ type: 'effect', side, effect, target: side, reflected: false, origin, coop: true, shared: g.shareOrbs, ...extra });
    return;
  }
  // Offensive effects hit the opponent, unless they hold a Reflect: then it bounces back.
  let target = OFFENSIVE.includes(effect) ? 1 - side : side;
  let reflected = false;
  if (target !== side && g.players[target].reflectUntil > g.t) {
    g.players[target].reflectUntil = 0;
    g.events.push({ type: 'reflect', side: target, to: side, effect });
    target = side;
    reflected = true;
  }
  const victim = g.players[target];
  const extra = {};
  switch (effect) {
    case 'attack': {
      const n = Math.min(4, 2 + Math.floor(g.level / 4));
      for (let i = 0; i < n; i++) g.pendingAttacks.push({ side: target, at: g.t + B.attackWarning + i * 0.55 });
      p.cooldown.attack = g.t + B.offenseCooldown;
      victim.graceUntil.attack = g.t + B.attackWarning + n * 0.55 + B.victimGrace;
      g.events.push({ type: 'attackIncoming', side: target, from: side, count: n });
      break;
    }
    case 'slow':
      victim.slowUntil = g.t + B.slowDuration;
      p.cooldown.slow = g.t + B.offenseCooldown;
      victim.graceUntil.slow = g.t + B.slowDuration + B.victimGrace;
      break;
    case 'leech': {
      // Never lethal on its own: the victim keeps at least 1 HP.
      const amount = Math.max(0, Math.min(B.leechAmount, victim.health - 1));
      const gainer = g.players[1 - target];
      victim.health -= amount;
      const before = gainer.health;
      gainer.health = Math.min(B.maxHealth, gainer.health + amount);
      extra.gained = gainer.health - before;
      p.cooldown.leech = g.t + B.leechCooldown;
      victim.graceUntil.leech = g.t + B.victimGrace;
      extra.amount = amount;
      break;
    }
    case 'shield':
    case 'heal':
    case 'freeze':
    case 'haste':
    case 'reflect':
    case 'nova':
      applySelfEffect(g, side, effect, extra);
      break;
    default:
      throw new Error(`unknown effect ${effect}`);
  }
  g.events.push({ type: 'effect', side, effect, target, reflected, origin, ...extra });
}

export function confirmSpeed(g, side) {
  const p = g.players[side];
  return (p.slowUntil > g.t ? BALANCE.slowFactor : 1) * (p.hasteUntil > g.t ? BALANCE.hasteFactor : 1);
}

export function update(g, dt) {
  if (g.over) return;
  g.t += dt;
  const newLevel = isBoss(g) ? g.level : Math.min(MAX_LEVEL, g.startLevel + Math.floor(g.t / LEVEL_SECONDS));
  if (newLevel !== g.level) {
    g.level = newLevel;
    g.events.push({ type: 'levelUp', level: newLevel });
  }
  const d = difficulty(g.level);

  for (const side of [0, 1]) {
    const p = g.players[side];
    if (p.shieldUntil && p.shieldUntil <= g.t && p.shieldUntil > g.t - dt) g.events.push({ type: 'shieldExpire', side });
    const frozen = isFrozen(g, side);
    if (frozen) {
      p.nextSpawn += dt;
      p.nextBubble += dt;
      continue;
    }
    const active = g.objects.filter((o) => o.side === side && o.kind === 'rock' && !o.hostile).length;
    if (g.t >= p.nextSpawn) {
      const maxActive = d.maxActive + (sharedTargets(g) ? SHARED_TARGET_EXTRA_ACTIVE : 0);
      if (active < maxActive) spawnRock(g, side);
      const pace = !isBoss(g) ? 1 : sharedTargets(g) ? SHARED_TARGET_SPAWN : BOSS.spawnSlowdown;
      p.nextSpawn = g.t + d.spawnInterval * pace;
    }
    if (g.t >= p.nextBubble) {
      if (!g.objects.some((o) => o.side === side && o.kind === 'bubble')) spawnBubble(g, side);
      p.nextBubble = g.t + d.bubbleInterval;
    }
  }

  if (isBoss(g)) updateBoss(g, dt, spawnRock);

  // Delayed attack rocks (Attack orbs in versus, boss volleys/barrages in co-op).
  g.pendingAttacks = g.pendingAttacks.filter((a) => {
    if (a.at > g.t) return true;
    if (isFrozen(g, a.side)) { a.at = g.t + 0.3; return true; }
    spawnRock(g, a.side, {
      letters: a.letters ?? [g.fxRng[a.side].pick(g.letters)], hostile: true, speedScale: a.speedScale ?? 1.15,
      rng: g.fxRng[a.side], boss: !!a.boss,
    });
    return false;
  });

  // Movement, impacts and bubble expiry.
  const survivors = [];
  for (const o of g.objects) {
    if (isFrozen(g, o.side)) { survivors.push(o); continue; }
    if (floats(o)) {
      o.age += dt;
      const settle = Math.min(1, o.age / 1.6);
      o.y = -0.1 + settle * 0.42 + Math.sin(o.age * 1.3 + o.seed) * 0.03;
      o.x = o.x0 + Math.sin(o.age * 0.7 + o.seed * 0.1) * 0.12;
      if (o.age >= o.life) {
        if (o.kind === 'node') { nodeExpired(g); continue; }
        g.events.push({ type: 'bubbleExpire', side: o.side, id: o.id, obj: o });
        continue;
      }
    } else {
      o.y += o.speed * dt;
      if (o.y >= 1) {
        impact(g, o);
        continue;
      }
    }
    survivors.push(o);
  }
  g.objects = survivors;

  if (isBoss(g)) {
    g.objects = g.objects.filter((o) => o.kind !== 'node' || g.boss.shield); // nodes vanish with the shield
    const result = bossOver(g);
    if (result) {
      g.over = true;
      g.winner = result; // 'team' | 'boss'
      g.events.push({ type: 'gameOver', winner: result });
    }
    return;
  }

  // Win condition: the last player with health remaining wins.
  const dead = g.players.map((p) => p.health <= 0);
  if (dead[0] || dead[1]) {
    g.over = true;
    if (dead[0] && dead[1]) {
      const [a, b] = g.players.map((p) => p.score);
      g.winner = a === b ? 'draw' : a > b ? 0 : 1;
    } else g.winner = dead[0] ? 1 : 0;
    g.players.forEach((p, i) => { p.alive = !dead[i]; });
    g.events.push({ type: 'gameOver', winner: g.winner });
  }
}

function impact(g, o) {
  const p = g.players[o.side];
  if (p.shieldUntil > g.t) {
    p.shieldUntil = 0;
    g.events.push({ type: 'shieldBlock', side: o.side, id: o.id, obj: o });
    return;
  }
  const dmg = impactDamage(o.letters.length - o.idx);
  if (isBoss(g)) teamDamage(g, dmg);
  else p.health = Math.max(0, p.health - dmg);
  p.impacts++;
  if (p.combo >= 3) g.events.push({ type: 'comboBreak', side: o.side, combo: p.combo });
  p.combo = 0;
  g.events.push({ type: 'impact', side: o.side, id: o.id, obj: o, damage: dmg });
}

export function drainEvents(g) {
  const e = g.events;
  g.events = [];
  return e;
}

export { EFFECT_KEYS };
