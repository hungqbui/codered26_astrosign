// The "orb break" moment: shatter, flash, light rays, hit-stop, zoom punch, then the effect's
// icon flies to whoever it affects and lands with an effect-specific finisher and a banner.
import { EFFECTS } from '../game/effects.js';
import { PLAYER_NAMES } from '../game/letters.js';
import { FONT, drawIcon, hexA, outlinedText } from './draw.js';

const TAU = Math.PI * 2;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOutBack = (k) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;

export function effectColor(def, t) {
  return def.prismatic ? `hsl(${(t * 140) % 360}, 100%, 78%)` : def.color;
}

export class OrbFx {
  constructor(r) {
    this.r = r; // the Renderer (layout, particles, sfx, shake)
    this.rays = [];
    this.flyers = [];
    this.banners = [];
    this.waves = [];
    this.beams = [];
    this.flashes = [];
  }

  clear() {
    this.rays = []; this.flyers = []; this.banners = []; this.waves = []; this.beams = []; this.flashes = [];
  }

  // ---------------------------------------------------------------- triggers
  /** The bubble itself breaks. */
  shatter(o, x, y, rad, side) {
    const { r } = this;
    const def = EFFECTS[o.effect];
    const col = def.color;
    const reduced = r.reduced;
    r.fx.shards(x, y, rad, col, reduced ? 8 : 22);
    r.fx.burst(x, y, { color: def.glow, n: 50, speed: 650, life: 0.8, size: 3 });
    r.fx.burst(x, y, { color: '#ffffff', n: 24, speed: 300, life: 0.45, kind: 'dot', size: 3 });
    r.fx.ring(x, y, { color: '#ffffff', radius: rad * 2.2, life: 0.3, width: 10 });
    r.fx.ring(x, y, { color: col, radius: rad * 4.5, life: 0.7, width: 14 });
    r.fx.ring(x, y, { color: def.glow, radius: rad * 6.5, life: 0.95, width: 4 });
    if (!reduced) {
      this.rays.push({ x, y, color: col, t: 0, life: 0.75, rot: Math.random() * TAU, n: 14, len: rad * 9 });
      this.flashes.push({ side, color: col, t: 0, life: 0.28 });
      r.hitStop = 0.11;
      r.zoomPunch(x, y, 0.045);
    }
    r.shake(16);
    r.sfx.shatter(side === 0 ? -0.6 : 0.6);
  }

  /** The effect launches from the bubble towards its target. */
  activate(e) {
    const { r } = this;
    const def = EFFECTS[e.effect];
    const from = e.origin ? r.pos({ side: e.side, x: e.origin.x, y: e.origin.y }) : r.turret(e.side);
    const anchor = (side) => [side * r.sideW + r.sideW / 2, r.top + r.fieldH * 0.3];
    const pts = [from];
    if (e.reflected) pts.push(anchor(1 - e.side)); // flies to the reflector first, then bounces home
    if (e.shared) {
      // Co-op shared power-up: the icon splits and lands on both players; one banner.
      for (const tgt of [0, 1]) {
        const e2 = { ...e, target: tgt, quietBanner: tgt !== e.side };
        this.flyers.push({ e: e2, def, pts: [from, this.landingPoint(e.effect, tgt)], t: 0, legDur: 0.5, trail: [] });
      }
      return;
    }
    const atBoss = e.coop && ['attack', 'slow', 'leech'].includes(e.effect);
    pts.push(atBoss ? r.boss.pos : this.landingPoint(e.effect, e.target));
    this.flyers.push({ e, def, pts, t: 0, legDur: e.reflected ? 0.38 : 0.5, trail: [] });
  }

  /** A Reflect barrier caught an offensive orb. */
  reflect(e) {
    const { r } = this;
    const [x, y] = [e.side * r.sideW + r.sideW / 2, r.top + r.fieldH * 0.3];
    // Lands when the incoming flyer reaches the barrier (first leg).
    setTimeout(() => {
      r.fx.ring(x, y, { color: '#ffffff', radius: r.sideW * 0.35, life: 0.5, width: 10 });
      r.fx.burst(x, y, { color: '#ffffff', n: 40, speed: 500, life: 0.6 });
      this.banners.push({ side: e.side, text: 'REFLECTED!', sub: `${EFFECTS[e.effect].name} bounced back`, color: '#ffffff', prismatic: true, t: 0, life: 1.4 });
      r.shake(8);
      r.sfx.reflect(e.side === 0 ? -0.6 : 0.6);
    }, 380);
  }

