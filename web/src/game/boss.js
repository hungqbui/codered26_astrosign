// Co-op boss fight: both players against one boss, sharing a team health pool.
//
// * Every asteroid a player destroys damages the boss (bolts fly from the wreck to the boss).
// * The boss telegraphs attacks (~1.3 s): volley (both sides), meteor (long word on one side),
//   barrage (rapid singles on one side, phase 2+), curse (slows one player, phase 2+).
// * Core link: the boss periodically opens its core, showing a 4-letter chain whose letters
//   alternate between the players. Signing it in turn deals heavy damage and staggers the boss.
//   Targeting rule: while the core is open, a player's letter goes to the core first if the
//   core's next letter is theirs and matches; otherwise the normal closest-to-impact rule applies.
// * At 66% and 33% HP the boss raises a shield: invulnerable until BOTH players break the shield
//   node on their side. If a node expires the boss heals and the shield drops.
// Pure logic (no DOM); engine.js calls these hooks when g.mode === 'boss'.

import { liveLetters, randomWord } from './words.js';

export const BOSS = {
  name: 'THE SILENCER', // an all-seeing eye that drowns out communication; you fight back by signing
  maxHp: 4500,
  teamHp: 150,
  phaseAt: [0.66, 0.33], // HP fractions that start phase 2 and 3
  // Difficulty scales CONTINUOUSLY with damage dealt (full health -> nearly dead), independent of
  // the three phases (which still bring the shield, colour change and new attack types).
  levelRange: [2, 8], // asteroid difficulty level (see engine.difficulty)
  spawnSlowdown: 1.6, // regular asteroid spawns are this much slower than in versus
  attackInterval: [6.5, 3.8],
  telegraph: 1.3,
  coreInterval: [20, 13],
  coreLife: [11, 8.5],
  coreDamage: 150,
  stagger: 3,
  shieldLife: 15,
  shieldFailHeal: 0.08,
  killDamagePerLetter: 10,
  bubbleDamage: 20,
  attackOrbDamage: 60,
  leechDamage: 40,
  leechHeal: 12,
  reflectDamage: 50,
  slowDuration: 6,
  curseDuration: 4,
};

export function initBoss(g) {
  g.team = { health: BOSS.teamHp, max: BOSS.teamHp };
  g.boss = {
    hp: BOSS.maxHp,
    maxHp: BOSS.maxHp,
    phase: 0,
    clock: 0, // boss-time: slowed by Slow, paused while staggered
    nextAttack: 5,
    telegraph: null, // { kind, side, at }
    core: null, // { letters, owners, idx, until }
    nextCore: 14,
    shield: null, // { nodes: [id|null, id|null], cleared: [bool, bool], until }
    slowUntil: 0,
    staggerUntil: 0,
    damageBy: [0, 0],
    lastAttackSide: 1,
  };
  g.level = BOSS.levelRange[0];
}

const rngFor = (g) => g.fxRng[0];

/** 0 at full health -> 1 when the boss is dead. */
export function bossProgress(g) {
  return 1 - g.boss.hp / g.boss.maxHp;
}

/** Interpolate a [atFullHealth, nearlyDead] pair by how much damage the boss has taken. */
function scaled(g, [from, to]) {
  return from + (to - from) * bossProgress(g);
}

export function teamDamage(g, n) {
  g.team.health = Math.max(0, g.team.health - n);
}

export function teamHeal(g, n) {
  const before = g.team.health;
  g.team.health = Math.min(g.team.max, g.team.health + n);
  return g.team.health - before;
}

export function bossShielded(g) {
  return !!g.boss.shield;
}

/** Deal damage to the boss from a player. src = {x, y} on that player's side (for the bolt). */
export function bossDamage(g, side, amount, src = null, reason = 'kill') {
  const b = g.boss;
  if (b.hp <= 0) return 0;
  if (b.shield) {
    g.events.push({ type: 'bossBlocked', side, src });
    return 0;
  }
  const dmg = Math.min(b.hp, Math.round(amount));
  b.hp -= dmg;
  b.damageBy[side] += dmg;
  g.players[side].bossDamage = (g.players[side].bossDamage ?? 0) + dmg;
  g.events.push({ type: 'bossHit', side, amount: dmg, src, reason });
  const frac = b.hp / b.maxHp;
  if (b.phase < BOSS.phaseAt.length && frac <= BOSS.phaseAt[b.phase] && b.hp > 0) enterPhase(g, b.phase + 1);
  return dmg;
}

