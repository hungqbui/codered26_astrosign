// Letter/word generation shared by the engine and the boss.

// Shared-target co-op: chance that a new target's first letter is re-rolled (once) when that
// letter is already in play. Soft on purpose: duplicates still happen (multi-kills stay
// possible), just less often than pure chance.
export const DUPLICATE_REROLL = 0.6;

/**
 * Random word with no letter repeated back-to-back. If `avoid` (a Set of letters in play) is
 * given, a first letter found in it is re-rolled once with probability DUPLICATE_REROLL.
 */
export function randomWord(rng, letters, len, avoid = null) {
  const pick = (prev) => {
    let L;
    do { L = rng.pick(letters); } while (letters.length > 1 && L === prev);
    return L;
  };
  const out = [];
  for (let i = 0; i < len; i++) {
    let L = pick(out[i - 1]);
    if (i === 0 && avoid?.has(L) && rng.next() < DUPLICATE_REROLL) L = pick(undefined);
    out.push(L);
  }
  avoid?.add(out[0]);
  return out;
}

/** Next letters currently targetable anywhere (only used in shared-target co-op). */
export function liveLetters(g) {
  if (!(g.mode === 'boss' && g.shareTargets)) return null;
  return new Set(g.objects.filter((o) => !o.dying).map((o) => o.letters[o.idx]));
}