  landingPoint(effect, side) {
    const { r } = this;
    if (['heal', 'shield', 'haste', 'leech'].includes(effect)) return r.turret(side);
    return [side * r.sideW + r.sideW / 2, r.top + r.fieldH * 0.3];
  }

  /** Effect-specific finisher when the flying icon lands. */
  arrive(f) {
    const { r } = this;
    const { e, def } = f;
    const [x, y] = f.pts[f.pts.length - 1];
    // Team-level co-op effects (boss damage / team heal) have their own finisher.
    if (e.coop && ['attack', 'slow', 'leech', 'heal'].includes(e.effect)) return this.arriveCoop(f, x, y);
    const side = e.target;
    const pan = side === 0 ? -0.6 : 0.6;
    r.fx.ring(x, y, { color: def.color, radius: 120 * r.u, life: 0.5, width: 12 });
    r.fx.burst(x, y, { color: def.glow, n: 36, speed: 420, life: 0.6 });
    r.effectFlash[side] = { color: def.color, t: performance.now() };
    const victim = ['attack', 'slow', 'leech'].includes(e.effect);
    const title = victim ? `${def.name.toUpperCase()} → ${PLAYER_NAMES[side]}` : `${def.name.toUpperCase()}!`;
    let sub = def.blurb;
    switch (e.effect) {
      case 'attack': sub = 'Incoming asteroids!'; break;
      case 'slow': sub = 'Gestures confirm at half speed'; break;
      case 'leech': sub = `${e.amount ?? 0} HP stolen`; break;
      case 'nova': sub = e.count ? `${e.count} asteroid${e.count > 1 ? 's' : ''} vaporised` : 'Nothing left to hit'; break;
      case 'heal': sub = '+20 HP'; break;
      case 'shield': sub = 'Next impact absorbed'; break;
      case 'freeze': sub = 'Your asteroids are frozen'; break;
      case 'haste': sub = 'Confirm 1.6× faster'; break;
      case 'reflect': sub = 'Next attack bounces back'; break;
      default:
    }
    if (e.shared) {
      if (!e.quietBanner) this.banners.push({ side: 0.5, text: `TEAM ${def.name.toUpperCase()}!`, sub: `${sub} · both players`, color: def.color, prismatic: def.prismatic, t: 0, life: 1.6 });
    } else this.banners.push({ side, text: title, sub, color: def.color, prismatic: def.prismatic, t: 0, life: 1.6 });

    switch (e.effect) {
      case 'nova':
        this.waves.push({ kind: 'nova', side, x, y, color: def.color, t: 0, life: 0.9 });
        r.fx.burst(x, y, { color: '#fff3c4', n: 90, speed: 900, life: 1.0, size: 4 });
        r.shake(20);
        break;
      case 'freeze':
        this.waves.push({ kind: 'frost', side, color: def.color, t: 0, life: 0.8 });
        r.fx.burst(x, y, { color: def.color, n: 70, speed: 650, life: 1.0, size: 2 });
        break;
      case 'heal':
        this.waves.push({ kind: 'column', side, x, color: def.color, t: 0, life: 1.2 });
        r.fx.burst(x, y, { color: def.color, n: 50, speed: 200, life: 1.4, angle: -Math.PI / 2, spread: 1.4, kind: 'dot', gravity: -160 });
        break;
      case 'shield':
        r.fx.ring(x, y, { color: def.color, radius: r.sideW * 0.5, life: 0.8, width: 10 });
        break;
      case 'haste':
        this.waves.push({ kind: 'speed', side, color: def.color, t: 0, life: 0.9 });
        break;
      case 'slow':
        this.waves.push({ kind: 'ripple', side, x, y, color: def.color, t: 0, life: 1.2 });
        break;
      case 'attack':
        this.waves.push({ kind: 'alarm', side, color: def.color, t: 0, life: 1.0 });
        break;
      case 'leech': {
        const gainer = 1 - side;
        this.beams.push({ from: r.turret(side), to: r.turret(gainer), color: def.color, t: 0, life: 1.3 });
        r.fx.text(r.turret(side)[0], r.turret(side)[1] - 70 * r.u, `-${e.amount ?? 0}`, { color: def.color, size: 34 * r.u });
        const gained = e.gained ?? e.amount ?? 0;
        setTimeout(() => r.fx.text(r.turret(gainer)[0], r.turret(gainer)[1] - 70 * r.u, gained ? `+${gained}` : 'full HP', { color: '#3dff7a', size: (gained ? 34 : 22) * r.u }), 700);
        break;
      }
      case 'reflect':
        this.waves.push({ kind: 'prism', side, color: def.color, t: 0, life: 0.9 });
        break;
      default:
    }
    r.shake(e.effect === 'nova' ? 4 : 9);
    if (!e.quietBanner) { // a shared power-up lands twice; play its sound once
      r.sfx.effect(e.effect, pan);
      r.sfx.bassDrop(pan);
    }
  }