function enterPhase(g, phase) {
  const b = g.boss;
  b.phase = phase;
  b.telegraph = null;
  b.core = null;
  g.events.push({ type: 'bossPhase', phase });
  raiseShield(g);
}

function raiseShield(g) {
  const b = g.boss;
  const nodes = [0, 1].map((side) => spawnNode(g, side));
  b.shield = { nodes: nodes.map((n) => n.id), cleared: [false, false], until: g.t + BOSS.shieldLife };
  g.events.push({ type: 'bossShield' });
}

function spawnNode(g, side) {
  const rng = g.fxRng[side];
  const letters = [];
  for (let i = 0; i < 4; i++) {
    let L;
    do { L = rng.pick(g.letters); } while (g.letters.length > 1 && L === letters[i - 1]);
    letters.push(L);
  }
  const o = {
    id: g.nextId++, side, kind: 'node', letters, idx: 0, x: 0.5, x0: 0.5, y: -0.1, r: 0.085,
    life: BOSS.shieldLife, age: 0, seed: rng.int(0, 1e6), born: g.t, dying: false,
  };
  g.objects.push(o);
  return o;
}

/** A shield node was broken by its player. */
export function nodeCleared(g, side) {
  const s = g.boss.shield;
  if (!s) return;
  s.cleared[side] = true;
  g.events.push({ type: 'nodeBreak', side, remaining: s.cleared.filter((c) => !c).length });
  if (s.cleared.every(Boolean)) {
    g.boss.shield = null;
    g.boss.staggerUntil = g.t + BOSS.stagger;
    g.events.push({ type: 'bossShieldBreak' });
  }
}

/** A shield node timed out: the boss heals and the shield drops (the fight goes on). */
export function nodeExpired(g) {
  const b = g.boss;
  if (!b.shield) return;
  g.objects = g.objects.filter((o) => o.kind !== 'node');
  b.shield = null;
  const heal = Math.round(b.maxHp * BOSS.shieldFailHeal);
  // Don't heal back above the threshold that started this phase.
  const cap = Math.floor(b.maxHp * BOSS.phaseAt[b.phase - 1]);
  b.hp = Math.min(cap, b.hp + heal);
  g.events.push({ type: 'bossShieldHold', heal });
}

function openCore(g) {
  const b = g.boss;
  const rng = rngFor(g);
  const first = rng.int(0, 1);
  const letters = [];
  for (let i = 0; i < 4; i++) {
    let L;
    do { L = rng.pick(g.letters); } while (g.letters.length > 1 && L === letters[i - 1]);
    letters.push(L);
  }
  const life = scaled(g, BOSS.coreLife);
  b.core = { letters, owners: [first, 1 - first, first, 1 - first], idx: 0, until: g.t + life, life };
  g.events.push({ type: 'coreOpen', owners: b.core.owners });
}

/**
 * Core priority: called before normal targeting. Returns true if the letter was consumed.
 */
export function coreLetter(g, side, letter) {
  const c = g.boss.core;
  if (!c || c.owners[c.idx] !== side || c.letters[c.idx] !== letter) return false;
  c.idx++;
  g.players[side].hits++;
  g.events.push({ type: 'coreHit', side, idx: c.idx, letter });
  if (c.idx >= c.letters.length) {
    g.boss.core = null;
    // Credit the link to both players.
    const half = BOSS.coreDamage / 2;
    g.boss.staggerUntil = Math.max(g.boss.staggerUntil, g.t + BOSS.stagger);
    g.events.push({ type: 'coreBreak' });
    bossDamage(g, 0, half, null, 'core');
    bossDamage(g, 1, half, null, 'core');
  }
  return true;
}

