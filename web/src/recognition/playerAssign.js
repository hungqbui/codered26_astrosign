// Assigns detected hands to players and keeps the assignment stable.
//
// Players stand side by side: Player 1 is the hand on the LEFT of the (mirrored) screen,
// Player 2 the hand on the RIGHT. Either physical hand can play. Which hand it is (left or
// right) is still detected from MediaPipe's handedness and reported as `.hand`; it is used to
// mirror the classifier input and to show pose hints for the hand actually being used.
//
// * two hands: the left-most is P1, the right-most is P2
// * one hand: by screen half, with hysteresis near the middle so a hand hovering around the
//   midline keeps its player instead of flickering between them
// A player's slot is remembered for `holdMs` after their hand disappears.

const PLAYERS = [0, 1];
const MIDLINE_SLACK = 0.08; // how far past the middle a tracked hand may drift and keep its player

export class PlayerAssigner {
  constructor({ holdMs = 1200, swapLabels = false } = {}) {
    this.holdMs = holdMs;
    this.swapLabels = swapLabels;
    this.tracks = PLAYERS.map(() => ({ pos: null, lastSeen: -Infinity }));
  }

  /**
   * We feed MediaPipe the raw (un-mirrored) camera frame. Verified on the training photos
   * (palm-out "B" hands with the thumb on the image right, i.e. physical right hands, are
   * labelled "Right" 17/19 times), so the label is the person's actual hand. `swapLabels`
   * lets the user flip it if their camera/driver already mirrors the stream.
   */
  realHand(label) {
    const h = label === 'Left' ? 'left' : 'right';
    return this.swapLabels ? (h === 'left' ? 'right' : 'left') : h;
  }

  /**
   * @param {{landmarks:{x,y,z}[], handedness:string, handScore:number}[]} hands raw detections
   * @param {number} now ms timestamp
   * @returns {(object|null)[]} per player: the detection (with .hand = 'left'|'right' and
   *          .screen = mirrored palm centre) or null
   */
  assign(hands, now) {
    const dets = dedupe(hands).map((h) => ({
      ...h,
      hand: this.realHand(h.handedness),
      screen: palmCentreMirrored(h.landmarks),
    }));
    const result = [null, null];

    if (dets.length >= 2) {
      const [a, b] = dets.slice(0, 2).sort((p, q) => p.screen.x - q.screen.x);
      result[0] = a;
      result[1] = b;
    } else if (dets.length === 1) {
      const d = dets[0];
      let side = d.screen.x < 0.5 ? 0 : 1;
      // Near the midline, prefer the player whose hand was just there.
      if (Math.abs(d.screen.x - 0.5) < MIDLINE_SLACK) {
        const recent = PLAYERS.filter((p) => this.tracks[p].pos && now - this.tracks[p].lastSeen < this.holdMs)
          .map((p) => [p, Math.hypot(d.screen.x - this.tracks[p].pos.x, d.screen.y - this.tracks[p].pos.y)])
          .sort((u, v) => u[1] - v[1]);
        if (recent.length && recent[0][1] < 0.15) side = recent[0][0];
      }
      result[side] = d;
    }

    PLAYERS.forEach((p) => {
      if (result[p]) this.tracks[p] = { pos: result[p].screen, lastSeen: now };
    });
    return result;
  }

  /** ms since each player's hand was last seen. */
  missingFor(now) {
    return this.tracks.map((t) => now - t.lastSeen);
  }
}

/** Palm centre in mirrored (what-the-player-sees) normalised screen coordinates. */
export function palmCentreMirrored(lm) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: 1 - x / ids.length, y: y / ids.length };
}

/** MediaPipe occasionally reports the same hand twice; keep the more confident one. */
function dedupe(hands) {
  if (hands.length < 2) return hands;
  const [a, b] = hands;
  const ca = palmCentreMirrored(a.landmarks);
  const cb = palmCentreMirrored(b.landmarks);
  if (Math.hypot(ca.x - cb.x, ca.y - cb.y) < 0.04) return [(a.handScore ?? 0) >= (b.handScore ?? 0) ? a : b];
  return hands;
}
