// Motion that answers the visitor, on the packaging page: a small labelled tab
// travels to the packing list when a product is added, and the counter settles
// when it lands. Built on the browser's own Web Animations, so no animation
// library is loaded anywhere on the site.
//
// Page entrances are CSS (sheet.css, "motion"): they start on load, finish in
// under a second and never wait for a scroll, so a printout, a screenshot or a
// search engine always sees the whole page. With reduced motion nothing moves.
export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// eases: decelerate and settle without overshoot, and an accelerating fall
const SETTLE = 'cubic-bezier(.22,1,.36,1)';
const ACROSS = 'cubic-bezier(.45,0,.55,1)';
const FALL = 'cubic-bezier(.55,0,1,.45)';

/**
 * A small labelled tab travels from `from` to `to` (the packing list counter): it
 * moves across steadily and falls with growing speed, so it arcs into the counter.
 * Two nested boxes carry the two movements, each with its own ease.
 */
export function flyTo(from, to, label, done) {
  if (!motionOK() || !from || !to) { done?.(); return; }
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const across = document.createElement('span');
  across.className = 'pl-fly-x';
  across.setAttribute('aria-hidden', 'true');
  const tab = document.createElement('span');
  tab.className = 'pl-fly';
  tab.textContent = label;
  across.append(tab);
  document.body.append(across);
  const w = tab.offsetWidth;
  // duration grows with distance: about 200 ms per 300 px, within 350-700 ms
  const d = Math.round(Math.min(700, Math.max(350, (Math.hypot(b.left - a.left, b.top - a.top) / 300) * 200)));
  const x0 = a.left + a.width / 2 - w / 2, x1 = b.left + b.width / 2 - w / 2;
  const y0 = a.top + a.height / 2 - 15, y1 = b.top + b.height / 2 - 15;
  const runs = [
    across.animate([{ transform: `translateX(${x0}px)` }, { transform: `translateX(${x1}px)` }], { duration: d, easing: ACROSS, fill: 'forwards' }),
    tab.animate([{ transform: `translateY(${y0}px)` }, { transform: `translateY(${y1}px)` }], { duration: d, easing: FALL, fill: 'forwards' }),
    tab.animate([{ scale: 1, opacity: 1 }, { scale: 0.4, opacity: 0 }], { duration: 180, delay: d - 150, fill: 'forwards' }),
  ];
  Promise.all(runs.map((r) => r.finished)).catch(() => {}).then(() => { across.remove(); done?.(); });
}

/** The counter answers when something is added: a small settle, no bounce. */
export function bump(el) {
  if (!motionOK() || !el) return;
  el.animate([{ scale: 1.25 }, { scale: 1 }], { duration: 400, easing: SETTLE });
}

/**
 * Show or hide an element with a short fade and slide (the ink stations' print
 * layers). `delay` staggers a group; hiding is quicker than showing. The final
 * state is set on the element itself, so it holds when the animation ends.
 */
export function fade(el, on, { delay = 0, dx = -10, dy = 6, instant = false } = {}) {
  el.getAnimations().forEach((x) => x.cancel());
  el.style.opacity = on ? '1' : '0';
  el.style.visibility = on ? 'visible' : 'hidden';
  if (instant || !motionOK()) return;
  if (on) {
    el.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px)` }, { opacity: 1, transform: 'none' }], { duration: 450, delay, easing: SETTLE, fill: 'backwards' });
  } else {
    // keep it visible while it fades
    el.style.visibility = 'visible';
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' }).finished.then(() => { if (el.style.opacity === '0') el.style.visibility = 'hidden'; }).catch(() => {});
  }
}
