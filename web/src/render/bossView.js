// Co-op boss presentation: the boss itself, its HUD, attack telegraphs, the core link chain,
// the shield and shield nodes, damage bolts and the defeat sequence.
import { BOSS } from '../game/boss.js';
import { PLAYER_COLORS } from '../game/letters.js';
import { FONT, UI_FONT, hexA, outlinedText, progressRing, roundRect } from './draw.js';

const TAU = Math.PI * 2;
const PHASE_COLORS = ['#a66bff', '#ff8a1f', '#ff2e4d'];
const ATTACK_NAMES = { volley: 'VOLLEY', meteor: 'METEOR', barrage: 'BARRAGE', curse: 'CURSE' };
const SHIELD_COL = '#9fe8ff';

export class BossView {
  constructor(r) {
    this.r = r;
    this.hitFlash = 0;
    this.jiggle = 0;
    this.lookX = 0; // pupil direction -1..1
    this.dead = null; // death sequence timer
    this.phaseBanner = null;
  }

  reset() {
    this.hitFlash = 0; this.jiggle = 0; this.dead = null; this.phaseBanner = null; this.speech = null;
  }

  /** The boss speaks: typewriter speech bubble + voice blips. `live` = line came from Gemini. */
  say(text, live = false) {
    this.speech = { text, live, t: 0, shown: 0 };
  }

  get pos() {
    const { r } = this;
    return [r.W / 2, r.top + r.fieldH * 0.17];
  }

  get size() {
    const { r } = this;
    return Math.max(46, Math.min(r.sideW * 0.3, r.fieldH * 0.17));
  }

  color(g) { return PHASE_COLORS[g.boss.phase] ?? PHASE_COLORS[0]; }

