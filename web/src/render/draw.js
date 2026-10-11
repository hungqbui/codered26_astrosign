// Canvas drawing helpers shared by the game renderer, tutorial and previews.
import { HAND_CONNECTIONS } from '../game/letters.js';

export const FONT = 'Orbitron, system-ui, sans-serif';
export const UI_FONT = 'Inter, system-ui, sans-serif';

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function outlinedText(ctx, str, x, y, { size = 32, color = '#fff', stroke = 'rgba(4,2,18,0.92)', weight = 800, font = FONT, align = 'center', baseline = 'middle', width } = {}) {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  const lw = width ?? Math.max(3, size * 0.16);
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Deterministic lumpy asteroid outline. */
export function asteroidPath(ctx, x, y, r, seed, rot = 0) {
  const n = 11;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const a = (k / n) * Math.PI * 2 + rot;
    const j = 0.78 + 0.22 * (Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5);
    const px = x + Math.cos(a) * r * j;
    const py = y + Math.sin(a) * r * j;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function progressRing(ctx, x, y, r, frac, color, width = 6, track = 'rgba(255,255,255,0.12)') {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = track;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (frac > 0) {
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
    ctx.stroke();
  }
  ctx.restore();
}

/** Effect icons drawn as vector paths, centred at (x,y), roughly `s` px across. */
export function drawIcon(ctx, kind, x, y, s, color, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const h = s / 2;
  switch (kind) {
    case 'attack': { // crosshair with inward arrows
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(0, -h * 0.35);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'slow': { // hourglass
      ctx.beginPath();
      ctx.moveTo(-h * 0.6, -h);
      ctx.lineTo(h * 0.6, -h);
      ctx.lineTo(-h * 0.6, h);
      ctx.lineTo(h * 0.6, h);
      ctx.closePath();
      ctx.stroke();
      const sand = (Math.sin(t * 2) + 1) / 2;
      ctx.beginPath();
      ctx.moveTo(-h * 0.3 * (1 - sand), h * 0.9 - sand * h * 0.5);
      ctx.lineTo(h * 0.3 * (1 - sand), h * 0.9 - sand * h * 0.5);
      ctx.lineTo(h * 0.5, h * 0.9);
      ctx.lineTo(-h * 0.5, h * 0.9);
      ctx.fill();
      break;
    }
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.quadraticCurveTo(h * 0.5, -h * 0.75, h * 0.85, -h * 0.75);
      ctx.quadraticCurveTo(h * 0.85, h * 0.4, 0, h);
      ctx.quadraticCurveTo(-h * 0.85, h * 0.4, -h * 0.85, -h * 0.75);
      ctx.quadraticCurveTo(-h * 0.5, -h * 0.75, 0, -h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.55);
      ctx.lineTo(0, h * 0.55);
      ctx.stroke();
      break;
    }
    case 'heal': {
      const a = h * 0.32;
      ctx.beginPath();
      ctx.moveTo(-a, -h);
      ctx.lineTo(a, -h);
      ctx.lineTo(a, -a);
      ctx.lineTo(h, -a);
      ctx.lineTo(h, a);
      ctx.lineTo(a, a);
      ctx.lineTo(a, h);
      ctx.lineTo(-a, h);
      ctx.lineTo(-a, a);
      ctx.lineTo(-h, a);
      ctx.lineTo(-h, -a);
      ctx.lineTo(-a, -a);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    case 'freeze': { // snowflake
      ctx.rotate(t * 0.3);
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.moveTo(0, -h * 0.55);
        ctx.lineTo(-h * 0.25, -h * 0.8);
        ctx.moveTo(0, -h * 0.55);
        ctx.lineTo(h * 0.25, -h * 0.8);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'nova': { // starburst
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + t * 0.5;
        const rr = i % 2 ? h * 0.45 : h;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'haste': { // lightning bolt
      ctx.beginPath();
      ctx.moveTo(h * 0.2, -h);
      ctx.lineTo(-h * 0.5, h * 0.12);
      ctx.lineTo(-h * 0.02, h * 0.12);
      ctx.lineTo(-h * 0.25, h);
      ctx.lineTo(h * 0.55, -h * 0.2);
      ctx.lineTo(h * 0.05, -h * 0.2);
      ctx.closePath();
      ctx.globalAlpha = 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    case 'reflect': { // mirror bar with a bouncing arrow
      ctx.beginPath();
      ctx.moveTo(h * 0.55, -h);
      ctx.lineTo(h * 0.55, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-h, -h * 0.6);
      ctx.lineTo(h * 0.35, 0);
      ctx.lineTo(-h, h * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-h * 0.95, h * 0.6);
      ctx.lineTo(-h * 0.55, h * 0.75);
      ctx.lineTo(-h * 0.7, h * 0.32);
      ctx.stroke();
      break;
    }
    case 'leech': { // droplet
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.bezierCurveTo(h * 0.25, -h * 0.5, h * 0.75, 0, h * 0.75, h * 0.3);
      ctx.arc(0, h * 0.3, h * 0.75, 0, Math.PI);
      ctx.bezierCurveTo(-h * 0.75, 0, -h * 0.25, -h * 0.5, 0, -h);
      ctx.closePath();
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    default:
  }
  ctx.restore();
}

/** Glowing skeleton for a hand given in canvas pixel coordinates. */
export function drawSkeleton(ctx, pts, color, { width = 3, alpha = 1, joints = true } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = width * 3;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(pts[a][0], pts[a][1]);
    ctx.lineTo(pts[b][0], pts[b][1]);
  }
  ctx.stroke();
  if (joints) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    for (const i of [4, 8, 12, 16, 20]) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], width * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Draws a reference handshape (points from hand_poses.json) fitted inside a box.
 * Templates are right hands in the raw camera frame. Players see a mirrored view, so a
 * right hand is shown flipped and a left hand is shown as-is.
 */
export function drawTemplate(ctx, template, cx, cy, size, color, hand = 'right') {
  if (!template) return;
  const flip = hand === 'right' ? -1 : 1;
  const xs = template.map((p) => p[0] * flip);
  const ys = template.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const s = size / Math.max(maxX - minX, maxY - minY);
  const ox = cx - ((minX + maxX) / 2) * s;
  const oy = cy - ((minY + maxY) / 2) * s;
  const pts = template.map((p) => [ox + p[0] * flip * s, oy + p[1] * s]);
  // Palm fill for a more "hand-like" read.
  ctx.save();
  ctx.fillStyle = hexA(color, 0.18);
  ctx.beginPath();
  [0, 1, 5, 9, 13, 17].forEach((i, k) => (k ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[i])));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawSkeleton(ctx, pts, color, { width: Math.max(2.5, size * 0.045) });
  // Thumb tip highlighted: the most common source of confusion.
  ctx.save();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(pts[4][0], pts[4][1], Math.max(3, size * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
