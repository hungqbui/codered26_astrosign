// Procedural sound effects with the Web Audio API (no audio files needed).
// D major: I – vi – IV – V  (D, Bm, G, A), as MIDI triads.
const PROGRESSION = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
const CHORD_SECONDS = 3.2;
/** k-th tone of a triad stacked upward through octaves (0 = root). */
function chordTone(chord, k) {
  return chord[k % 3] + 12 * Math.floor(k / 3);
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this._noise = null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.init(new AC());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Builds the output graph on a context (also used with an OfflineAudioContext in tests). */
  init(ctx) {
    {
      this.ctx = ctx;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      // Echo bus for the musical layer: a soft, filtered feedback delay gives the notes space.
      this.echo = this.ctx.createDelay(1);
      this.echo.delayTime.value = 0.27;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      const tone = this.ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2600;
      this.echoIn = this.ctx.createGain();
      this.echoIn.gain.value = 0.35;
      this.echoIn.connect(this.echo).connect(tone).connect(fb).connect(this.echo);
      tone.connect(this.master);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  get ok() { return this.ctx && !this.muted; }

  noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.3, delay = 0, pan = 0, attack = 0.005 }) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, f0 = 3000, f1 = 200, q = 1, delay = 0, pan = 0, type = 'lowpass' }) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---- game sounds (pan: -1 = player 1 side, +1 = player 2 side) ----
  confirm(pan) { this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.08, vol: 0.18, pan }); }
  blast(pan) {
    this.tone({ type: 'sawtooth', f0: 1600, f1: 180, dur: 0.18, vol: 0.12, pan });
    this.noise({ dur: 0.12, vol: 0.15, f0: 6000, f1: 1500, type: 'highpass', pan });
  }
  /** A sequence asteroid advanced: a soft passing note in the current chord. */
  partial(pan, step) { this.pluck(chordTone(this.chordNow(), 2 + step), pan, { vol: 0.07, dur: 0.5 }); }

  // ---- musical layer (Tetris Effect style) ----
  // Pops are notes in D major over a slow I–vi–IV–V progression, so both players' sounds
  // always harmonise. One pop = one chord tone that climbs with the combo; several pops from
  // one sign = a strummed chord with one note per target.
  chordNow() {
    return PROGRESSION[Math.floor((this.ctx?.currentTime ?? 0) / CHORD_SECONDS) % PROGRESSION.length];
  }

  /** Bell-like pluck at a MIDI note: triangle body + soft octave sine, sent to the echo. */
  pluck(midi, pan = 0, { vol = 0.13, dur = 1.3, delay = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    out.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.18);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p);
    p.connect(this.master);
    p.connect(this.echoIn);
    for (const [type, mult, gain, detune] of [['triangle', 1, 1, -4], ['triangle', 1, 0.6, 5], ['sine', 2, 0.35, 0], ['sine', 3, 0.12, 0]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      g.gain.value = gain;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** One target popped: a chord tone that rises with the combo (a melody over a streak). */
  popNote(pan, combo = 1) {
    this.pluck(chordTone(this.chordNow(), 3 + ((combo - 1) % 7)), pan);
  }

  /** Several targets popped by one sign: a strummed chord, one note per target. */
  popChord(pan, count, big = false) {
    const chord = this.chordNow();
    const n = Math.min(big ? 8 : 6, Math.max(2, count + (big ? 2 : 0)));
    const spread = big ? 0.045 : 0.035;
    this.pluck(chord[0] - 12, pan, { vol: 0.1, dur: 1.8 }); // low root underneath
    for (let i = 0; i < n; i++) {
      const midi = i === n - 1 && n >= 4 ? chord[0] + 26 : chordTone(chord, 3 + i); // top: add a ninth
      this.pluck(midi, pan, { delay: i * spread, vol: 0.12 - i * 0.008, dur: 1.6 });
    }
  }

  explode(pan, big = false) {
    // kept low-ish: the musical layer (popNote / popChord) carries the pop now
    this.noise({ dur: big ? 0.9 : 0.55, vol: big ? 0.4 : 0.26, f0: 2400, f1: 60, pan });
    this.tone({ type: 'sine', f0: big ? 140 : 180, f1: 40, dur: big ? 0.6 : 0.35, vol: 0.4, pan });
  }
  combo(pan, n) {
    const base = 440 * 2 ** (Math.min(n, 20) / 12);
    [0, 4, 7].forEach((s, i) => this.tone({ type: 'triangle', f0: base * 2 ** (s / 12), dur: 0.12, vol: 0.12, delay: i * 0.05, pan }));
  }
  miss(pan) { this.tone({ type: 'square', f0: 220, f1: 150, dur: 0.16, vol: 0.12, pan }); }
  impact(pan) {
    this.noise({ dur: 0.6, vol: 0.6, f0: 900, f1: 40, pan });
    this.tone({ type: 'sine', f0: 90, f1: 30, dur: 0.5, vol: 0.55, pan });
  }
  shieldBlock(pan) {
    this.tone({ type: 'sine', f0: 1200, f1: 600, dur: 0.4, vol: 0.25, pan });
    this.tone({ type: 'triangle', f0: 1800, f1: 900, dur: 0.3, vol: 0.12, pan, delay: 0.03 });
  }
  effect(kind, pan) {
    switch (kind) {
      case 'attack':
        [0, 1, 2].forEach((i) => this.tone({ type: 'sawtooth', f0: 300 + i * 80, f1: 900, dur: 0.18, vol: 0.14, delay: i * 0.08, pan }));
        break;
      case 'slow':
        this.tone({ type: 'sine', f0: 700, f1: 120, dur: 0.9, vol: 0.25, pan: -pan });
        break;
      case 'shield':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.35, vol: 0.12, delay: i * 0.04, pan }));
        break;
      case 'heal':
        [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.16, delay: i * 0.07, pan }));
        break;
      case 'freeze':
        this.noise({ dur: 0.7, vol: 0.2, f0: 9000, f1: 4000, type: 'highpass', pan });
        [1568, 2093, 2637].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.5, vol: 0.07, delay: i * 0.09, pan }));
        break;
      case 'nova':
        this.noise({ dur: 1.4, vol: 0.7, f0: 3000, f1: 40, pan });
        this.tone({ type: 'sine', f0: 160, f1: 28, dur: 1.1, vol: 0.6, pan });
        this.tone({ type: 'sawtooth', f0: 90, f1: 30, dur: 0.8, vol: 0.18, pan, delay: 0.05 });
        break;
      case 'haste':
        [0, 1, 2, 3].forEach((i) => this.tone({ type: 'sawtooth', f0: 400 + i * 220, f1: 1800 + i * 300, dur: 0.12, vol: 0.09, delay: i * 0.05, pan }));
        break;
      case 'reflect':
        this.reflect(pan);
        break;
      case 'leech':
        this.tone({ type: 'sine', f0: 220, f1: 90, dur: 0.9, vol: 0.3, pan: -pan });
        this.tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.6, vol: 0.12, pan, delay: 0.5 });
        break;
      default:
    }
  }
  /** Glass-like shatter for a breaking orb. */
  shatter(pan) {
    this.noise({ dur: 0.5, vol: 0.45, f0: 9000, f1: 2500, type: 'highpass', pan });
    [2637, 3520, 4186, 3136, 2349].forEach((f, i) => this.tone({ type: 'sine', f0: f, f1: f * 0.97, dur: 0.35, vol: 0.06, delay: i * 0.025, pan }));
  }
  /** Sub-bass hit that sells the orb's effect landing. */
  bassDrop(pan) {
    this.tone({ type: 'sine', f0: 110, f1: 38, dur: 0.6, vol: 0.5, pan });
  }
  reflect(pan) {
    this.tone({ type: 'triangle', f0: 1568, f1: 1568, dur: 0.4, vol: 0.14, pan });
    this.tone({ type: 'triangle', f0: 2093, f1: 2093, dur: 0.4, vol: 0.1, pan, delay: 0.05 });
    this.noise({ dur: 0.35, vol: 0.2, f0: 800, f1: 6000, type: 'bandpass', q: 2, pan });
  }
  // ---- boss ----
  /** One syllable of the boss's 'voice' while its speech bubble types out. */
  bossVoice() {
    const f = 95 + Math.random() * 45;
    this.tone({ type: 'square', f0: f, f1: f * 0.92, dur: 0.06, vol: 0.05 });
    this.tone({ type: 'sine', f0: f * 3.1, f1: f * 2.9, dur: 0.05, vol: 0.025 });
  }
  bossHit(pan) { this.tone({ type: 'square', f0: 180, f1: 120, dur: 0.07, vol: 0.08, pan }); }
  bossCharge() {
    this.tone({ type: 'sawtooth', f0: 90, f1: 420, dur: 1.2, vol: 0.12, attack: 0.3 });
    this.noise({ dur: 1.2, vol: 0.12, f0: 300, f1: 3000, type: 'bandpass', q: 4 });
  }
  bossAttack() {
    this.tone({ type: 'sawtooth', f0: 520, f1: 70, dur: 0.45, vol: 0.2 });
    this.noise({ dur: 0.4, vol: 0.3, f0: 2000, f1: 200 });
  }
  coreOpen() { [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.3, vol: 0.12, delay: i * 0.06 })); }
  bossRoar() {
    this.tone({ type: 'sawtooth', f0: 70, f1: 45, dur: 1.4, vol: 0.3, attack: 0.1 });
    this.tone({ type: 'square', f0: 105, f1: 60, dur: 1.2, vol: 0.12, attack: 0.1 });
    this.noise({ dur: 1.3, vol: 0.3, f0: 600, f1: 120 });
  }
  bossExplode() {
    for (let i = 0; i < 6; i++) this.noise({ dur: 0.6, vol: 0.35, f0: 2500, f1: 60, delay: i * 0.25 });
    this.noise({ dur: 2.0, vol: 0.7, f0: 4000, f1: 30, delay: 1.5 });
    this.tone({ type: 'sine', f0: 120, f1: 25, dur: 1.8, vol: 0.6, delay: 1.5 });
  }
  warning(pan) {
    [0, 0.18].forEach((d) => this.tone({ type: 'square', f0: 660, f1: 640, dur: 0.12, vol: 0.12, delay: d, pan }));
  }
  bubbleSpawn(pan) { this.tone({ type: 'sine', f0: 400, f1: 800, dur: 0.25, vol: 0.12, pan }); }
  bubblePop(pan) { this.noise({ dur: 0.15, vol: 0.15, f0: 3000, f1: 800, type: 'bandpass', q: 3, pan }); }
  countdown(final) { this.tone({ type: 'square', f0: final ? 1046 : 523, dur: final ? 0.45 : 0.18, vol: 0.18 }); }
  levelUp() { [523, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.18, vol: 0.12, delay: i * 0.08 })); }
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.16, delay: i * 0.11 }));
  }
  click() { this.tone({ type: 'triangle', f0: 1200, dur: 0.05, vol: 0.1 }); }
}
