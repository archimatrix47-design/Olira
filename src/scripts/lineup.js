// The packaging line-up (PackLineup.astro) shows still renders at once; this
// brings in the live 3D (package-3d/lineup3d.js), where a box opens under the
// pointer and the packaging page prints the brand as it is typed. The 3D library
// is only fetched when it can be used: soon after the page has loaded on a screen
// with a mouse, at the first touch of the line-up, or when a brand is typed.
// Without WebGL the stills stay. Used on the home page and the packaging page.
import { $$ } from './common.js';

const lineups = $$('[data-lineup]').filter((el) => el.querySelector('.item[data-style]'));
let started = null;
const start = () => (started ||= import('./package-3d/lineup3d.js').then((m) => m.mount(lineups)).catch(() => null));

if (lineups.length) {
  for (const el of lineups) {
    el.addEventListener('pointerenter', start, { once: true });
    el.addEventListener('touchstart', start, { once: true, passive: true });
  }
  for (const input of $$('input[data-brand-input]')) input.addEventListener('input', start, { once: true });
  let stored = '';
  try { stored = localStorage.getItem('olira-brand') || ''; } catch (e) { stored = ''; }
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500));
  // a brand typed on an earlier visit is printed without waiting; a mouse can hover any moment
  if ((stored.trim() && lineups.some((el) => el.dataset.brand !== 'olira')) || matchMedia('(hover: hover) and (pointer: fine)').matches) {
    if (document.readyState === 'complete') later(start); else addEventListener('load', () => later(start), { once: true });
  }
}
