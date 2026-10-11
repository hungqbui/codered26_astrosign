// Animated neon-space backdrop: parallax stars, drifting nebulae, synthwave floor grid.
export class Background {
  constructor() {
    this.stars = [];
    this.nebula = null;
    this.w = 0;
    this.h = 0;
    this.scroll = 0;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const n = Math.round((w * h) / 5500);
    this.stars = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, z: Math.random() ** 2, tw: Math.random() * 6,
    }));
    this.nebula = this.makeNebula(w, h);
  }

  makeNebula(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w / 3));
    c.height = Math.max(1, Math.round(h / 3));
    const g = c.getContext('2d');
    const blobs = [
      [0.18, 0.3, 0.5, 'rgba(56,225,255,0.20)'],
      [0.82, 0.3, 0.5, 'rgba(255,79,216,0.20)'],
      [0.5, 0.75, 0.6, 'rgba(120,60,255,0.22)'],
      [0.5, 0.1, 0.35, 'rgba(255,120,80,0.10)'],
    ];
    for (const [x, y, r, col] of blobs) {
      const rg = g.createRadialGradient(x * c.width, y * c.height, 0, x * c.width, y * c.height, r * c.width);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  draw(ctx, t, { speed = 1, reduced = false, baseY, tint = null } = {}) {
    const { w, h } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#05021a');
    bg.addColorStop(0.6, '#0b0530');
    bg.addColorStop(1, '#16063d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const drift = reduced ? 0 : t;
    ctx.save();
    ctx.globalAlpha = 0.9 + Math.sin(drift * 0.3) * 0.1;
    const ox = Math.sin(drift * 0.05) * w * 0.02;
    ctx.drawImage(this.nebula, ox - w * 0.02, 0, w * 1.04, h);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const y = (s.y + drift * (12 + s.z * 70) * speed) % h;
      const a = 0.35 + s.z * 0.65 * (0.7 + 0.3 * Math.sin(drift * 2 + s.tw));
      ctx.fillStyle = `rgba(200,220,255,${a})`;
      const r = 0.6 + s.z * 1.6;
      ctx.fillRect(s.x, y, r, r);
    }
    ctx.restore();

    // Perspective floor grid under the bases.
    if (baseY) {
      const top = baseY - 4;
      const hz = h - top;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, w, hz);
      ctx.clip();
      const fg = ctx.createLinearGradient(0, top, 0, h);
      fg.addColorStop(0, 'rgba(255,79,216,0.18)');
      fg.addColorStop(1, 'rgba(56,225,255,0.05)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, top, w, hz);
      ctx.strokeStyle = 'rgba(170,110,255,0.35)';
      ctx.lineWidth = 1;
      this.scroll = reduced ? 0 : (t * 0.6 * speed) % 1;
      for (let i = 0; i < 9; i++) {
        const k = ((i + this.scroll) / 9) ** 2;
        const y = top + k * hz;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * w * 0.04, top);
        ctx.lineTo(w / 2 + i * w * 0.2, h);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
