// Turns a noisy per-frame letter prediction into discrete, deliberate "letter confirmed" events.
//
//  * probabilities are smoothed with an exponential moving average
//  * a letter becomes the candidate once its smoothed confidence passes `threshold`
//  * holding the candidate fills a progress bar over `holdMs` (slower while "slowed")
//  * short dropouts (< graceMs) do not reset progress, a different letter does
//  * after a confirm the letter is locked: the same letter can only count again after
//    the player releases (no hand / low confidence / different pose) for `releaseMs`

export const DEFAULT_CONFIRM = {
  threshold: 0.6,
  holdMs: 420,
  graceMs: 140,
  releaseMs: 180,
  smoothing: 0.45, // weight of the newest frame in the EMA
};

export class GestureConfirmer {
  constructor(classes, opts = {}) {
    this.classes = classes;
    this.o = { ...DEFAULT_CONFIRM, ...opts };
    this.reset();
  }

  reset() {
    this.ema = null;
    this.candidate = null; // letter currently being held
    this.progress = 0; // 0..1
    this.lostMs = 0; // time since the candidate was last seen
    this.locked = null; // letter that must be released before it counts again
    this.releaseMs = 0;
    this.display = { letter: null, confidence: 0 }; // best guess for UI, even below threshold
  }

  /**
   * @param {Float32Array|null} probs class probabilities, or null if the hand is not visible
   * @param {number} dtMs frame time
   * @param {{speed?:number, allowed?:string[]}} ctx speed < 1 while slowed; allowed letters
   * @returns {string|null} the confirmed letter on the frame it is confirmed
   */
  update(probs, dtMs, ctx = {}) {
    const speed = ctx.speed ?? 1;
    let letter = null;
    let conf = 0;
    if (probs) {
      if (!this.ema || this.ema.length !== probs.length) this.ema = Float32Array.from(probs);
      else for (let i = 0; i < probs.length; i++) this.ema[i] += this.o.smoothing * (probs[i] - this.ema[i]);
      let bi = 0;
      for (let i = 1; i < this.ema.length; i++) if (this.ema[i] > this.ema[bi]) bi = i;
      letter = this.classes[bi];
      conf = this.ema[bi];
      this.display = { letter, confidence: conf };
    } else {
      this.ema = null;
      this.display = { letter: null, confidence: 0 };
    }

    const active = letter && conf >= this.o.threshold && (!ctx.allowed || ctx.allowed.includes(letter))
      ? letter : null;

    // Release tracking for the lock.
    if (this.locked) {
      if (active === this.locked) this.releaseMs = 0;
      else {
        this.releaseMs += dtMs;
        if (this.releaseMs >= this.o.releaseMs) this.locked = null;
      }
    }

    if (active && active === this.locked) {
      this.candidate = active;
      this.progress = 1;
      this.lostMs = 0;
      return null;
    }

    if (active) {
      if (active !== this.candidate) {
        this.candidate = active;
        this.progress = 0;
      }
      this.lostMs = 0;
      this.progress += (dtMs / this.o.holdMs) * speed;
      if (this.progress >= 1) {
        this.progress = 1;
        this.locked = active;
        this.releaseMs = 0;
        return active;
      }
      return null;
    }

    // Nothing confident this frame: keep progress briefly, then decay it.
    this.lostMs += dtMs;
    if (this.lostMs > this.o.graceMs) {
      this.progress = Math.max(0, this.progress - dtMs / 200);
      if (this.progress === 0) this.candidate = null;
    }
    return null;
  }

  get state() {
    return {
      candidate: this.candidate,
      progress: this.progress,
      locked: this.locked,
      needsRelease: !!this.locked && this.candidate === this.locked,
      display: this.display,
    };
  }
}
