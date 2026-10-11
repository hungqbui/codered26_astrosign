// Hands-free menu navigation: every actionable control gets a handshape badge (the ASL letter's
// pose drawn from the reference poses), holding that pose presses it, and a legend bar shows the
// current screen's mapping with live feedback.
import { gsap } from 'gsap';
import { PLAYER_COLORS } from '../game/letters.js';
import { drawTemplate } from '../render/draw.js';

const RING_C = 2 * Math.PI * 16; // circumference of the badge ring (r = 16 in a 36x36 viewBox)

export class GestureNav {
  /**
   * @param {{templates:object, legend:HTMLElement}} opts
   */
  constructor({ templates, legend }) {
    this.templates = templates;
    this.legend = legend;
    this.items = [];
    this.byLetter = new Map();
    this.ready = [false, false];
    this.enabled = false;
    this.screen = null;
  }

  /** Pose icon for a letter on a small canvas. */
  poseCanvas(letter, size, color) {
    const c = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = Math.round(size * dpr);
    c.style.width = c.style.height = `${size}px`;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    drawTemplate(g, this.templates[letter], size / 2, size / 2, size * 0.78, color, 'right');
    return c;
  }

  badge(item) {
    const el = document.createElement('span');
    el.className = 'gbadge';
    el.setAttribute('aria-hidden', 'true');
    el.append(this.poseCanvas(item.letter, 26, '#ffffff'));
    el.insertAdjacentHTML('beforeend', `<b>${item.letter}</b>${item.both ? '<em>×2</em>' : ''}
      <svg class="gring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" /></svg>`);
    return el;
  }

  /**
   * @param {string} screen
   * @param {{letter:string, target:HTMLElement, label:string, action:Function, both?:boolean, visible?:()=>boolean}[]} items
   */
  setScreen(screen, items) {
    this.screen = screen;
    this.ready = [false, false];
    this.items = items;
    this.byLetter = new Map(items.map((it) => [it.letter, it]));
    for (const it of items) {
      if (!it.target.querySelector(':scope > .gbadge')) it.target.append(this.badge(it));
      it.badgeEl = it.target.querySelector(':scope > .gbadge');
      it.ring = it.badgeEl.querySelector('circle');
      it.ring.style.strokeDasharray = `${RING_C}`;
      it.ring.style.strokeDashoffset = `${RING_C}`;
    }
    this.renderLegend();
  }

  clear() {
    this.screen = null;
    this.items = [];
    this.byLetter = new Map();
    this.legend.classList.add('hidden');
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.legend.classList.toggle('off', !on);
    this.renderHead();
  }

  /** Status line shown while hand tracking is starting / unavailable. */
  setStatus(msg) {
    this.status = msg;
    this.renderHead();
  }

  renderHead() {
    if (!this.head) return;
    const sub = this.enabled ? 'hold a pose until its ring fills' : (this.status ?? 'starting hand tracking…');
    this.head.innerHTML = `<b>Hand navigation</b><span>${sub}</span>`;
    this.head.classList.toggle('loading', !this.enabled);
  }

  /** Letters the confirmers should accept on this screen. */
  get letters() {
    return this.items.filter((it) => this.isLive(it)).map((it) => it.letter);
  }

  isLive(it) {
    return (!it.visible || it.visible()) && !it.target.disabled && it.target.offsetParent !== null;
  }

  renderLegend() {
    const L = this.legend;
    if (!this.items.length) { L.classList.add('hidden'); return; }
    L.classList.remove('hidden');
    L.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'nl-head';
    this.head = head;
    this.renderHead();
    L.append(head);
    for (const it of this.items) {
      it.legendEl = null;
      if (it.visible && !it.visible()) continue; // e.g. co-op toggles while Versus is selected
      const cell = document.createElement('div');
      cell.className = 'nl-item';
      cell.dataset.letter = it.letter;
      cell.append(this.poseCanvas(it.letter, 34, '#e9e6ff'));
      cell.insertAdjacentHTML('beforeend', `<b>${it.letter}</b><span>${it.label}${it.both ? ' <em>both players</em>' : ''}</span>`);
      L.append(cell);
      it.legendEl = cell;
    }
    L.classList.toggle('off', !this.enabled);
    gsap.fromTo(L.children, { y: 12, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.04, duration: 0.35, ease: 'power2.out', clearProps: 'transform' });
  }

  /**
   * Called every frame with the players' confirmer states. Shows hold progress on badges and
   * highlights the pose each player is currently showing.
   */
  update(states) {
    if (!this.items.length) return;
    for (const it of this.items) {
      let p = 0;
      let who = -1;
      states.forEach((s, side) => {
        if (s?.candidate === it.letter && !s.needsRelease && s.progress > p) { p = s.progress; who = side; }
      });
      it.ring.style.strokeDashoffset = `${RING_C * (1 - p)}`;
      it.ring.style.stroke = who >= 0 ? PLAYER_COLORS[who] : '';
      it.badgeEl.classList.toggle('active', p > 0);
      const seen = states.some((s) => s?.display?.letter === it.letter && s.display.confidence > 0.5);
      it.legendEl?.classList.toggle('seen', seen);
      it.legendEl?.classList.toggle('holding', p > 0);
      if (it.both) {
        it.badgeEl.classList.toggle('ready1', this.ready[0]);
        it.badgeEl.classList.toggle('ready2', this.ready[1]);
      }
    }
  }

  /** A player confirmed a letter. Returns true if it was a navigation action here. */
  confirm(side, letter) {
    const it = this.byLetter.get(letter);
    if (!it || !this.isLive(it)) return false;
    if (it.both) {
      this.ready[side] = true;
      if (!(this.ready[0] && this.ready[1])) {
        this.pulse(it, PLAYER_COLORS[side]);
        return true;
      }
      this.ready = [false, false];
    }
    this.pulse(it, '#ffffff');
    it.action();
    return true;
  }

  pulse(it, color) {
    const r = document.createElement('span');
    r.className = 'gripple';
    r.style.borderColor = color;
    it.target.append(r);
    gsap.fromTo(r, { scale: 0.2, opacity: 0.9 }, { scale: 2.6, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => r.remove() });
    gsap.fromTo(it.target, { scale: 0.92 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', clearProps: 'transform' });
  }
}
