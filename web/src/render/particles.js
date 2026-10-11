// Lightweight particle / shockwave / floating-text system drawn with additive blending.
export class Particles {
  constructor() {
    this.items = [];
    this.reduced = false;
  }

  clear() { this.items = []; }

  count(n) { return this.reduced ? Math.ceil(n * 0.3) : n; }

  burst(x, y, { color = '#fff', n = 30, speed = 380, life = 0.8, size = 3, gravity = 0, kind = 'spark', spread = Math.PI * 2, angle = 0 } = {}) {
    for (let i = 0; i < this.count(n); i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.25 + Math.random() * 0.75);
      this.items.push({
        kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5),
        age: 0, color, size: size * (0.5 + Math.random()), gravity, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  debris(x, y, color, n = 10, r = 30) {
    for (let i = 0; i < this.count(n); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 260;
      this.items.push({
        kind: 'debris', x: x + Math.cos(a) * r * 0.4, y: y + Math.sin(a) * r * 0.4, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.9 + Math.random() * 0.5, age: 0, color, size: r * (0.18 + Math.random() * 0.22), gravity: 300,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
      });
    }
  }

  /** Curved glass shards for a breaking bubble. */
  shards(x, y, r, color, n = 18) {
    for (let i = 0; i < this.count(n); i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const s = 260 + Math.random() * 420;
      this.items.push({
        kind: 'shard', x: x + Math.cos(a) * r * 0.8, y: y + Math.sin(a) * r * 0.8, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
        life: 0.9 + Math.random() * 0.6, age: 0, color, size: r * (0.25 + Math.random() * 0.3), gravity: 700,
        rot: a, vr: (Math.random() - 0.5) * 16, arc: 0.3 + Math.random() * 0.5,
      });
    }
  }

  ring(x, y, { color = '#fff', radius = 120, life = 0.5, width = 6 } = {}) {
    this.items.push({ kind: 'ring', x, y, color, radius, life, age: 0, width });
  }

  text(x, y, str, { color = '#fff', size = 28, life = 1.0, vy = -60 } = {}) {
    this.items.push({ kind: 'text', x, y, str, color, size, life, age: 0, vx: 0, vy });
  }

  beam(x0, y0, x1, y1, color, life = 0.22) {
    this.items.push({ kind: 'beam', x: x0, y: y0, x1, y1, color, life, age: 0 });
  }

  update(dt) {
    for (const p of this.items) {
      p.age += dt;
      if (p.vx !== undefined) {
        p.vy += (p.gravity || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind !== 'text') { p.vx *= 0.985; p.vy *= 0.985; }
      }
      if (p.vr) p.rot += p.vr * dt;
    }
    this.items = this.items.filter((p) => p.age < p.life);
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.items) {
      const k = 1 - p.age / p.life;
      if (p.kind === 'text') continue;
      ctx.globalCompositeOperation = p.kind === 'debris' ? 'source-over' : 'lighter';
      ctx.globalAlpha = Math.max(0, k);
      switch (p.kind) {
        case 'spark': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          ctx.stroke();
          break;
        }
        case 'dot':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'debris': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = '#1a1030';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-p.size, -p.size * 0.4);
          ctx.lineTo(p.size * 0.8, -p.size * 0.7);
          ctx.lineTo(p.size * 0.5, p.size * 0.8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'shard': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.arc(-p.size, 0, p.size, -p.arc, p.arc);
          ctx.arc(-p.size * 1.25, 0, p.size * 1.25, p.arc * 0.8, -p.arc * 0.8, true);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, k) * 0.45;
          ctx.fill();
          ctx.globalAlpha = Math.max(0, k);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'ring': {
          const e = 1 - (1 - p.age / p.life) ** 3;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * k + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * e, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'beam': {
          ctx.lineCap = 'round';
          for (const [w, a] of [[18, 0.25], [8, 0.6], [3, 1]]) {
            ctx.globalAlpha = k * a;
            ctx.strokeStyle = w === 3 ? '#ffffff' : p.color;
            ctx.lineWidth = w * (0.4 + k * 0.6);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x1, p.y1);
            ctx.stroke();
          }
          break;
        }
        default:
      }
    }
    ctx.restore();
  }

  /** Floating text drawn after everything else so it stays readable. */
  drawText(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.items) {
      if (p.kind !== 'text') continue;
      const k = 1 - p.age / p.life;
      const pop = Math.min(1, p.age / 0.12);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.font = `800 ${Math.round(p.size * (0.7 + 0.3 * pop))}px Orbitron, system-ui, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(5,2,20,0.9)';
      ctx.strokeText(p.str, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.str, p.x, p.y);
    }
    ctx.restore();
  }
}