  /** Co-op variants: offensive orbs land on the boss, Heal/Leech restore the team pool. */
  arriveCoop(f, x, y) {
    const { r } = this;
    const { e, def } = f;
    const pan = e.side === 0 ? -0.6 : 0.6;
    r.fx.ring(x, y, { color: def.color, radius: 140 * r.u, life: 0.55, width: 12 });
    r.fx.burst(x, y, { color: def.glow, n: 50, speed: 520, life: 0.7 });
    const text = {
      attack: ['ATTACK → BOSS', `-${e.damage ?? 0}`],
      slow: ['BOSS SLOWED', 'its attacks charge at half speed'],
      leech: ['LEECH', `-${e.damage ?? 0} boss · +${e.gained ?? 0} team`],
      heal: ['TEAM HEAL', `+${e.gained ?? 0} team health`],
    }[e.effect];
    if (text) this.banners.push({ side: 0.5, text: text[0], sub: text[1], color: def.color, t: 0, life: 1.5 });
    if (e.effect === 'leech' || e.effect === 'heal') {
      for (const s of [0, 1]) this.beams.push({ from: e.effect === 'leech' ? r.boss.pos : r.turret(e.side), to: r.turret(s), color: def.color, t: 0, life: 1.1 });
    }
    if (e.effect === 'slow') this.waves.push({ kind: 'ripple', side: 0.5, x, y, color: def.color, t: 0, life: 1.2 });
    r.shake(10);
    r.sfx.effect(e.effect, pan);
    r.sfx.bassDrop(pan);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const age = (list) => list.filter((o) => (o.t += dt) < o.life);
    this.rays = age(this.rays);
    this.banners = age(this.banners);
    this.waves = age(this.waves);
    this.beams = age(this.beams);
    this.flashes = age(this.flashes);
    this.flyers = this.flyers.filter((f) => {
      f.t += dt;
      const legs = f.pts.length - 1;
      if (f.t >= legs * f.legDur) { this.arrive(f); return false; }
      return true;
    });
  }

  flyerPos(f) {
    const legs = f.pts.length - 1;
    const leg = Math.min(legs - 1, Math.floor(f.t / f.legDur));
    const k = easeInOut(Math.min(1, (f.t - leg * f.legDur) / f.legDur));
    const [ax, ay] = f.pts[leg];
    const [bx, by] = f.pts[leg + 1];
    const lift = Math.sin(k * Math.PI) * 90 * this.r.u; // arc
    return [ax + (bx - ax) * k, ay + (by - ay) * k - lift];
  }

