// Power-up bubble definitions. Colours/icons are shared by the renderer, HUD and tutorial.
export const EFFECTS = {
  attack: {
    name: 'Attack', color: '#ff4a3d', glow: '#ff9a3d', icon: 'attack',
    blurb: 'Sends extra asteroids at your opponent',
    coopBlurb: "Hits the boss hard",
  },
  slow: {
    name: 'Slow', color: '#b46bff', glow: '#e1b3ff', icon: 'slow',
    blurb: "Halves your opponent's gesture-confirm speed",
    coopBlurb: "Slows the boss's attacks",
  },
  shield: {
    name: 'Shield', color: '#ffd23f', glow: '#fff1a8', icon: 'shield',
    blurb: 'Absorbs the next impact on your base',
    coopBlurb: "Absorbs the next impact",
  },
  heal: {
    name: 'Heal', color: '#3dff7a', glow: '#b8ffcf', icon: 'heal',
    blurb: 'Restores health',
    coopBlurb: "Heals the team",
  },
  freeze: {
    name: 'Freeze', color: '#7fe6ff', glow: '#e8fbff', icon: 'freeze',
    blurb: 'Pauses the asteroids on your side',
    coopBlurb: "Pauses the asteroids",
  },
  nova: {
    name: 'Nova', color: '#ff8a1f', glow: '#ffd29a', icon: 'nova',
    blurb: 'Detonates every asteroid on your side',
    coopBlurb: "Detonates every asteroid",
  },
  haste: {
    name: 'Haste', color: '#d4ff3d', glow: '#f2ffb8', icon: 'haste',
    blurb: 'Your gestures confirm 1.6x faster',
    coopBlurb: "Gestures confirm 1.6x faster",
  },
  reflect: {
    name: 'Reflect', color: '#c8d0ff', glow: '#ffffff', icon: 'reflect', prismatic: true,
    blurb: 'Bounces the next Attack, Slow or Leech back',
    coopBlurb: "Bounces the next boss attack back",
  },
  leech: {
    name: 'Leech', color: '#ff2e63', glow: '#ff9bb3', icon: 'leech',
    blurb: 'Steals health from your opponent',
    coopBlurb: "Damages the boss and heals the team",
  },
};

/** Effects aimed at the opponent (these can be reflected). */
export const OFFENSIVE = ['attack', 'slow', 'leech'];

export const EFFECT_KEYS = Object.keys(EFFECTS);

// Balance knobs (seconds / hp).
export const BALANCE = {
  maxHealth: 100,
  healAmount: 20,
  slowDuration: 6,
  slowFactor: 0.5,
  freezeDuration: 4,
  shieldDuration: 25,
  attackWarning: 1.4,
  // After using an offensive effect, that player cannot be offered the same effect again
  // for this long; the victim also gets a grace period before the next one can land.
  offenseCooldown: 16,
  victimGrace: 10,
  freezeCooldown: 14,
  novaCooldown: 20,
  hasteDuration: 7,
  hasteFactor: 1.6,
  hasteCooldown: 16,
  reflectDuration: 15,
  leechAmount: 12,
  leechCooldown: 18,
};