function chooseAttack(g) {
  const b = g.boss;
  const rng = rngFor(g);
  const options = [['volley', 3], ['meteor', 2]];
  if (b.phase >= 1) options.push(['barrage', 2], ['curse', 1.5]);
  const kind = rng.weighted(options);
  const side = kind === 'volley' ? -1 : (b.lastAttackSide = 1 - b.lastAttackSide);
  return { kind, side };
}

/** Executes a telegraphed attack, honouring Reflect on the targeted side(s). */
function executeAttack(g, { kind, side }, spawnRock) {
  const b = g.boss;
  const sides = side === -1 ? [0, 1] : [side];
  const avoid = liveLetters(g); // shared targets: don't duplicate letters already in play
  for (const s of sides) {
    const p = g.players[s];
    if (p.reflectUntil > g.t) {
      p.reflectUntil = 0;
      g.events.push({ type: 'reflect', side: s, to: 'boss', effect: kind });
      bossDamage(g, s, BOSS.reflectDamage, null, 'reflect');
      continue;
    }
    const rng = g.fxRng[s];
    const word = (n) => randomWord(rng, g.letters, n, avoid);
    switch (kind) {
      case 'volley':
        for (let i = 0; i < 1 + Math.min(1, b.phase); i++) {
          g.pendingAttacks.push({ side: s, at: g.t + i * 0.45, letters: word(b.phase >= 2 ? 2 : 1), boss: true });
        }
        break;
      case 'meteor':
        spawnRock(g, s, { letters: word(b.phase >= 1 ? 4 : 3), hostile: true, speedScale: 0.85, rng, meteor: true });
        break;
      case 'barrage':
        for (let i = 0; i < 3; i++) g.pendingAttacks.push({ side: s, at: g.t + i * 0.35, letters: word(1), boss: true, speedScale: 1.25 });
        break;
      case 'curse':
        p.slowUntil = Math.max(p.slowUntil, g.t + BOSS.curseDuration);
        break;
      default:
    }
  }
  g.events.push({ type: 'bossAttack', kind, side });
}

/** Called every frame from engine.update() in boss mode. */
export function updateBoss(g, dt, spawnRock) {
  const b = g.boss;
  if (b.hp <= 0) return;
  g.level = scaled(g, BOSS.levelRange); // asteroids get harder smoothly as the boss weakens
  const staggered = b.staggerUntil > g.t;
  const speed = staggered ? 0 : b.slowUntil > g.t ? 0.5 : 1;
  b.clock += dt * speed;

  if (b.shield && g.t >= b.shield.until) nodeExpired(g);
  if (b.core && g.t >= b.core.until) {
    b.core = null;
    g.events.push({ type: 'coreClose' });
  }
  if (staggered || b.shield) return;

  if (b.telegraph) {
    if (b.clock >= b.telegraph.at) {
      const t = b.telegraph;
      b.telegraph = null;
      executeAttack(g, t, spawnRock);
      b.nextAttack = b.clock + scaled(g, BOSS.attackInterval);
    }
  } else if (b.clock >= b.nextAttack) {
    const atk = chooseAttack(g);
    b.telegraph = { ...atk, at: b.clock + BOSS.telegraph };
    g.events.push({ type: 'bossTelegraph', ...atk });
  }

  if (!b.core && b.clock >= b.nextCore) {
    openCore(g);
    b.nextCore = b.clock + scaled(g, BOSS.coreInterval);
  }
}

/** Orb effects re-mapped for co-op. Returns true if handled here. */
export function bossEffect(g, side, effect, extra) {
  const p = g.players[side];
  switch (effect) {
    case 'attack':
      extra.damage = bossDamage(g, side, BOSS.attackOrbDamage, null, 'orb');
      return true;
    case 'slow':
      g.boss.slowUntil = g.t + BOSS.slowDuration;
      return true;
    case 'leech':
      extra.damage = bossDamage(g, side, BOSS.leechDamage, null, 'orb');
      extra.gained = teamHeal(g, BOSS.leechHeal);
      return true;
    case 'heal':
      extra.gained = teamHeal(g, 20);
      return true;
    default:
      void p;
      return false;
  }
}

export function bossOver(g) {
  if (g.boss.hp <= 0) return 'team';
  if (g.team.health <= 0) return 'boss';
  return null;
}
