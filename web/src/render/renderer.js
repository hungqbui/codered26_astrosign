// Draws the playfield, HUD, effects and webcam preview, and turns game events into
// visual + audio feedback.
import { EFFECTS } from '../game/effects.js';
import { findTarget, findTargets, urgency } from '../game/engine.js';
import { LETTER_HINTS, PLAYER_COLORS, PLAYER_NAMES, PLAYER_SIDES } from '../game/letters.js';
import { Background } from './background.js';
import {
  FONT, UI_FONT, asteroidPath, drawIcon, drawSkeleton, drawTemplate, hexA, outlinedText, progressRing, roundRect,
} from './draw.js';
import { BossView } from './bossView.js';
import { OrbFx, effectColor } from './orbFx.js';
import { Particles } from './particles.js';

const HOSTILE = '#ff3b3b';
// Letters are the instructions, so they use the most legible face (Orbitron's O looks like a D/0).
const LETTER_FONT = UI_FONT;
// Orbitron's slashed zero reads like "Ø"; numbers use Inter too.
const NUM_FONT = UI_FONT;
const SLOW = EFFECTS.slow.color;
const TAU = Math.PI * 2;

function warnTriangle(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = HOSTILE;
  ctx.strokeStyle = 'rgba(4,2,18,0.9)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 1.1, y + s * 0.85);
  ctx.lineTo(x - s * 1.1, y + s * 0.85);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - s * 0.1, y - s * 0.45, s * 0.2, s * 0.75);
  ctx.fillRect(x - s * 0.1, y + s * 0.45, s * 0.2, s * 0.2);
  ctx.restore();
}

export class Renderer {
  constructor(canvas, { templates, sfx }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.templates = templates;
    this.sfx = sfx;
    this.bg = new Background();
    this.fx = new Particles();
    this.shakeAmt = 0;
    this.flash = [0, 0]; // red damage flash per side
    this.effectFlash = [null, null];
    this.trails = [[], []];
    this.reduced = false;
    this.missText = [null, null];
    this.hitPulse = new Map(); // object id -> time of last partial hit
    this.orb = new OrbFx(this);
    this.boss = new BossView(this);
    this.hitStop = 0; // seconds of near-frozen game time (orb breaks)
    this.zoom = null; // { x, y, amt } zoom punch
    this.lowFx = false;
    this.slowFrames = 0;
    this.installGlowSwitch();
    this.resize();
  }