  // ---------------------------------------------------------------- events
  handle(e, g) {
    const { r } = this;
    const [bx, by] = this.pos;
    const R = this.size;
    const pan = (s) => (s === 0 ? -0.6 : s === 1 ? 0.6 : 0);
    switch (e.type) {
      case 'bossHit': {
        if (e.src) {
          const [sx, sy] = r.pos({ side: e.src.side ?? e.side, x: e.src.x, y: e.src.y });
          r.fx.beam(sx, sy, bx, by, PLAYER_COLORS[e.side], 0.3);
        }
        this.hitFlash = Math.min(1, this.hitFlash + 0.6);
        this.jiggle = Math.min(1, this.jiggle + 0.5);
        const big = e.amount >= 50;
        r.fx.burst(bx + (Math.random() - 0.5) * R, by + (Math.random() - 0.5) * R * 0.6, { color: PLAYER_COLORS[e.side], n: big ? 40 : 14, speed: big ? 500 : 280, life: 0.5 });
        r.fx.text(bx + (Math.random() - 0.5) * R * 1.4, by - R * 0.4, `-${e.amount}`, { color: big ? '#ffd23f' : '#ffffff', size: (big ? 40 : 24) * r.u });
        if (big) { r.shake(8); r.sfx.explode(pan(e.side), true); } else r.sfx.bossHit(pan(e.side));
        break;
      }
      case 'bossBlocked':
        if (e.src) {
          const [sx, sy] = r.pos({ side: e.src.side ?? e.side, x: e.src.x, y: e.src.y });
          r.fx.beam(sx, sy, bx, by, SHIELD_COL, 0.25);
        }
        r.fx.ring(bx, by, { color: SHIELD_COL, radius: R * 1.6, life: 0.35, width: 4 });
        r.fx.text(bx, by + R * 1.1, 'BLOCKED', { color: SHIELD_COL, size: 18 * r.u, life: 0.6 });
        break;
      case 'bossTelegraph':
        r.sfx.bossCharge();
        break;
      case 'bossAttack': {
        const sides = e.side === -1 ? [0, 1] : [e.side];
        for (const s of sides) {
          const tx = s * r.sideW + r.sideW / 2;
          if (e.kind === 'curse') {
            const [x, y] = r.turret(s);
            r.fx.beam(bx, by, x, y, PHASE_COLORS[1] === this.color(g) ? '#b46bff' : '#b46bff', 0.6);
            r.fx.text(x, y - 80 * r.u, 'CURSED – slowed', { color: '#c79bff', size: 24 * r.u });
          } else {
            r.fx.ring(tx, r.top + 20, { color: this.color(g), radius: r.sideW * 0.4, life: 0.5, width: 6 });
          }
        }
        this.jiggle = 1;
        r.shake(6);
        r.sfx.bossAttack();
        break;
      }
      case 'spawn':
        if (e.fromBoss) {
          const [x, y] = r.pos({ side: e.side, x: e.x, y: 0 });
          r.fx.beam(bx, by + R * 0.4, x, y, this.color(g), 0.35);
        }
        break;
      case 'reflect':
        if (e.to === 'boss') {
          const [x, y] = r.turret(e.side);
          r.fx.beam(x, y, bx, by, '#ffffff', 0.5);
          r.fx.text(x, y - 90 * r.u, 'REFLECTED!', { color: '#ffffff', size: 30 * r.u });
          r.sfx.reflect(pan(e.side));
        }
        break;
      case 'coreOpen':
        r.sfx.coreOpen();
        r.fx.ring(bx, by, { color: '#ffffff', radius: R * 2.5, life: 0.6, width: 6 });
        break;
      case 'coreHit': {
        const [x, y] = r.turret(e.side);
        r.fx.beam(x, y, bx, by + R * 1.25, PLAYER_COLORS[e.side], 0.35);
        r.sfx.partial(pan(e.side), e.idx);
        break;
      }
      case 'coreBreak':
        r.fx.burst(bx, by, { color: '#ffffff', n: 80, speed: 700, life: 1.0, size: 4 });
        r.fx.ring(bx, by, { color: '#ffd23f', radius: r.W * 0.35, life: 0.8, width: 12 });
        r.orb.banners.push({ side: 0.5, text: 'CORE LINK!', sub: `-${BOSS.coreDamage} · boss stunned`, color: '#ffd23f', t: 0, life: 1.6 });
        r.hitStop = r.reduced ? 0 : 0.12;
        r.zoomPunch(bx, by, 0.05);
        r.shake(18);
        r.sfx.bassDrop(0);
        r.sfx.win();
        break;
      case 'coreClose':
        r.fx.text(bx, by + R * 1.4, 'core closed', { color: '#9aa3c7', size: 18 * r.u });
        break;
      case 'bossShield':
        r.fx.ring(bx, by, { color: SHIELD_COL, radius: R * 2.2, life: 0.7, width: 8 });
        r.sfx.effect('shield', 0);
        break;
      case 'nodeBreak': {
        r.fx.text(r.turret(e.side)[0], r.top + r.fieldH * 0.55, e.remaining ? 'Node down! 1 to go' : 'Both nodes down!', { color: SHIELD_COL, size: 26 * r.u });
        break;
      }
      case 'bossShieldBreak':
        r.fx.burst(bx, by, { color: SHIELD_COL, n: 90, speed: 650, life: 1.0 });
        r.fx.shards(bx, by, R * 1.5, SHIELD_COL, 28);
        r.orb.banners.push({ side: 0.5, text: 'SHIELD BROKEN!', sub: 'boss stunned – hit it now', color: SHIELD_COL, t: 0, life: 1.6 });
        r.shake(16);
        r.sfx.shatter(0);
        r.sfx.bassDrop(0);
        break;
      case 'bossShieldHold':
        r.orb.banners.push({ side: 0.5, text: 'TOO SLOW', sub: `boss regenerated ${e.heal} HP`, color: '#ff7a7a', t: 0, life: 1.6 });
        r.sfx.miss(0);
        break;
      case 'bossPhase':
        this.phaseBanner = { t: 0 };
        r.orb.banners.push({ side: 0.5, text: `PHASE ${e.phase + 1}`, sub: 'Break BOTH shield nodes!', color: PHASE_COLORS[e.phase], t: 0, life: 2.0 });
        r.fx.ring(bx, by, { color: PHASE_COLORS[e.phase], radius: r.W * 0.5, life: 0.9, width: 14 });
        r.shake(20);
        r.sfx.bossRoar();
        break;
      case 'gameOver':
        if (e.winner === 'team') { this.dead = { t: 0 }; r.sfx.bossExplode(); }
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, g) {
    if (this.speech) {
      const sp = this.speech;
      sp.t += dt;
      const n = Math.min(sp.text.length, Math.floor(sp.t * 38));
      if (n > sp.shown) {
        if (Math.floor(n / 2) > Math.floor(sp.shown / 2) && /\w/.test(sp.text[n - 1])) this.r.sfx.bossVoice();
        sp.shown = n;
      }
      if (sp.t > sp.text.length / 38 + 3.2) this.speech = null;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.jiggle = Math.max(0, this.jiggle - dt * 3);
    const tele = g.boss.telegraph;
    const want = tele ? (tele.side === -1 ? 0 : tele.side === 0 ? -1 : 1) : Math.sin(g.t * 0.6) * 0.5;
    this.lookX += (want - this.lookX) * Math.min(1, dt * 6);
    if (this.dead) {
      this.dead.t += dt;
      const { r } = this;
      const [bx, by] = this.pos;
      const R = this.size;
      if (this.dead.t < 1.5 && Math.random() < dt * 14) {
        const x = bx + (Math.random() - 0.5) * R * 2.4;
        const y = by + (Math.random() - 0.5) * R * 1.6;
        r.fx.burst(x, y, { color: Math.random() < 0.5 ? '#ffd23f' : this.color(g), n: 40, speed: 480, life: 0.8 });
        r.fx.ring(x, y, { color: '#ffffff', radius: R, life: 0.4, width: 6 });
        r.shake(6);
      }
      if (this.dead.t >= 1.5 && !this.dead.boom) {
        this.dead.boom = true;
        r.fx.burst(bx, by, { color: '#ffffff', n: 160, speed: 1100, life: 1.4, size: 5 });
        r.fx.debris(bx, by, this.color(g), 30, R * 2);
        r.fx.ring(bx, by, { color: '#ffd23f', radius: r.W * 0.7, life: 1.2, width: 18 });
        r.shake(22);
      }
    }
  }

  draw(ctx, g, v) {
    const b = g.boss;
    if (this.dead?.boom) return;
    const { r } = this;
    const t = v.t;
    const reduced = r.reduced;
    const col = this.color(g);
    const R = this.size;
    let [x, y] = this.pos;
    if (!reduced && this.jiggle > 0) { x += (Math.random() - 0.5) * 10 * this.jiggle; y += (Math.random() - 0.5) * 6 * this.jiggle; }
    if (!reduced) y += Math.sin(t * 1.2) * 4;
    const stunned = b.staggerUntil > g.t;
    const tele = b.telegraph;
    const charge = tele ? 1 - Math.max(0, (tele.at - b.clock) / BOSS.telegraph) : 0;

    ctx.save();
    // aura
    const aura = ctx.createRadialGradient(x, y, R * 0.3, x, y, R * 2.4);
    aura.addColorStop(0, hexA(col, 0.35 + 0.3 * charge));
    aura.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.4, 0, TAU);
    ctx.fill();

    // arms
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const sway = reduced ? 0 : Math.sin(t * 1.5 + i + (s > 0 ? 1 : 0)) * 0.15;
        const a0 = (s > 0 ? 0 : Math.PI) + s * (0.35 + i * 0.32 + sway);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a0) * R * 0.9, y + Math.sin(a0) * R * 0.7);
        ctx.quadraticCurveTo(
          x + Math.cos(a0) * R * 1.6, y + Math.sin(a0) * R * 1.1 - R * 0.2,
          x + Math.cos(a0 + s * 0.3) * R * 2.0, y + Math.sin(a0 + s * 0.3) * R * 1.4 + R * 0.15,
        );
        ctx.stroke();
      }
    }

    // rotating outer ring segments
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + (reduced ? 0 : t * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, R * 1.25, a, a + 0.6);
      ctx.stroke();
    }

    // hull
    ctx.shadowBlur = 24;
    const hull = ctx.createLinearGradient(x, y - R, x, y + R);
    hull.addColorStop(0, '#2a1650');
    hull.addColorStop(1, '#0c0620');
    ctx.fillStyle = hull;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const rr = R * (i % 2 ? 1.0 : 0.92);
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr * 1.15, y + Math.sin(a) * rr * 0.85);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.hitFlash > 0 ? '#ffffff' : col;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // eye
    const ew = R * 0.62;
    const eh = R * (b.core ? 0.55 : stunned ? 0.1 : 0.38);
    ctx.fillStyle = b.core ? '#fff7d6' : '#f2ecff';
    ctx.beginPath();
    ctx.ellipse(x, y, ew, eh, 0, 0, TAU);
    ctx.fill();
    if (!stunned) {
      const px = x + this.lookX * ew * 0.45;
      const irisCol = b.core ? '#ffd23f' : tele ? '#ff2e4d' : col;
      const ir = Math.min(eh, R * 0.3);
      const iris = ctx.createRadialGradient(px, y, 0, px, y, ir);
      iris.addColorStop(0, '#ffffff');
      iris.addColorStop(0.35, irisCol);
      iris.addColorStop(1, hexA(irisCol, 0.6));
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(px, y, ir, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0a0418';
      ctx.beginPath();
      ctx.ellipse(px, y, ir * (b.core ? 0.25 : 0.18), ir * 0.7, 0, 0, TAU);
      ctx.fill();
    } else {
      outlinedText(ctx, 'STUNNED', x, y + R * 0.05, { size: 16 * r.u, color: '#ffd23f', width: 3 });
      for (let i = 0; i < 3; i++) { // dizzy stars
        const a = (reduced ? 0 : t * 4) + (i / 3) * TAU;
        outlinedText(ctx, '*', x + Math.cos(a) * R * 0.8, y - R * 0.75 + Math.sin(a) * R * 0.15, { size: 22 * r.u, color: '#ffd23f', width: 3 });
      }
    }
    if (this.hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${this.hitFlash * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(x, y, R * 1.15, R * 0.85, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // charging: particles converge, warning on the target side(s)
    if (tele) {
      if (!reduced && Math.random() < 0.6) {
        const a = Math.random() * TAU;
        r.fx.items.push({ kind: 'dot', x: x + Math.cos(a) * R * 2.4, y: y + Math.sin(a) * R * 2, vx: -Math.cos(a) * R * 3, vy: -Math.sin(a) * R * 2.5, life: 0.4, age: 0, color: '#ff4a4a', size: 3 });
      }
      progressRing(ctx, x, y, R * 1.45, charge, '#ff4a4a', 5, 'rgba(255,255,255,0.08)');
      const sides = tele.side === -1 ? [0, 1] : [tele.side];
      for (const s of sides) {
        const cx = s * r.sideW + r.sideW / 2;
        const blink = reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 18);
        ctx.globalAlpha = blink;
        ctx.fillStyle = 'rgba(255,40,60,0.16)';
        ctx.fillRect(s * r.sideW, r.top, r.sideW, 48 * r.u);
        ctx.globalAlpha = 1;
        outlinedText(ctx, `${ATTACK_NAMES[tele.kind]} INCOMING`, cx, r.top + 26 * r.u, { size: 24 * r.u, color: '#ff5a6a', width: 4 });
      }
    }

    // shield dome
    if (b.shield) {
      const left = Math.max(0, b.shield.until - g.t);
      ctx.strokeStyle = SHIELD_COL;
      ctx.lineWidth = 3;
      ctx.shadowColor = SHIELD_COL;
      ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 5);
      ctx.beginPath();
      ctx.ellipse(x, y, R * 1.9, R * 1.35, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 10; i++) { // hex cells
        const a = (i / 10) * TAU + (reduced ? 0 : t * 0.4);
        const hx = x + Math.cos(a) * R * 1.55;
        const hy = y + Math.sin(a) * R * 1.1;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) ctx[k ? 'lineTo' : 'moveTo'](hx + Math.cos((k / 6) * TAU) * 12 * r.u, hy + Math.sin((k / 6) * TAU) * 12 * r.u);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      outlinedText(ctx, `SHIELDED · break both nodes (${Math.ceil(left)}s)`, x, y + R * 1.6, { size: 16 * r.u, color: SHIELD_COL, font: UI_FONT, weight: 800, width: 4 });
      const st = b.shield.cleared;
      [0, 1].forEach((s) => {
        outlinedText(ctx, st[s] ? `P${s + 1} node ✓` : `P${s + 1} node`, x + (s ? 1 : -1) * R * 1.3, y + R * 1.95, {
          size: 14 * r.u, color: st[s] ? '#3dff7a' : PLAYER_COLORS[s], font: UI_FONT, weight: 800, width: 3,
        });
      });
    }

    // core link chain
    if (b.core) this.drawCore(ctx, g, x, y, R, t);
    ctx.restore();
  }

  drawCore(ctx, g, x, y, R, t) {
    const { r } = this;
    const c = g.boss.core;
    const left = Math.max(0, (c.until - g.t) / c.life);
    progressRing(ctx, x, y, R * 1.55, left, left < 0.3 ? '#ff5050' : '#ffd23f', 5, 'rgba(255,255,255,0.08)');
    const s = Math.max(34, 44 * r.u);
    const gap = 10 * r.u;
    const total = c.letters.length * (s + gap) - gap;
    let cx = x - total / 2;
    const cy = y + R * 1.25;
    outlinedText(ctx, 'CORE LINK – take turns!', x, cy - s * 0.95, { size: 15 * r.u, color: '#ffd23f', font: UI_FONT, weight: 800, width: 4 });
    for (let i = 0; i < c.letters.length; i++) {
      const owner = c.owners[i];
      const col = PLAYER_COLORS[owner];
      const done = i < c.idx;
      const cur = i === c.idx;
      const pulse = cur && !r.reduced ? 1 + 0.08 * Math.sin(t * 10) : 1;
      const w = s * pulse;
      ctx.save();
      roundRect(ctx, cx + (s - w) / 2, cy - w / 2, w, w, 8);
      ctx.fillStyle = done ? hexA(col, 0.25) : cur ? col : 'rgba(10,6,30,0.9)';
      ctx.shadowColor = col;
      ctx.shadowBlur = cur ? 20 : 0;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.restore();
      outlinedText(ctx, done ? '✓' : c.letters[i], cx + s / 2, cy + 1, {
        size: s * 0.6, color: cur ? '#0a0620' : done ? col : '#ffffff', font: UI_FONT, weight: 900, width: cur ? 0 : 3,
      });
      outlinedText(ctx, `P${owner + 1}`, cx + s / 2, cy + s * 0.78, { size: 12 * r.u, color: col, font: UI_FONT, weight: 800, width: 3 });
      cx += s + gap;
    }
  }

  /** Shield node: a crystalline relay (instead of an orb). */
  drawNode(o, x, y, rad, t) {
    const { ctx } = this.r;
    ctx.save();
    ctx.shadowColor = SHIELD_COL;
    ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(159,232,255,0.14)';
    ctx.strokeStyle = SHIELD_COL;
    ctx.lineWidth = 3;
    const spin = this.r.reduced ? 0 : t * 0.8;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU + spin;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // tether to the boss
    const [bx, by] = this.pos;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -t * 40;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const life = Math.max(0, 1 - o.age / o.life);
    progressRing(ctx, x, y, rad * 1.35, life, life < 0.3 ? '#ff5050' : SHIELD_COL, 4, 'rgba(255,255,255,0.08)');
    ctx.restore();
    outlinedText(ctx, 'SHIELD NODE', x, y - rad * 1.4 - 12 * this.r.u, { size: 14 * this.r.u, color: SHIELD_COL, width: 4 });
    outlinedText(ctx, o.letters[o.idx], x, y + 2, { size: Math.max(26, rad * 0.75), color: '#ffffff', font: UI_FONT, weight: 900 });
  }

  /** Speech bubble beside the eye (drawn on top of everything). */
  drawSpeech(ctx, g) {
    const sp = this.speech;
    if (!sp || this.dead?.boom) return;
    const { r } = this;
    const u = r.u;
    const [bx, by] = this.pos;
    const R = this.size;
    const fade = Math.min(1, sp.t / 0.15, Math.max(0, sp.text.length / 38 + 3.2 - sp.t) / 0.4);
    const size = Math.max(14, 17 * u);
    ctx.save();
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    const maxW = Math.min(320 * u, r.W - (bx + R * 1.45) - 24);
    const words = sp.text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    const lh = size * 1.3;
    const pad = 12 * u;
    const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
    const h = lines.length * lh + pad * 2 + (sp.live ? 12 * u : 0);
    const x = bx + R * 1.45;
    const y = Math.max(r.top + 8 * u, by - R * 0.95); // stay clear of the HUD
    const col = this.color(g);
    ctx.globalAlpha = fade;
    // tail toward the eye
    ctx.fillStyle = 'rgba(14,7,36,0.95)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + h * 0.55);
    ctx.lineTo(bx + R * 0.95, by - R * 0.1);
    ctx.lineTo(x + 4, y + h * 0.8);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, x, y, w, h, 12 * u);
    ctx.fill();
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // typewriter text
    let left = sp.shown;
    ctx.fillStyle = '#f3eeff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      const part = l.slice(0, Math.max(0, left));
      left -= l.length + 1;
      ctx.fillText(part, x + pad, y + pad + i * lh);
    });
    if (sp.live) {
      ctx.font = `800 ${Math.round(9 * u + 2)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = hexA(col, 0.9);
      ctx.fillText('✦ GEMINI', x + pad, y + h - pad - 4 * u);
    }
    ctx.restore();
  }

  /** Centre of the HUD: boss health with phase ticks, and the shared team pool. */
  drawHud(ctx, g, v, freeW) {
    const { r } = this;
    const u = r.u;
    const b = g.boss;
    const w = Math.max(160, Math.min(r.W * 0.32, freeW));
    const x = r.W / 2 - w / 2;
    // boss
    outlinedText(ctx, BOSS.name, r.W / 2, 16 * u, { size: 14 * u, color: this.color(g), width: 3 });
    const bh = 14 * u;
    let y = 28 * u;
    ctx.save();
    roundRect(ctx, x, y, w, bh, bh / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const frac = b.hp / b.maxHp;
    if (frac > 0) {
      roundRect(ctx, x, y, Math.max(bh, w * frac), bh, bh / 2);
      ctx.fillStyle = b.shield ? SHIELD_COL : this.color(g);
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    for (const f of BOSS.phaseAt) { // phase ticks
      ctx.beginPath();
      ctx.moveTo(x + w * f, y - 3);
      ctx.lineTo(x + w * f, y + bh + 3);
      ctx.stroke();
    }
    ctx.restore();
    outlinedText(ctx, `${b.hp}`, x + w / 2, y + bh / 2 + 1, { size: 11 * u, color: '#fff', font: UI_FONT, weight: 800, width: 3 });
    // team
    y += bh + 12 * u;
    const th = 12 * u;
    const tf = g.team.health / g.team.max;
    ctx.save();
    roundRect(ctx, x, y, w, th, th / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    if (tf > 0) {
      roundRect(ctx, x, y, Math.max(th, w * tf), th, th / 2);
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, PLAYER_COLORS[0]);
      grad.addColorStop(1, PLAYER_COLORS[1]);
      ctx.fillStyle = tf > 0.3 ? grad : '#ff3b3b';
      ctx.fill();
    }
    ctx.restore();
    outlinedText(ctx, `TEAM ${Math.ceil(g.team.health)}/${g.team.max}`, x + w / 2, y + th / 2 + 1, { size: 10 * u, color: '#fff', font: UI_FONT, weight: 800, width: 3 });
    const mm = Math.floor(g.t / 60);
    const ss = Math.floor(g.t % 60).toString().padStart(2, '0');
    const rules = `${g.shareTargets ? 'shared' : 'own'} targets · ${g.shareOrbs ? 'shared' : 'own'} power-ups`;
    outlinedText(ctx, `${mm}:${ss} · ${rules}`, r.W / 2, y + th + 12 * u, { size: 11 * u, color: '#a9a3d6', font: UI_FONT, weight: 700, width: 3 });
    void FONT;
  }
}
