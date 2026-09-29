// The four print corners on a product photo, shared by the admin's product editor
// and the packaging team's photo tool. The corners are buttons over the photo:
// drag them with a pointer, or focus one and use the arrow keys (Shift for
// larger steps). Positions are fractions of the photo, top left to bottom left.
import { $$ } from './api.js';

export const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
export const DEFAULT_QUAD = [[0.15, 0.3], [0.85, 0.3], [0.85, 0.9], [0.15, 0.9]];
export const defaultQuad = () => DEFAULT_QUAD.map((p) => p.slice());

/** Four corners in order that make a shape which is not twisted. */
export function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (!z || (sign && Math.sign(z) !== sign)) return false;
    sign = Math.sign(z);
  }
  return true;
}

/**
 * stage: the element holding the photo, the outline polygon and four
 * [data-corner] buttons. get() returns { quad, width, height } of the draft;
 * onChange() runs when a corner has moved (at the end of a drag, or per key).
 * Returns place(), which puts the corners where the draft says.
 */
export function cornerEditor(stage, poly, get, onChange) {
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const toFrac = (e) => { const r = stage.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]; };
  let dragging = -1;

  function place() {
    const d = get();
    if (!d?.quad) return;
    stage.style.aspectRatio = `${d.width || 1} / ${d.height || 1}`;
    $$('[data-corner]', stage).forEach((b) => {
      const i = +b.dataset.corner, [x, y] = d.quad[i];
      b.style.left = `${x * 100}%`; b.style.top = `${y * 100}%`;
      b.setAttribute('aria-label', `${CORNERS[i]} print corner, ${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down. Arrow keys move it.`);
    });
    poly.setAttribute('points', d.quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
  }

  $$('[data-corner]', stage).forEach((b) => {
    b.addEventListener('pointerdown', (e) => { dragging = +b.dataset.corner; b.setPointerCapture(e.pointerId); b.classList.add('is-dragging'); e.preventDefault(); });
    b.addEventListener('pointermove', (e) => { if (dragging !== +b.dataset.corner) return; get().quad[dragging] = toFrac(e); place(); });
    const end = () => { if (dragging < 0) return; dragging = -1; b.classList.remove('is-dragging'); onChange(); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.002;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const q = get().quad, i = +b.dataset.corner;
      q[i] = [clamp(q[i][0] + d[0]), clamp(q[i][1] + d[1])];
      place(); onChange();
    });
  });
  return { place };
}