  /** Drawn above the playfield objects, below the HUD. */
  draw(ctx, t) {
    const { r } = this;
    // side flashes
    for (const f of this.flashes) {
      const k = 1 - f.t / f.life;
      ctx.fillStyle = hexA(f.color, 0.35 * k);
      ctx.fillRect(f.side * r.sideW, r.top, r.sideW, r.fieldH);
      ctx.fillStyle = `rgba(255,255,255,${0.25 * k})`;
      ctx.fillRect(f.side * r.sideW, r.top, r.sideW, r.fieldH);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // light rays
    for (const ray of this.rays) {
      const k = ray.t / ray.life;
      const a = (1 - k) * 0.55;
      for (let i = 0; i < ray.n; i++) {
        const ang = ray.rot + (i / ray.n) * TAU + k * 0.6;
        const w = 0.07 + 0.04 * Math.sin(i * 7.3);
        const len = ray.len * (0.4 + 0.6 * Math.min(1, k * 3)) * (0.7 + 0.3 * Math.sin(i * 3.1));
        const g = ctx.createLinearGradient(ray.x, ray.y, ray.x + Math.cos(ang) * len, ray.y + Math.sin(ang) * len);
        g.addColorStop(0, hexA(ray.color, a));
        g.addColorStop(1, hexA(ray.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ray.x, ray.y);
        ctx.lineTo(ray.x + Math.cos(ang - w) * len, ray.y + Math.sin(ang - w) * len);
        ctx.lineTo(ray.x + Math.cos(ang + w) * len, ray.y + Math.sin(ang + w) * len);
        ctx.closePath();
        ctx.fill();
      }
    }
    // side-wide finishers
    for (const w of this.waves) this.drawWave(ctx, w, t);
    // leech beams
    for (const b of this.beams) {
      const k = b.t / b.life;
      const a = Math.min(1, (1 - k) * 2);
      const [x0, y0] = b.from;
      const [x1, y1] = b.to;
      const mx = (x0 + x1) / 2;
      const my = Math.min(y0, y1) - r.fieldH * 0.35;
      ctx.lineCap = 'round';
      for (const [wd, al] of [[16, 0.25], [6, 0.7], [2, 1]]) {
        ctx.strokeStyle = wd === 2 ? `rgba(255,255,255,${a})` : hexA(b.color, al * a);
        ctx.lineWidth = wd;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(mx, my, x1, y1);
        ctx.stroke();
      }
      for (let i = 0; i < 10; i++) { // blood motes flowing to the gainer
        const q = (k * 2 + i / 10) % 1;
        const px = (1 - q) ** 2 * x0 + 2 * (1 - q) * q * mx + q * q * x1;
        const py = (1 - q) ** 2 * y0 + 2 * (1 - q) * q * my + q * q * y1;
        ctx.fillStyle = hexA(b.color, a);
        ctx.beginPath();
        ctx.arc(px, py, 5 * r.u, 0, TAU);
        ctx.fill();
      }
    }
    // flying icons
    for (const f of this.flyers) {
      const [x, y] = this.flyerPos(f);
      f.trail.push([x, y]);
      if (f.trail.length > 14) f.trail.shift();
      const col = effectColor(f.def, t);
      f.trail.forEach(([tx, ty], i) => {
        ctx.fillStyle = f.def.prismatic ? `hsla(${(t * 140 + i * 20) % 360},100%,75%,${(i / f.trail.length) * 0.5})` : hexA(f.def.color, (i / f.trail.length) * 0.5);
        ctx.beginPath();
        ctx.arc(tx, ty, (6 + i * 1.3) * r.u, 0, TAU);
        ctx.fill();
      });
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 46 * r.u);
      rg.addColorStop(0, 'rgba(255,255,255,0.9)');
      rg.addColorStop(0.4, f.def.prismatic ? 'rgba(200,210,255,0.6)' : hexA(f.def.color, 0.6));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, 46 * r.u, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      drawIcon(ctx, f.def.icon, x, y, 34 * r.u, col, t);
      ctx.globalCompositeOperation = 'lighter';
    }
    ctx.restore();
  }

  drawWave(ctx, w, t) {
    const { r } = this;
    const k = w.t / w.life;
    const x0 = w.side * r.sideW;
    const a = 1 - k;
    switch (w.kind) {
      case 'nova': {
        const rad = r.sideW * 1.1 * easeInOut(Math.min(1, k * 1.4));
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, r.top, r.sideW, r.fieldH);
        ctx.clip();
        const g = ctx.createRadialGradient(w.x, w.y, rad * 0.6, w.x, w.y, rad);
        g.addColorStop(0, hexA(w.color, 0));
        g.addColorStop(0.8, hexA(w.color, 0.5 * a));
        g.addColorStop(1, `rgba(255,255,255,${0.8 * a})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(w.x, w.y, rad, 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'frost': {
        ctx.strokeStyle = hexA(w.color, 0.8 * a);
        ctx.lineWidth = 2;
        for (let i = 0; i < 18; i++) { // ice cracks creeping in from the edges
          const fromLeft = i % 2 === 0;
          const sx = fromLeft ? x0 : x0 + r.sideW;
          const sy = r.top + ((i * 97) % 100) / 100 * r.fieldH;
          let px = sx;
          let py = sy;
          ctx.beginPath();
          ctx.moveTo(px, py);
          const steps = Math.floor(6 * Math.min(1, k * 2.5));
          for (let j = 0; j < steps; j++) {
            px += (fromLeft ? 1 : -1) * (14 + ((i * 13 + j * 7) % 18)) * r.u;
            py += (((i * 31 + j * 17) % 30) - 15) * r.u;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        break;
      }
      case 'column': {
        const g = ctx.createLinearGradient(0, r.baseY, 0, r.top);
        g.addColorStop(0, hexA(w.color, 0.5 * a));
        g.addColorStop(1, hexA(w.color, 0));
        ctx.fillStyle = g;
        const wd = 140 * r.u * (0.6 + 0.4 * Math.sin(k * Math.PI));
        ctx.fillRect(w.x - wd / 2, r.top, wd, r.baseY - r.top);
        break;
      }
      case 'speed': {
        ctx.strokeStyle = hexA(w.color, 0.7 * a);
        ctx.lineWidth = 3;
        for (let i = 0; i < 16; i++) {
          const y = r.top + ((i * 61) % 100) / 100 * r.fieldH;
          const len = r.sideW * (0.15 + ((i * 37) % 30) / 100);
          const x = x0 + ((k * 2.2 + i * 0.13) % 1.3) * r.sideW - len;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + len, y);
          ctx.stroke();
        }
        break;
      }
      case 'ripple':
        for (let i = 0; i < 3; i++) {
          const q = Math.min(1, k * 1.5 - i * 0.15);
          if (q <= 0) continue;
          ctx.strokeStyle = hexA(w.color, (1 - q) * 0.8);
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(w.x, w.y, r.sideW * 0.7 * q, 0, TAU);
          ctx.stroke();
        }
        break;
      case 'alarm': {
        const blink = 0.5 + 0.5 * Math.sin(k * 30);
        ctx.strokeStyle = hexA(w.color, 0.8 * a * blink);
        ctx.lineWidth = 10;
        ctx.strokeRect(x0 + 5, r.top + 5, r.sideW - 10, r.fieldH - 10);
        break;
      }
      case 'prism': {
        for (let i = 0; i < 6; i++) {
          ctx.strokeStyle = `hsla(${(i * 60 + t * 200) % 360},100%,70%,${0.6 * a})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(x0 + r.sideW / 2, r.top + r.fieldH * 0.3, r.sideW * 0.45 * (0.4 + k * 0.6 + i * 0.03), 40 * r.u, 0, Math.PI, TAU);
          ctx.stroke();
        }
        break;
      }
      default:
    }
  }

  /** Banners go on top of everything (after HUD) so they stay readable. */
  drawBanners(ctx, t) {
    const { r } = this;
    for (const b of this.banners) {
      const k = b.t / b.life;
      const pop = easeOutBack(Math.min(1, b.t / 0.22));
      const a = k > 0.75 ? (1 - k) / 0.25 : 1;
      const cx = b.side * r.sideW + r.sideW / 2;
      const cy = r.top + r.fieldH * 0.5;
      const size = Math.min(64 * r.u, r.sideW / Math.max(8, b.text.length * 0.72)) * (r.reduced ? 1 : 0.6 + 0.4 * pop);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      const col = b.prismatic ? `hsl(${(t * 160) % 360},100%,78%)` : b.color;
      ctx.shadowColor = col;
      ctx.shadowBlur = 24;
      outlinedText(ctx, b.text, cx, cy, { size, color: col, font: FONT, weight: 900, width: Math.max(5, size * 0.14) });
      ctx.shadowBlur = 0;
      outlinedText(ctx, b.sub, cx, cy + size * 0.85, { size: Math.max(15, size * 0.36), color: '#ffffff', font: 'Inter, system-ui, sans-serif', weight: 700, width: 4 });
      ctx.restore();
    }
  }
}
