// A logo row that moves slowly from right to left, in an endless loop.
//
// The track holds the real list once, then copies of it (hidden from assistive
// technology and the keyboard) until two identical halves each cover the row;
// moving the track by exactly one half loops without a seam. The speed is fixed
// in pixels per second, so a short list and a long one move alike.
// It stops while pointed at or focused (CSS), and with the pause button; with
// reduced motion there are no copies and the logos simply sit in a row.
const SPEED = 36; // px per second

export function marquee(root) {
  const track = root.querySelector('.marquee-track');
  // the pause button sits just after the row: focusing it must not snap the row back
  const toggle = root.nextElementSibling?.matches('.marquee-toggle') ? root.nextElementSibling : null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const original = () => track.querySelector('.marquee-set:not([aria-hidden])');

  function layout() {
    track.querySelectorAll('.marquee-set[aria-hidden]').forEach((n) => n.remove());
    const set = original();
    if (!set || !set.children.length || reduce.matches) { root.classList.add('is-still'); return; }
    root.classList.remove('is-still');
    const setW = set.getBoundingClientRect().width;
    const rowW = root.getBoundingClientRect().width;
    if (!setW || !rowW) return;
    const perHalf = Math.max(1, Math.ceil(rowW / setW)); // copies of the set in each half
    for (let i = 1; i < perHalf * 2; i++) {
      const copy = set.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.removeAttribute('aria-label');
      copy.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
      copy.querySelectorAll('img').forEach((img) => img.setAttribute('alt', ''));
      track.append(copy);
    }
    const shift = setW * perHalf;
    track.style.setProperty('--shift', `${-shift}px`);
    track.style.setProperty('--dur', `${(shift / SPEED).toFixed(1)}s`);
  }

  let frame = 0;
  const relayout = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(root);
  addEventListener('resize', relayout);
  reduce.addEventListener?.('change', relayout);
  // logos arriving late change the set's width
  root.addEventListener('load', relayout, true);

  toggle?.addEventListener('click', () => {
    const paused = root.classList.toggle('is-paused');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Play the moving logos' : 'Pause the moving logos');
  });

  layout();
  return { relayout };
}
