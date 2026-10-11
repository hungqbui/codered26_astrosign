// Deep-space backdrop: a pre-rendered nebula and three parallax star layers that drift slowly
// and follow the pointer a little. Everything holds still in reduced-motion mode.
const LAYERS = [
  // share of stars, size (px), alpha, drift (px/s), pointer parallax (px), twinkles
  { share: 0.62, size: 1, alpha: 0.45, drift: 6, parallax: 10, twinkle: false },
  { share: 0.3, size: 1.6, alpha: 0.75, drift: 14, parallax: 24, twinkle: false },
  { share: 0.08, size: 2.4, alpha: 1, drift: 26, parallax: 48, twinkle: true },
];

export class Background {
  constructor() {
    this.layers = [];
    this.nebula = null;
    this.sprite = makeSprite();
    this.w = 0;
    this.h = 0;
    this.pointer = { x: 0, y: 0 }; // target, -0.5..0.5 from the centre
    this.par = { x: 0, y: 0 }; // eased toward the pointer each frame
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX / window.innerWidth - 0.5;
      this.pointer.y = e.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const n = Math.round((w * h) / 5500);
    this.layers = LAYERS.map((L) => ({
      ...L,
      stars: Array.from({ length: Math.max(4, Math.round(n * L.share)) }, () => ({
        x: Math.random() * w, y: Math.random() * h, tw: Math.random() * 6,
      })),
    }));
    this.nebula = this.makeNebula(w, h);
  }

  makeNebula(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w / 3));
    c.height = Math.max(1, Math.round(h / 3));
    const g = c.getContext('2d');
    const R = Math.max(c.width, c.height);
    const blobs = [
      [0.2, 0.25, 0.6, 'rgba(110,40,200,0.35)'],
      [0.85, 0.7, 0.5, 'rgba(20,160,200,0.28)'],
      [0.6, 0.15, 0.4, 'rgba(255,80,190,0.18)'],
    ];
    for (const [x, y, r, col] of blobs) {
      const rg = g.createRadialGradient(x * c.width, y * c.height, 0, x * c.width, y * c.height, r * R);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  // baseY is still accepted for the renderer's call; the old floor grid that used it is gone.
  draw(ctx, t, { speed = 1, reduced = false, tint = null } = {}) {
    const { w, h } = this;
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, w, h);

    const drift = reduced ? 0 : t;
    if (!reduced) {
      this.par.x += (this.pointer.x - this.par.x) * 0.05;
      this.par.y += (this.pointer.y - this.par.y) * 0.05;
    }
    const { x: px, y: py } = this.par;

    // the nebula sits furthest back: it moves least
    ctx.drawImage(this.nebula, -w * 0.02 - px * 6, -h * 0.02 - py * 6, w * 1.04, h * 1.04);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const L of this.layers) {
      const ox = -px * L.parallax;
      const oy = drift * L.drift * speed - py * L.parallax;
      const s = L.size;
      if (L.twinkle) {
        const d = s * 4; // soft sprite: a few bright stars with a halo
        for (const st of L.stars) {
          ctx.globalAlpha = L.alpha * (0.55 + 0.45 * Math.sin(drift * 1.6 + st.tw));
          ctx.drawImage(this.sprite, mod(st.x + ox, w) - d / 2, mod(st.y + oy, h) - d / 2, d, d);
        }
      } else {
        ctx.globalAlpha = L.alpha;
        ctx.fillStyle = '#dfe8ff';
        for (const st of L.stars) ctx.fillRect(mod(st.x + ox, w), mod(st.y + oy, h), s, s);
      }
    }
    ctx.restore();

    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

const mod = (a, n) => ((a % n) + n) % n;

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(235,240,255,0.9)');
  rg.addColorStop(0.45, 'rgba(180,160,255,0.25)');
  rg.addColorStop(1, 'rgba(180,160,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 32, 32);
  return c;
}
