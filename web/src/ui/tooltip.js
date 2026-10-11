// One shared tooltip for every element with a data-tip attribute (hover or keyboard focus).
// Keeps the screens light on text: details live here instead of on the page.
import { gsap } from 'gsap';

export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let current = null;

  const show = (el) => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    const [title, ...rest] = text.split('\n');
    tip.innerHTML = rest.length ? `<b>${title}</b><span>${rest.join('<br>')}</span>` : `<span>${title}</span>`;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const above = r.top - t.height - 12 > 8;
    const x = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const y = above ? r.top - t.height - 12 : r.bottom + 12;
    tip.classList.toggle('below', !above);
    tip.style.setProperty('--arrow-x', `${r.left + r.width / 2 - x}px`);
    gsap.killTweensOf(tip);
    gsap.fromTo(tip, { x, y: y + (above ? 8 : -8), opacity: 0, scale: 0.96 }, { x, y, opacity: 1, scale: 1, duration: 0.18, ease: 'power2.out' });
    el.setAttribute('aria-describedby', 'tip');
  };
  const hide = (el) => {
    if (el !== current) return;
    current = null;
    gsap.to(tip, { opacity: 0, duration: 0.12, onComplete: () => { if (!current) tip.style.display = 'none'; } });
  };

  tip.id = 'tip';
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && el !== current) show(el); });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide(el);
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) hide(el); });
}