  /**
   * Canvas shadowBlur (our neon glow) is by far the most expensive thing we draw. When the
   * frame rate stays low we switch glow off globally instead of touching every draw call.
   */
  installGlowSwitch() {
    const proto = Object.getPrototypeOf(this.ctx);
    const desc = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
    const self = this;
    Object.defineProperty(this.ctx, 'shadowBlur', {
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, self.lowFx ? 0 : v); },
    });
  }

  /** Called every frame with the real frame time; enables low-FX mode on slow machines. */
  monitor(frameMs) {
    if (this.lowFx) return;
    this.slowFrames = frameMs > 28 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 90) {
      this.lowFx = true;
      this.resize(); // re-create the canvas at 1x pixel density
      console.warn('Low frame rate detected: glow effects off, canvas at 1x resolution');
    }
  }

  setReduced(r) {
    this.reduced = r;
    this.fx.reduced = r;
  }

  resize() {
    // Pixel density: up to 2x for crisp text, dropped to 1x if the machine can't keep up.
    const dpr = this.lowFx ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    this.bg.resize(w, h);
    const u = Math.min(w / 1600, h / 900);
    this.u = Math.max(0.55, u);
    this.hudH = Math.round(Math.max(70, 96 * this.u));
    this.panelH = Math.round(Math.max(130, 200 * this.u));
    this.top = this.hudH;
    this.baseY = h - this.panelH - 18 * this.u;
    // Let the DOM overlays (buttons, banners) line up with the canvas layout.
    const root = document.documentElement.style;
    root.setProperty('--hud-h', `${this.hudH}px`);
    root.setProperty('--field-bottom', `${Math.round(h - this.baseY)}px`);
    this.sideW = w / 2;
    this.fieldH = this.baseY - this.top;
  }

  // ---------- coordinate helpers ----------
  pos(o) {
    return [o.side * this.sideW + o.x * this.sideW, this.top + o.y * this.fieldH];
  }

  radius(o) {
    return Math.max(30 * this.u, o.r * Math.min(this.sideW, this.fieldH) * 1.55);
  }

  turret(side) {
    return [side * this.sideW + this.sideW / 2, this.baseY - 6];
  }

  shake(a) {
    if (!this.reduced) this.shakeAmt = Math.min(22, this.shakeAmt + a);
  }

  /**
   * Which hand a player is signing with, as detected (left / right). Pose hints are drawn for
   * that hand. Remembered while the hand is briefly out of view; right hand until first seen.
   */
  handOf(side, v) {
    this.lastHand ??= ['right', 'right'];
    const h = v.hands?.[side]?.hand;
    if (h) this.lastHand[side] = h;
    return this.lastHand[side];
  }

  zoomPunch(x, y, amt) {
    if (!this.reduced) this.zoom = { x, y, amt };
  }

  /** Game-time multiplier: a short hit-stop when an orb breaks. */
  timeScale() {
    return this.hitStop > 0 ? 0.08 : 1;
  }

  // ---------- events -> feedback ----------
  handleEvents(events, game) {
    const pan = (s) => (s === 0 ? -0.6 : 0.6);
    // Musical layer: the asteroids one player pops in this batch become one note or a chord.
    for (const side of [0, 1]) {
      const kills = events.filter((e) => e.type === 'destroy' && e.side === side && e.obj?.kind === 'rock');
      if (kills.length === 1 && !kills[0].nova) this.sfx.popNote(pan(side), kills[0].combo);
      else if (kills.length >= 1) this.sfx.popChord(pan(side), kills.length, kills.some((k) => k.nova));
    }
    for (const e of events) {
      const s = e.side;
      if (game.mode === 'boss') this.boss.handle(e, game);
      switch (e.type) {
        case 'hit': {
          const o = game.objects.find((x) => x.id === e.id) ?? e.obj;
          const [tx, ty] = o ? this.pos(o) : this.pos({ side: e.targetSide ?? s, x: e.x, y: e.y });
          const [x0, y0] = this.turret(s);
          this.fx.beam(x0, y0, tx, ty, PLAYER_COLORS[s]);
          this.fx.burst(x0, y0, { color: PLAYER_COLORS[s], n: 10, speed: 200, life: 0.3, spread: 1.2, angle: Math.atan2(ty - y0, tx - x0) });
          // One blast sound per sign, even when it hits several targets.
          this.lastBlast ??= [0, 0];
          if (performance.now() - this.lastBlast[s] > 60) { this.sfx.blast(pan(s)); this.lastBlast[s] = performance.now(); }
          if (!e.complete) {
            this.hitPulse.set(e.id, performance.now());
            this.fx.burst(tx, ty, { color: '#ffffff', n: 14, speed: 260, life: 0.35 });
            this.fx.ring(tx, ty, { color: PLAYER_COLORS[s], radius: 60 * this.u, life: 0.35, width: 4 });
            this.sfx.partial(pan(s), o ? o.idx : 1);
          }
          break;
        }
        case 'destroy': {
          const o = e.obj;
          const [x, y] = this.pos(o);
          const r = this.radius(o);
          if (o.kind === 'bubble') {
            this.orb.shatter(o, x, y, r, s);
            this.fx.text(x, y - r * 0.4, `+${e.score}`, { color: '#fff', size: 34 * this.u });
            break;
          }
          if (e.nova) { // swept away by a Nova: lots of these at once, keep each one light
            this.fx.burst(x, y, { color: EFFECTS.nova.color, n: 24, speed: 420, life: 0.7 });
            this.fx.debris(x, y, EFFECTS.nova.color, 6, r);
            this.fx.ring(x, y, { color: '#fff3c4', radius: r * 2.4, life: 0.4, width: 6 });
            this.fx.text(x, y, `+${e.score}`, { color: '#ffd29a', size: 24 * this.u });
            this.sfx.explode(pan(s), false);
            break;
          }
          const col = o.kind === 'bubble' ? EFFECTS[o.effect].color : o.hostile ? HOSTILE : PLAYER_COLORS[s];
          const big = o.letters.length > 1 || o.kind === 'bubble';
          this.fx.burst(x, y, { color: col, n: big ? 60 : 36, speed: big ? 520 : 400, life: 0.9, size: 3 });
          this.fx.burst(x, y, { color: '#fff4c2', n: 18, speed: 220, life: 0.5, kind: 'dot', size: 3 });
          if (o.kind === 'rock') this.fx.debris(x, y, col, big ? 12 : 8, r);
          this.fx.ring(x, y, { color: col, radius: r * (big ? 3.4 : 2.4), life: 0.55, width: 8 });
          if (big) this.fx.ring(x, y, { color: '#ffffff', radius: r * 1.8, life: 0.35, width: 3 });
          this.fx.text(x, y - r * 0.4, `+${e.score}`, { color: '#fff', size: 30 * this.u * (big ? 1.25 : 1) });
          if (e.mult > 1) this.fx.text(x, y + r * 0.6, `x${e.mult.toFixed(2).replace(/0$/, '')}`, { color: PLAYER_COLORS[s], size: 22 * this.u });
          this.shake(big ? 7 : 3);
          this.lastBoom ??= [0, 0];
          if (performance.now() - this.lastBoom[s] > 60) { this.sfx.explode(pan(s), big); this.lastBoom[s] = performance.now(); }
          if (e.combo >= 3 && e.combo % 3 === 0) {
            this.sfx.combo(pan(s), e.combo);
            const cx = s * this.sideW + this.sideW / 2;
            this.fx.text(cx, this.top + this.fieldH * 0.45, `${e.combo} COMBO!`, { color: PLAYER_COLORS[s], size: 54 * this.u, life: 1.1, vy: -30 });
            this.fx.ring(cx, this.top + this.fieldH * 0.45, { color: PLAYER_COLORS[s], radius: this.sideW * 0.5, life: 0.7, width: 5 });
          }
          if (o.kind === 'bubble') this.sfx.bubblePop(pan(s));
          break;
        }
        case 'multi': {
          const cx = s * this.sideW + this.sideW / 2;
          const cy = this.top + this.fieldH * 0.6;
          this.fx.text(cx, cy, `MULTI ×${e.count}`, { color: '#ffd23f', size: 48 * this.u, life: 1.2, vy: -40 });
          this.fx.text(cx, cy + 44 * this.u, `+${e.bonus}`, { color: '#ffffff', size: 26 * this.u, life: 1.1, vy: -40 });
          this.fx.ring(cx, cy, { color: '#ffd23f', radius: this.sideW * 0.35, life: 0.6, width: 6 });
          this.shake(4 + 2 * e.count);
          this.sfx.combo(pan(s), 6 + e.count * 2);
          break;
        }
        case 'miss': {
          const [x, y] = this.turret(s);
          this.missText[s] = { letter: e.letter, t: performance.now() };
          this.fx.text(x, y - 60 * this.u, `${e.letter}: no target`, { color: '#ff9b9b', size: 22 * this.u, life: 0.9 });
          this.sfx.miss(pan(s));
          break;
        }
        case 'comboBreak': {
          const [x, y] = this.turret(s);
          this.fx.text(x, y - 95 * this.u, 'combo lost', { color: '#9aa3c7', size: 20 * this.u, life: 0.9 });
          break;
        }
        case 'impact': {
          const [x] = this.pos(e.obj);
          const y = this.baseY;
          this.fx.burst(x, y, { color: '#ff6a3d', n: 50, speed: 480, life: 0.9, angle: -Math.PI / 2, spread: Math.PI * 1.1, gravity: 500 });
          this.fx.ring(x, y, { color: '#ff3b3b', radius: 160 * this.u, life: 0.6, width: 10 });
          this.fx.text(x, y - 50 * this.u, `-${e.damage}`, { color: '#ff5b5b', size: 36 * this.u });
          this.flash[s] = 1;
          this.shake(14);
          this.sfx.impact(pan(s));
          break;
        }
        case 'shieldBlock': {
          const [x] = this.pos(e.obj);
          const y = this.baseY - 40 * this.u;
          this.fx.burst(x, y, { color: EFFECTS.shield.color, n: 40, speed: 420, life: 0.7 });
          this.fx.ring(x, y, { color: EFFECTS.shield.color, radius: 140 * this.u, life: 0.5, width: 8 });
          this.fx.text(x, y - 40 * this.u, 'BLOCKED', { color: EFFECTS.shield.color, size: 30 * this.u });
          this.shake(5);
          this.sfx.shieldBlock(pan(s));
          break;
        }
        case 'effect':
          this.orb.activate(e);
          break;
        case 'reflect':
          if (e.to !== 'boss') this.orb.reflect(e);
          break;
        case 'attackIncoming':
          this.sfx.warning(pan(s));
          break;
        case 'bubbleSpawn':
          this.sfx.bubbleSpawn(pan(s));
          break;
        case 'bubbleExpire': {
          const [x, y] = this.pos(e.obj);
          this.fx.burst(x, y, { color: EFFECTS[e.obj.effect].color, n: 20, speed: 160, life: 0.6, kind: 'dot' });
          this.fx.text(x, y, 'escaped', { color: '#b9b9d9', size: 20 * this.u });
          this.sfx.bubblePop(pan(s));
          break;
        }
        case 'levelUp': {
          this.fx.text(this.W / 2, this.top + this.fieldH * 0.2, `LEVEL ${e.level}`, { color: '#ffffff', size: 46 * this.u, life: 1.6, vy: -15 });
          this.sfx.levelUp();
          break;
        }
        default:
      }
    }
  }

  // ---------- frame ----------
  /**
   * @param {object} v view model:
   *   t, dt, game, confirm[2], hands[2], missing[2], video, mode, showPreview, labels, practice
   */
  draw(v) {
    const { ctx } = this;
    const g = v.game;
    this.fx.update(v.dt);
    this.orb.update(v.dt);
    this.hitStop = Math.max(0, this.hitStop - v.dt);
    this.shakeAmt *= Math.pow(0.002, v.dt);
    this.flash = this.flash.map((f) => Math.max(0, f - v.dt * 2.2));

    ctx.save();
    if (this.shakeAmt > 0.3) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
    }
    if (this.zoom) {
      const z = 1 + this.zoom.amt;
      ctx.translate(this.zoom.x, this.zoom.y);
      ctx.scale(z, z);
      ctx.translate(-this.zoom.x, -this.zoom.y);
      this.zoom.amt *= Math.pow(0.0005, v.dt);
      if (this.zoom.amt < 0.002) this.zoom = null;
    }
    const speed = g ? 1 + (g.level - 1) * 0.15 : 0.6;
    this.bg.draw(ctx, v.t, { speed, reduced: this.reduced, baseY: g ? this.baseY : null });

    if (g) {
      for (const side of [0, 1]) this.drawSideBackdrop(side, g, v);
      this.drawDivider(v.t);
      for (const side of [0, 1]) this.drawBase(side, g, v);
      if (g.mode === 'boss') {
        this.boss.update(v.dt, g);
        this.boss.draw(ctx, g, v);
      }
      this.drawHands(v);
      this.drawObjects(g, v);
      for (const side of [0, 1]) this.drawFocus(side, g, v);
      this.fx.draw(ctx);
      this.orb.draw(ctx, v.t);
      for (const side of [0, 1]) this.drawSideOverlays(side, g, v);
      this.fx.drawText(ctx);
      this.drawHud(g, v);
      for (const side of [0, 1]) this.drawPanel(side, g, v);
      this.orb.drawBanners(ctx, v.t);
      if (g.mode === 'boss') this.boss.drawSpeech(ctx, g);
    } else {
      this.drawHands(v);
      this.fx.draw(ctx);
      this.fx.drawText(ctx);
    }
    ctx.restore();
    if (v.showPreview !== false && v.video) this.drawPreview(v);
  }

  drawSideBackdrop(side, g, v) {
    const { ctx } = this;
    const p = g.players[side];
    const x0 = side * this.sideW;
    // Subtle player-coloured wash so each half reads as "yours".
    const grad = ctx.createLinearGradient(0, this.top, 0, this.baseY);
    grad.addColorStop(0, hexA(PLAYER_COLORS[side], 0.0));
    grad.addColorStop(1, hexA(PLAYER_COLORS[side], 0.07));
    ctx.fillStyle = grad;
    ctx.fillRect(x0, this.top, this.sideW, this.fieldH);
    if (p.freezeUntil > g.t) {
      const k = Math.min(1, (p.freezeUntil - g.t) / 0.4);
      ctx.fillStyle = hexA(EFFECTS.freeze.color, 0.12 * k);
      ctx.fillRect(x0, this.top, this.sideW, this.fieldH);
    }
  }

  drawDivider(t) {
    const { ctx } = this;
    const x = this.sideW;
    ctx.save();
    const grad = ctx.createLinearGradient(0, this.top, 0, this.baseY);
    grad.addColorStop(0, 'rgba(160,120,255,0)');
    grad.addColorStop(0.5, 'rgba(160,120,255,0.55)');
    grad.addColorStop(1, 'rgba(160,120,255,0.1)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = this.reduced ? 0 : -t * 40;
    ctx.beginPath();
    ctx.moveTo(x, this.top);
    ctx.lineTo(x, this.baseY);
    ctx.stroke();
    ctx.restore();
  }

  drawBase(side, g, v) {
    const { ctx } = this;
    const p = g.players[side];
    const col = PLAYER_COLORS[side];
    const x0 = side * this.sideW;
    const y = this.baseY;
    const danger = g.mode === 'boss' ? g.team.health < g.team.max * 0.3 : p.health < 30;
    const flick = danger && !this.reduced ? 0.6 + 0.4 * Math.sin(v.t * 14) : 1;
    ctx.save();
    // ground line
    ctx.strokeStyle = danger ? hexA('#ff4040', 0.9 * flick) : col;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 12, y);
    ctx.lineTo(x0 + this.sideW - 12, y);
    ctx.stroke();
    // skyline
    ctx.shadowBlur = 0;
    ctx.fillStyle = hexA(col, 0.16);
    ctx.strokeStyle = hexA(col, 0.6);
    ctx.lineWidth = 1.5;
    const n = 14;
    ctx.beginPath();
    ctx.moveTo(x0 + 12, y);
    for (let i = 0; i < n; i++) {
      const bw = (this.sideW - 24) / n;
      const h = (14 + ((Math.sin(i * 91.7 + side * 13) + 1) / 2) * 34) * this.u;
      ctx.lineTo(x0 + 12 + i * bw, y - h);
      ctx.lineTo(x0 + 12 + (i + 1) * bw, y - h);
    }
    ctx.lineTo(x0 + this.sideW - 12, y);
    ctx.fill();
    ctx.stroke();

    // shield dome
    if (p.shieldUntil > g.t) {
      const left = p.shieldUntil - g.t;
      const blink = left < 3 && !this.reduced ? 0.5 + 0.5 * Math.sin(v.t * 18) : 1;
      const cx = x0 + this.sideW / 2;
      const rx = this.sideW * 0.49;
      const ry = 110 * this.u;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.strokeStyle = EFFECTS.shield.color;
      ctx.shadowColor = EFFECTS.shield.color;
      ctx.shadowBlur = 20;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, y, rx, ry, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.fillStyle = hexA(EFFECTS.shield.color, 0.08);
      ctx.fill();
      // hex shimmer
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.25 * blink;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 9);
        const hx = cx + Math.cos(a) * rx * 0.8;
        const hy = y + Math.sin(a) * ry * 0.8;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const b = (k / 6) * TAU + (this.reduced ? 0 : v.t);
          ctx[k ? 'lineTo' : 'moveTo'](hx + Math.cos(b) * 12 * this.u, hy + Math.sin(b) * 12 * this.u);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // turret aimed at the current focus
    const [tx, ty] = this.turret(side);
    const focus = this.focusTarget(side, g, v);
    let ang = -Math.PI / 2;
    if (focus) {
      const [fx, fy] = this.pos(focus);
      ang = Math.atan2(fy - ty, fx - tx);
    }
    ctx.translate(tx, ty);
    ctx.fillStyle = '#0d0828';
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 26 * this.u, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath();
    roundRect(ctx, 0, -7 * this.u, 46 * this.u, 14 * this.u, 5 * this.u);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Maps a tracked hand from camera coordinates onto the playfield.
   * Horizontal: mirrored across the full width, so each player's hand stays on their side.
   * Vertical: hands are usually held low in the camera image (chest height), so instead of a
   * straight 0..1 -> screen mapping we track the players' average hand height and put it at
   * ~42% of the playfield, amplifying movement around it. The hand keeps its true proportions.
   */
  handToScreen(h, dt, aspect) {
    const c = h.screen; // palm centre, mirrored, camera-normalised
    this.handRefY = this.handRefY == null ? c.y : this.handRefY + Math.min(1, dt / 2.5) * (c.y - this.handRefY);
    const fieldH = this.fieldH;
    const cx = c.x * this.W;
    const cy = Math.min(this.baseY - fieldH * 0.08, Math.max(this.top + fieldH * 0.08,
      this.top + (0.42 + (c.y - this.handRefY) * 1.4) * fieldH));
    const k = fieldH * 0.95; // camera-height units -> pixels
    const rx = 1 - c.x; // palm centre in raw camera x
    return h.landmarks.map((p) => [cx - (p.x - rx) * aspect * k, cy + (p.y - c.y) * k]);
  }

  drawHands(v) {
    // Ghost skeleton + fingertip trail of each tracked hand on the playfield.
    const { ctx } = this;
    for (const side of [0, 1]) {
      const h = v.hands?.[side];
      const trail = this.trails[side];
      if (h) {
        const pts = v.game
          ? this.handToScreen(h, v.dt, v.camAspect ?? 16 / 9)
          : h.landmarks.map((p) => [(1 - p.x) * this.W, p.y * this.H]);
        trail.push([pts[8][0], pts[8][1], v.t]);
        drawSkeleton(ctx, pts, PLAYER_COLORS[side], { width: 2, alpha: v.game ? 0.22 : 0.5, joints: !v.game });
      }
      while (trail.length && (v.t - trail[0][2] > 0.35 || trail.length > 24)) trail.shift();
      if (trail.length > 1 && !this.reduced) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const k = i / trail.length;
          ctx.strokeStyle = hexA(PLAYER_COLORS[side], 0.5 * k);
          ctx.lineWidth = 2 + 8 * k;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
          ctx.lineTo(trail[i][0], trail[i][1]);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /** Which object the player's next confirmed letter would hit (or the most urgent one). */
  focusTarget(side, g, v) {
    const c = v.confirm?.[side];
    if (c?.candidate && !c.needsRelease) {
      const t = findTarget(g, side, c.candidate);
      if (t) return t;
    }
    let best = null;
    const anySide = g.mode === 'boss' && g.shareTargets;
    for (const o of g.objects) {
      if ((!anySide && o.side !== side) || (o.kind === 'rock' && o.y < 0)) continue;
      if (!best || urgency(o) < urgency(best)) best = o;
    }
    return best;
  }

  drawObjects(g, v) {
    const { ctx } = this;
    const now = performance.now();
    for (const o of g.objects) {
      const [x, y] = this.pos(o);
      const r = this.radius(o);
      const frozen = g.players[o.side].freezeUntil > g.t;
      if (o.kind === 'bubble') { this.drawBubble(o, x, y, r, v.t, frozen); continue; }
      if (o.kind === 'node') { this.boss.drawNode(o, x, y, r, v.t); continue; }
      const col = o.hostile ? HOSTILE : PLAYER_COLORS[o.side];
      const rot = this.reduced ? 0 : (v.t - o.born) * (0.3 + (o.seed % 7) * 0.05) * (o.seed % 2 ? 1 : -1);
      const pulse = this.hitPulse.get(o.id);
      const hitK = pulse ? Math.max(0, 1 - (now - pulse) / 250) : 0;

      // Motion streak.
      if (!frozen && !this.reduced) {
        const tail = ctx.createLinearGradient(x, y - r * 3, x, y);
        tail.addColorStop(0, hexA(col, 0));
        tail.addColorStop(1, hexA(col, 0.28));
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.6, y);
        ctx.lineTo(x, y - r * 3.2);
        ctx.lineTo(x + r * 0.6, y);
        ctx.fill();
      }
      ctx.save();
      // glow
      ctx.shadowColor = col;
      ctx.shadowBlur = 22 + hitK * 30;
      const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      body.addColorStop(0, frozen ? '#3b5a78' : '#3a2a5e');
      body.addColorStop(1, frozen ? '#13243a' : '#120a26');
      ctx.fillStyle = body;
      asteroidPath(ctx, x, y, r * (1 + hitK * 0.08), o.seed, rot);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = frozen ? EFFECTS.freeze.color : col;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // craters
      ctx.strokeStyle = hexA(col, 0.25);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = o.seed * 0.7 + i * 2.1 + rot;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * (0.1 + 0.05 * i), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      // Letter(s): big next letter in the middle, sequence chips beneath.
      const next = o.letters[o.idx];
      outlinedText(ctx, next, x, y + r * 0.04, { size: Math.max(26, r * 0.95), color: '#ffffff', font: LETTER_FONT, weight: 900 });
      if (o.letters.length > 1) this.drawSequence(o, x, y + r + 16 * this.u, col);
      if (o.hostile) warnTriangle(ctx, x + r * 0.85, y - r * 0.85, 13 * this.u);
    }
  }

  drawSequence(o, x, y, col) {
    const { ctx } = this;
    const s = Math.max(20, 26 * this.u);
    const gap = 4;
    const w = o.letters.length * (s + gap) - gap;
    let cx = x - w / 2;
    for (let i = 0; i < o.letters.length; i++) {
      const done = i < o.idx;
      const cur = i === o.idx;
      ctx.save();
      roundRect(ctx, cx, y - s / 2, s, s, 5);
      ctx.fillStyle = done ? hexA(col, 0.25) : cur ? '#ffffff' : 'rgba(10,6,30,0.85)';
      ctx.fill();
      ctx.lineWidth = cur ? 2.5 : 1.5;
      ctx.strokeStyle = done ? hexA(col, 0.5) : col;
      ctx.stroke();
      ctx.restore();
      if (done) {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.27, y + s * 0.02);
        ctx.lineTo(cx + s * 0.44, y + s * 0.2);
        ctx.lineTo(cx + s * 0.74, y - s * 0.2);
        ctx.stroke();
        ctx.restore();
      } else {
        outlinedText(ctx, o.letters[i], cx + s / 2, y + 1, {
          size: s * 0.66, color: cur ? '#120a26' : '#e9e6ff', width: cur ? 0 : 3, font: LETTER_FONT, weight: 900,
        });
      }
      cx += s + gap;
    }
  }

  drawBubble(o, x, y, r, t, frozen) {
    const { ctx } = this;
    const def = EFFECTS[o.effect];
    const life = Math.max(0, 1 - o.age / o.life);
    const wob = this.reduced ? 0 : Math.sin(t * 3 + o.seed) * 0.04;
    ctx.save();
    // body
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.35, hexA(def.color, 0.25));
    grad.addColorStop(1, hexA(def.color, 0.08));
    ctx.fillStyle = grad;
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1 + wob), r * (1 - wob), 0, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = effectColor(def, t);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // effect-specific animation
    const T = this.reduced ? 0 : t;
    ctx.strokeStyle = hexA(def.glow, 0.6);
    ctx.lineWidth = 2;
    switch (o.effect) {
      case 'attack':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + T * 1.5;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05);
          ctx.lineTo(x + Math.cos(a) * r * 1.28, y + Math.sin(a) * r * 1.28);
          ctx.stroke();
        }
        break;
      case 'slow':
        for (let i = 0; i < 3; i++) {
          const k = ((T * 0.25 + i / 3) % 1);
          ctx.globalAlpha = 1 - k;
          ctx.beginPath();
          ctx.arc(x, y, r * (1 + k * 0.5), 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      case 'shield':
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU + T * 0.6;
          ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * 1.18, y + Math.sin(a) * r * 1.18);
        }
        ctx.stroke();
        break;
      case 'heal':
        for (let i = 0; i < 4; i++) {
          const k = (T * 0.5 + i / 4) % 1;
          const px = x + Math.sin(i * 2.3) * r * 0.7;
          const py = y + r * 0.8 - k * r * 2;
          ctx.globalAlpha = 1 - k;
          drawIcon(ctx, 'heal', px, py, 10 * this.u, def.color);
        }
        ctx.globalAlpha = 1;
        break;
      case 'freeze':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU - T * 0.4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02);
          ctx.lineTo(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 1.25);
          ctx.lineTo(x + Math.cos(a + 0.1) * r * 1.15, y + Math.sin(a + 0.1) * r * 1.15);
          ctx.stroke();
        }
        break;
      case 'nova': { // unstable core: pulsing glow + orbiting embers
        const pulse = 0.5 + 0.5 * Math.sin(T * 6);
        const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.9);
        core.addColorStop(0, `rgba(255,240,200,${0.35 + 0.35 * pulse})`);
        core.addColorStop(1, 'rgba(255,138,31,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = def.glow;
        for (let i = 0; i < 5; i++) {
          const a = T * 2.2 + (i / 5) * TAU;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15, 3, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'haste': // crackling electric arcs around the rim
        ctx.strokeStyle = hexA(def.glow, 0.9);
        for (let i = 0; i < 4; i++) {
          const a0 = (i / 4) * TAU + T * 3;
          ctx.beginPath();
          for (let j = 0; j <= 6; j++) {
            const a = a0 + j * 0.12;
            const rr = r * (1.12 + (j % 2 ? 0.1 : -0.02) * Math.sin(T * 40 + i));
            ctx[j ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        break;
      case 'reflect': // prismatic facets
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + T * 0.8;
          ctx.strokeStyle = `hsla(${(i * 60 + T * 140) % 360},100%,75%,0.8)`;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05);
          ctx.lineTo(x + Math.cos(a + TAU / 6) * r * 1.05, y + Math.sin(a + TAU / 6) * r * 1.05);
          ctx.stroke();
        }
        break;
      case 'leech': // drips falling from the bottom
        ctx.fillStyle = hexA(def.color, 0.85);
        for (let i = 0; i < 3; i++) {
          const k = (T * 0.8 + i / 3) % 1;
          const dx = (i - 1) * r * 0.35;
          ctx.globalAlpha = 1 - k;
          ctx.beginPath();
          ctx.ellipse(x + dx, y + r * (0.95 + k * 0.9), 3.5, 5 + k * 3, 0, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      default:
    }
    // deadline ring
    progressRing(ctx, x, y, r * 1.38, life, life < 0.3 ? '#ff5050' : effectColor(def, t), 4, 'rgba(255,255,255,0.08)');
    ctx.restore();

    drawIcon(ctx, def.icon, x, y - r * 0.42, r * 0.5, '#ffffff', t);
    outlinedText(ctx, o.letters[o.idx], x, y + r * 0.22, { size: Math.max(24, r * 0.62), color: '#ffffff', font: LETTER_FONT, weight: 900 });
    outlinedText(ctx, def.name.toUpperCase(), x, y - r * 1.4 - 16 * this.u, { size: 15 * this.u, color: def.color, font: FONT, width: 4 });
    this.drawSequence(o, x, y + r + 26 * this.u, def.color);
    if (frozen) {
      ctx.save();
      ctx.strokeStyle = hexA(EFFECTS.freeze.color, 0.8);
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.1, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFocus(side, g, v) {
    // While a pose is held, lock on to EVERY target it will hit; otherwise mark the most urgent.
    const c = v.confirm?.[side];
    const held = c?.candidate && !c.needsRelease ? c.candidate : null;
    const locked = held ? findTargets(g, side, held) : [];
    const list = locked.length ? locked : [this.focusTarget(side, g, v)].filter(Boolean);
    const locking = locked.length > 0;
    for (const o of list) this.drawReticle(side, g, v, o, locking, c);
    if (locked.length > 1) { // "×N" tag over the lock-on group
      const [x, y] = this.pos(locked[0]);
      outlinedText(this.ctx, `×${locked.length}`, x + this.radius(locked[0]) * 1.4, y - this.radius(locked[0]) * 1.2, { size: 20 * this.u, color: PLAYER_COLORS[side], width: 4 });
    }
  }

  drawReticle(side, g, v, o, locking, c) {
    const { ctx } = this;
    const [x, y] = this.pos(o);
    const r = this.radius(o) * (o.kind === 'rock' ? 1.35 : 1.55);
    const col = PLAYER_COLORS[side];
    const spin = this.reduced ? 0 : v.t * 1.4;
    ctx.save();
    ctx.strokeStyle = locking ? '#ffffff' : hexA(col, 0.75);
    ctx.lineWidth = locking ? 3.5 : 2.5;
    ctx.shadowColor = col;
    ctx.shadowBlur = locking ? 18 : 8;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(x, y, r, a - 0.35, a + 0.35);
      ctx.stroke();
    }
    if (locking) {
      const slowed = g.players[side].slowUntil > g.t;
      progressRing(ctx, x, y, r + 8, c.progress, slowed ? SLOW : col, 5, 'rgba(255,255,255,0.1)');
      // dashed aim line from turret
      const [tx, ty] = this.turret(side);
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = this.reduced ? 0 : -v.t * 60;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }


  drawSideOverlays(side, g, v) {
    const { ctx } = this;
    const p = g.players[side];
    const x0 = side * this.sideW;
    const cx = x0 + this.sideW / 2;
    // damage flash
    if (this.flash[side] > 0) {
      const a = (this.reduced ? 0.25 : 0.45) * this.flash[side];
      const grad = ctx.createRadialGradient(cx, this.baseY, 10, cx, this.baseY, this.sideW * 0.9);
      grad.addColorStop(0, `rgba(255,40,40,${a})`);
      grad.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, this.top, this.sideW, this.fieldH + 20);
    }
    // effect activation tint
    const ef = this.effectFlash[side];
    if (ef) {
      const k = 1 - (performance.now() - ef.t) / 700;
      if (k <= 0) this.effectFlash[side] = null;
      else {
        ctx.fillStyle = hexA(ef.color, (this.reduced ? 0.08 : 0.18) * k);
        ctx.fillRect(x0, this.top, this.sideW, this.fieldH);
      }
    }
    // haste: lime streaks along the side edges
    if (p.hasteUntil > g.t) {
      const hc = EFFECTS.haste.color;
      ctx.save();
      ctx.strokeStyle = hexA(hc, 0.55);
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const k = this.reduced ? i / 8 : (v.t * 1.6 + i / 8) % 1;
        const y = this.baseY - k * this.fieldH;
        for (const ex of [x0 + 10, x0 + this.sideW - 10]) {
          ctx.beginPath();
          ctx.moveTo(ex, y);
          ctx.lineTo(ex, y + 40 * this.u);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    // reflect: a prismatic barrier across the top of the side
    if (p.reflectUntil > g.t) {
      ctx.save();
      const yb = this.top + 8 * this.u;
      const grad = ctx.createLinearGradient(x0, 0, x0 + this.sideW, 0);
      for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsla(${(i * 60 + v.t * 120) % 360},100%,72%,0.85)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(x0 + 14, yb);
      ctx.lineTo(x0 + this.sideW - 14, yb);
      ctx.stroke();
      ctx.restore();
      outlinedText(ctx, 'REFLECT', cx, yb + 16 * this.u, { size: 13 * this.u, color: effectColor(EFFECTS.reflect, v.t), width: 3 });
    }
    // freeze frost border + timer
    if (p.freezeUntil > g.t) {
      ctx.save();
      ctx.strokeStyle = hexA(EFFECTS.freeze.color, 0.7);
      ctx.lineWidth = 6;
      ctx.shadowColor = EFFECTS.freeze.color;
      ctx.shadowBlur = 24;
      ctx.strokeRect(x0 + 6, this.top + 6, this.sideW - 12, this.fieldH - 12);
      ctx.restore();
      outlinedText(ctx, `FROZEN ${(p.freezeUntil - g.t).toFixed(1)}s`, cx, this.top + 34 * this.u, { size: 22 * this.u, color: EFFECTS.freeze.color });
    }
    // attack warning chevrons
    const incoming = g.pendingAttacks.filter((a) => a.side === side).length;
    if (incoming) {
      const blink = this.reduced ? 1 : 0.55 + 0.45 * Math.sin(v.t * 16);
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = 'rgba(255,40,40,0.18)';
      ctx.fillRect(x0, this.top, this.sideW, 46 * this.u);
      ctx.restore();
      outlinedText(ctx, `INCOMING ×${incoming}`, cx, this.top + 24 * this.u, { size: 24 * this.u, color: HOSTILE });
      ctx.font = `800 ${Math.round(24 * this.u)}px ${FONT}`;
      const half = ctx.measureText(`INCOMING ×${incoming}`).width / 2 + 26 * this.u;
      warnTriangle(ctx, cx - half, this.top + 24 * this.u, 12 * this.u);
      warnTriangle(ctx, cx + half, this.top + 24 * this.u, 12 * this.u);
    }
    // missing hand banner
    const miss = v.missing?.[side] ?? 0;
    if (v.cameraOn && miss > 700) {
      const y = this.top + this.fieldH * 0.62;
      ctx.save();
      roundRect(ctx, cx - 180 * this.u, y - 34 * this.u, 360 * this.u, 68 * this.u, 14);
      ctx.fillStyle = 'rgba(8,4,26,0.82)';
      ctx.fill();
      ctx.strokeStyle = PLAYER_COLORS[side];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      outlinedText(ctx, `${PLAYER_NAMES[side]}: raise your hand`, cx, y - 8 * this.u, { size: 21 * this.u, color: '#fff', font: UI_FONT, weight: 700 });
      outlinedText(ctx, side === 0 ? 'on the left side of the camera' : 'on the right side of the camera', cx, y + 18 * this.u, { size: 14 * this.u, color: '#b9b4e6', font: UI_FONT, weight: 500, width: 3 });
    }
  }

  drawHud(g, v) {
    const { ctx } = this;
    const u = this.u;
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, this.hudH);
    grad.addColorStop(0, 'rgba(5,2,20,0.9)');
    grad.addColorStop(1, 'rgba(5,2,20,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.hudH);
    ctx.restore();

    for (const side of [0, 1]) {
      const p = g.players[side];
      const col = PLAYER_COLORS[side];
      const left = side === 0;
      const pad = 22 * u;
      const ax = left ? pad : this.W - pad;
      const align = left ? 'left' : 'right';
      outlinedText(ctx, `${PLAYER_NAMES[side].toUpperCase()}`, ax, 22 * u, { size: 17 * u, color: col, align, width: 3 });
      outlinedText(ctx, `${PLAYER_SIDES[side]} · ${this.handOf(side, v).toUpperCase()} hand`, ax + (left ? 128 * u : -128 * u), 22 * u, { size: 13 * u, color: '#a9a3d6', align, font: UI_FONT, weight: 600, width: 3 });
      // health bar
      const bw = Math.min(this.sideW * 0.42, 340 * u);
      const bh = 16 * u;
      const bx = left ? pad : this.W - pad - bw;
      const by = 40 * u;
      const frac = p.health / 100;
      const coop = g.mode === 'boss';
      ctx.save();
      if (coop) ctx.globalAlpha = 0; // co-op: no personal health (shared team pool in the centre)
      roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = hexA(col, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (frac > 0) {
        const fw = Math.max(bh, bw * frac);
        roundRect(ctx, left ? bx : bx + bw - fw, by, fw, bh, bh / 2);
        const hc = frac > 0.5 ? col : frac > 0.25 ? '#ffb13d' : '#ff3b3b';
        ctx.fillStyle = hc;
        ctx.shadowColor = hc;
        ctx.shadowBlur = 12;
        ctx.fill();
      }
      ctx.restore();
      if (coop) {
        outlinedText(ctx, `BOSS DAMAGE ${g.boss.damageBy[side]}`, left ? bx : bx + bw, by + bh / 2 + 1, { size: 14 * u, color: col, align, width: 3, font: NUM_FONT, weight: 800 });
      } else {
        outlinedText(ctx, `${Math.ceil(p.health)}`, left ? bx + bw + 10 * u : bx - 10 * u, by + bh / 2 + 1, { size: 15 * u, color: '#fff', align, width: 3, font: NUM_FONT });
      }
      // score + combo
      const sx = left ? bx + bw + 70 * u : bx - 70 * u;
      outlinedText(ctx, p.score.toLocaleString(), sx, 36 * u, { size: 30 * u, color: '#ffffff', align, font: NUM_FONT, weight: 900 });
      const mult = Math.min(3, 1 + 0.25 * Math.floor(p.combo / 3));
      if (p.combo > 1) {
        outlinedText(ctx, `${p.combo} combo  x${mult}`, sx, 66 * u, { size: 15 * u, color: col, align, width: 3 });
      }
      // active effects
      const effects = [];
      if (p.shieldUntil > g.t) effects.push(['shield', p.shieldUntil - g.t, 25]);
      if (p.slowUntil > g.t) effects.push(['slow', p.slowUntil - g.t, 6]);
      if (p.freezeUntil > g.t) effects.push(['freeze', p.freezeUntil - g.t, 4]);
      if (p.hasteUntil > g.t) effects.push(['haste', p.hasteUntil - g.t, 7]);
      if (p.reflectUntil > g.t) effects.push(['reflect', p.reflectUntil - g.t, 15]);
      effects.forEach(([k, left2, max], i) => {
        const ex = left ? bx + i * 44 * u + 14 * u : bx + bw - i * 44 * u - 14 * u;
        const ey = by + bh + 22 * u;
        progressRing(ctx, ex, ey, 14 * u, left2 / max, effectColor(EFFECTS[k], v.t), 3);
        drawIcon(ctx, EFFECTS[k].icon, ex, ey, 14 * u, effectColor(EFFECTS[k], v.t), v.t);
      });
    }
    if (g.mode === 'boss') {
      const scoreEdge = 22 * u + Math.min(this.sideW * 0.42, 340 * u) + 70 * u + 110 * u;
      this.boss.drawHud(ctx, g, v, this.W - 2 * scoreEdge);
      return;
    }
    // centre: level + time
    const mm = Math.floor(g.t / 60);
    const ss = Math.floor(g.t % 60).toString().padStart(2, '0');
    outlinedText(ctx, `LEVEL ${g.level}`, this.W / 2, 26 * u, { size: 20 * u, color: '#ffffff' });
    outlinedText(ctx, `${mm}:${ss}`, this.W / 2, 54 * u, { size: 16 * u, color: '#a9a3d6', width: 3, font: NUM_FONT, weight: 700 });
    if (v.practice) outlinedText(ctx, 'PRACTICE', this.W / 2, 78 * u, { size: 14 * u, color: '#ffd23f', width: 3 });
  }

  /** Bottom panel: live recognition ring + "next letter" guide card. */
  drawPanel(side, g, v) {
    const { ctx } = this;
    const u = this.u;
    const col = PLAYER_COLORS[side];
    const c = v.confirm?.[side];
    const p = g.players[side];
    const x0 = side * this.sideW;
    const yTop = this.baseY + 14 * u;
    const ph = this.H - yTop - 8 * u;
    const previewHalf = v.showPreview !== false && v.video ? this.previewRect().w / 2 + 14 * u : 0;
    const inner = side === 0 ? this.sideW - previewHalf : this.sideW - previewHalf;
    const ringR = Math.min(ph * 0.38, 62 * u);
    const ringX = side === 0 ? x0 + 24 * u + ringR : x0 + this.sideW - 24 * u - ringR;
    const ringY = yTop + ph / 2;
    const slowed = p.slowUntil > g.t;

    ctx.save();
    roundRect(ctx, side === 0 ? x0 + 8 * u : x0 + previewHalf, yTop, inner - 8 * u, ph, 16 * u);
    ctx.fillStyle = 'rgba(8,4,26,0.72)';
    ctx.fill();
    ctx.strokeStyle = hexA(col, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // recognition ring
    const disp = c?.display ?? { letter: null, confidence: 0 };
    const hasHand = !!v.hands?.[side] || !v.cameraOn;
    const hasted = p.hasteUntil > g.t;
    const ringCol = slowed && !hasted ? SLOW : hasted && !slowed ? EFFECTS.haste.color : col;
    progressRing(ctx, ringX, ringY, ringR, c?.progress ?? 0, c?.needsRelease ? '#ffffff' : ringCol, 8 * u);
    if (slowed && !this.reduced) {
      ctx.save();
      ctx.strokeStyle = hexA(SLOW, 0.5);
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const k = (v.t * 0.5 + i / 2) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(ringX, ringY, ringR * (1 + k * 0.35), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
    const confident = c?.candidate && !c.needsRelease;
    let big = '–';
    let sub = '';
    let subCol = '#a9a3d6';
    if (!v.cameraOn && !c?.candidate) { big = ''; sub = side === 0 ? 'keys: a–y' : 'keys: Shift+a–y'; }
    else if (!hasHand) { big = ''; sub = 'no hand'; subCol = '#ff9b9b'; }
    else if (c?.needsRelease) { big = c.candidate; sub = 'relax to repeat'; subCol = '#ffffff'; }
    else if (confident) { big = c.candidate; sub = `${Math.round(disp.confidence * 100)}%`; subCol = col; }
    else if (disp.letter) { big = disp.letter; sub = 'unsure – hold steady'; subCol = '#8f89b8'; }
    if (!hasHand) {
      ctx.save();
      ctx.globalAlpha = 0.35 + (this.reduced ? 0 : 0.15 * Math.sin(v.t * 4));
      drawTemplate(ctx, this.templates.B, ringX, ringY, ringR * 1.1, '#ff9b9b', this.handOf(side, v));
      ctx.restore();
    }
    outlinedText(ctx, big, ringX, ringY + 2, {
      size: ringR * 0.95, color: confident || c?.needsRelease ? '#fff' : 'rgba(255,255,255,0.4)', font: LETTER_FONT, weight: 900,
    });
    outlinedText(ctx, sub, ringX, ringY + ringR + 14 * u, { size: 13 * u, color: subCol, font: UI_FONT, weight: 700, width: 3 });
    if (slowed || hasted) {
      const label = slowed && hasted ? 'SLOW + HASTE' : slowed ? 'SLOWED' : 'HASTE ×1.6';
      outlinedText(ctx, label, ringX, yTop + 12 * u, { size: 13 * u, color: hasted && !slowed ? EFFECTS.haste.color : SLOW, width: 3 });
    }

    // next letter guide
    const focus = this.focusTarget(side, g, v);
    const next = focus?.letters[focus.idx];
    const cardX = side === 0 ? ringX + ringR + 26 * u : x0 + previewHalf + 18 * u;
    const cardW = side === 0 ? x0 + this.sideW - previewHalf - cardX - 14 * u : ringX - ringR - 26 * u - cardX;
    if (cardW < 120 * u) return;
    const tplSize = Math.min(ph * 0.78, 110 * u);
    if (next) {
      const tx = cardX + tplSize / 2 + 6 * u;
      drawTemplate(ctx, this.templates[next], tx, ringY, tplSize * 0.88, col, this.handOf(side, v));
      const textX = cardX + tplSize + 22 * u;
      outlinedText(ctx, 'NEXT', textX, ringY - 34 * u, { size: 12 * u, color: '#a9a3d6', align: 'left', font: UI_FONT, weight: 700, width: 3 });
      outlinedText(ctx, next, textX, ringY - 4 * u, { size: 42 * u, color: '#fff', align: 'left', font: LETTER_FONT, weight: 900 });
      this.wrapText(LETTER_HINTS[next] ?? '', textX, ringY + 28 * u, cardX + cardW - textX, 14 * u, '#d9d4ff');
    } else {
      outlinedText(ctx, 'Clear skies…', cardX + cardW / 2, ringY, { size: 16 * u, color: '#8f89b8', font: UI_FONT, weight: 600, width: 3 });
    }
  }

  wrapText(text, x, y, maxW, size, color) {
    const { ctx } = this;
    ctx.font = `600 ${Math.round(size)}px ${UI_FONT}`;
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        outlinedText(ctx, line, x, yy, { size, color, align: 'left', font: UI_FONT, weight: 600, width: 3 });
        line = w;
        yy += size * 1.3;
      } else line = test;
    }
    if (line) outlinedText(ctx, line, x, yy, { size, color, align: 'left', font: UI_FONT, weight: 600, width: 3 });
  }

  previewRect() {
    const w = Math.round(Math.min(300 * this.u, this.W * 0.2));
    const h = Math.round(w * 0.5625);
    return { x: Math.round(this.W / 2 - w / 2), y: Math.round(this.H - h - 10 * this.u), w, h };
  }

  /** Small mirrored webcam view with per-player skeletons and predicted letters. */
  drawPreview(v) {
    const { ctx } = this;
    const { x, y, w, h } = this.previewRect();
    const vid = v.video; // the tracker's frame snapshot (canvas) or a <video>
    const VW = vid.videoWidth ?? vid.width;
    const VH = vid.videoHeight ?? vid.height;
    if (!VW || !VH) return;
    ctx.save();
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 12);
    ctx.fillStyle = 'rgba(8,4,26,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,120,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    roundRect(ctx, x, y, w, h, 10);
    ctx.clip();
    // cover-fit the video into the box, mirrored
    const va = VW / VH;
    const ba = w / h;
    let sw = VW;
    let sh = VH;
    let sx = 0;
    let sy = 0;
    if (va > ba) { sw = sh * ba; sx = (VW - sw) / 2; } else { sh = sw / ba; sy = (VH - sh) / 2; }
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    // centre line: P1 stands left, P2 right
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 4);
    ctx.lineTo(x + w / 2, y + h - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    const map = (p) => {
      const px = ((p.x * VW - sx) / sw);
      const py = ((p.y * VH - sy) / sh);
      return [x + (1 - px) * w, y + py * h];
    };
    for (const side of [0, 1]) {
      const hd = v.hands?.[side];
      if (!hd) continue;
      const pts = hd.landmarks.map(map);
      drawSkeleton(ctx, pts, PLAYER_COLORS[side], { width: 2, joints: false });
      const c = v.confirm?.[side];
      const L = c?.display?.letter;
      const conf = c?.display?.confidence ?? 0;
      const lx = Math.min(x + w - 30, Math.max(x + 30, pts[0][0]));
      const ly = Math.min(y + h - 12, pts[0][1] + 14);
      const label = `P${side + 1} ${L ?? '?'} ${Math.round(conf * 100)}%`;
      ctx.font = `700 ${Math.round(12 * this.u + 2)}px ${UI_FONT}`;
      const tw = ctx.measureText(label).width + 12;
      roundRect(ctx, lx - tw / 2, ly - 10, tw, 20, 6);
      ctx.fillStyle = PLAYER_COLORS[side];
      ctx.fill();
      ctx.fillStyle = '#0a0620';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 1);
    }
    ctx.restore();
    if (v.labels) {
      outlinedText(ctx, 'P1', x + 14, y + 14, { size: 12, color: PLAYER_COLORS[0], width: 3 });
      outlinedText(ctx, 'P2', x + w - 14, y + 14, { size: 12, color: PLAYER_COLORS[1], width: 3 });
    }
  }
}
