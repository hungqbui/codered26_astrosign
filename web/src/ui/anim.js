// GSAP-driven UI motion (the logo's entrance and shimmer are CSS): screen entrances, magnetic buttons, card tilt, countdown,
// results count-up. Everything collapses to instant state changes in reduced-motion mode.
import { gsap } from 'gsap';

let reduced = false;
export function setReducedMotion(r) {
  reduced = r;
  document.body.classList.toggle('reduced-motion', r); // gates the CSS animations (logo shimmer, orbs)
  gsap.globalTimeline.getChildren(true, true, false).forEach((t) => { if (t.vars?.repeat === -1) t.paused(r); });
}

const STAGGER_SEL = '.tagline, .mode-pick, .row > .btn, .row > button, .pu, h2, .status, .pcard, .tips, .setup-view, .stat-col, .winner, .hint, details';

/** Animate a screen's panel and its contents in. */
export function screenIn(screen) {
  const panel = screen.querySelector('.panel');
  if (!panel) return;
  const parts = [...panel.querySelectorAll(STAGGER_SEL)].filter((el) => !el.closest('.hidden'));
  gsap.killTweensOf([panel, ...parts]);
  if (reduced) { gsap.set([panel, ...parts], { clearProps: 'all' }); return; }
  const tl = gsap.timeline();
  tl.fromTo(panel, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity' });
  tl.fromTo(parts, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.38, stagger: 0.03, ease: 'power2.out', clearProps: 'transform,opacity' }, '-=0.25');
}

/**
 * Button hover: a slight lift, a glow (CSS) and the gradient border sweeping round while the
 * pointer is over it; a springy bounce on press.
 */
export function magnetic(root = document) {
  root.querySelectorAll('.btn, .icon-btn').forEach((b) => {
    if (b.dataset.hoverfx) return;
    b.dataset.hoverfx = '1';
    let sweep = null;
    b.addEventListener('pointerenter', () => {
      if (reduced || b.disabled) return;
      gsap.to(b, { y: -3, duration: 0.25, ease: 'power2.out' });
      sweep?.kill();
      sweep = gsap.fromTo(b, { '--btn-angle': '90deg' }, { '--btn-angle': '450deg', duration: 1.6, ease: 'none', repeat: -1 });
    });
    b.addEventListener('pointerleave', () => {
      sweep?.kill();
      gsap.to(b, { y: 0, '--btn-angle': '90deg', duration: 0.4, ease: 'power2.out' });
    });
    b.addEventListener('pointerdown', () => { if (!reduced) gsap.fromTo(b, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }); });
  });
}

/**
 * Versus <-> Co-op: the highlight pill slides to the chosen button and the details below
 * cross-fade inside a fixed-height stage (the panel never changes size).
 */
export function switchMode(mode, instant = false) {
  const ind = document.querySelector('.mode-ind');
  const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
  const panes = [...document.querySelectorAll('.mode-pane')];
  const show = panes.find((p) => p.dataset.pane === mode);
  const hide = panes.filter((p) => p !== show);
  if (!ind || !btn || !show) return;
  ind.classList.toggle('boss', mode === 'boss');
  const x = btn.offsetLeft - 4;
  if (instant || reduced) {
    gsap.set(ind, { x, width: btn.offsetWidth });
    gsap.set(hide, { autoAlpha: 0, y: 0 });
    gsap.set(show, { autoAlpha: 1, y: 0 });
    return;
  }
  gsap.to(ind, { x, width: btn.offsetWidth, duration: 0.5, ease: 'power3.inOut' });
  gsap.fromTo(ind, { '--btn-angle': '90deg' }, { '--btn-angle': '450deg', duration: 0.6, ease: 'power2.out' });
  gsap.to(hide, { autoAlpha: 0, y: -10, duration: 0.22, ease: 'power2.in', overwrite: true });
  gsap.fromTo(show, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, delay: 0.15, ease: 'power3.out', overwrite: true });
  gsap.fromTo(show.children, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, delay: 0.18, stagger: 0.06, ease: 'power2.out', clearProps: 'transform,opacity' });
}

/** Power-up cards tilt in 3-D under the pointer. */
export function tiltCards(root) {
  root.querySelectorAll('.pu').forEach((c) => {
    c.addEventListener('pointermove', (e) => {
      if (reduced) return;
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(c, { rotateY: px * 16, rotateX: -py * 16, scale: 1.04, duration: 0.3, transformPerspective: 500 });
    });
    c.addEventListener('pointerleave', () => gsap.to(c, { rotateY: 0, rotateX: 0, scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' }));
  });
}

export function countdownPop(el) {
  if (reduced) return;
  gsap.killTweensOf(el);
  gsap.timeline()
    .fromTo(el, { scale: 2.4, opacity: 0, rotate: -12, filter: 'blur(8px)' }, { scale: 1, opacity: 1, rotate: 0, filter: 'blur(0px)', duration: 0.32, ease: 'back.out(3)' })
    .to(el, { scale: 0.82, opacity: 0.25, duration: 0.45, ease: 'power1.in' }, '+=0.05');
}

/** Results: elastic title, staggered rows, numbers counting up. */
export function resultsIn(screen) {
  screenIn(screen);
  if (reduced) return;
  const win = screen.querySelector('.winner');
  gsap.fromTo(win, { scale: 0.2, opacity: 0, rotate: -6 }, { scale: 1, opacity: 1, rotate: 0, duration: 1.0, ease: 'elastic.out(1, 0.45)', delay: 0.15 });
  screen.querySelectorAll('dd').forEach((dd, i) => {
    const m = dd.textContent.match(/^([\d,]+)(.*)$/);
    if (!m) return;
    const target = Number(m[1].replace(/,/g, ''));
    const rest = m[2];
    const o = { v: 0 };
    gsap.to(o, {
      v: target, duration: 1.1, delay: 0.3 + i * 0.03, ease: 'power2.out',
      onUpdate: () => { dd.textContent = `${Math.round(o.v).toLocaleString()}${rest}`; },
    });
  });
  gsap.fromTo(screen.querySelectorAll('dt, dd'), { opacity: 0, x: -8 }, { opacity: 1, x: 0, stagger: 0.015, duration: 0.3, delay: 0.25, clearProps: 'transform,opacity' });
}

export function toastIn(el) {
  if (reduced) return;
  gsap.fromTo(el, { y: 24, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)', clearProps: 'transform' });
}

/** Slowly rotating gradient border on panels (CSS custom property animated by GSAP). */
export function ambient() {
  if (reduced) return;
  gsap.to(document.documentElement, { '--ring-angle': '360deg', duration: 9, ease: 'none', repeat: -1 });
}
