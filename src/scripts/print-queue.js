// Keeping the page quick while the live print repaints. One key in "Type your
// brand" changes every printed product on the page, and painting them all at once
// held a phone up for a second a key. So the product the visitor is looking at is
// painted on the next frame, and the others only once typing pauses, only those
// actually on screen, one at a time with the main thread handed back in between.
// No DOM here: live-print.js supplies the canvases, and the tests the clock.

/** How long typing must stop before the rest of the page is repainted, in ms. */
export const PAUSE = 150;

/**
 * Is a box (a getBoundingClientRect) on a w x h screen? Across as well as down:
 * the carousel stands its cards side by side at one height. `mx`, `my`: how far
 * beyond the left and right, and the top and bottom, still counts.
 */
export function onScreen(r, w, h, mx = 0, my = 0) {
  return !!r && r.width > 0 && r.height > 0 && r.right > -mx && r.left < w + mx && r.bottom > -my && r.top < h + my;
}

/** Hand the main thread back to the browser, so a key or a tap is answered between two paints. */
export function yieldToMain() {
  const s = globalThis.scheduler;
  return typeof s?.yield === 'function' ? s.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The painter. opts:
 *   front()   the canvas the visitor is looking at, or null
 *   all()     every canvas, in the order to paint them
 *   due(c)    whether c is on screen and shows something out of date
 *   paint(c)  paints c (may return a promise)
 *   pause, frame, cancelFrame, later, cancel, pass: the clock, replaceable in tests
 * Returns { typed(), shown(wait) }.
 */
export function printQueue({
  front, all, due, paint, pause = PAUSE,
  frame = (cb) => requestAnimationFrame(cb), cancelFrame = (id) => cancelAnimationFrame(id),
  later = (cb, ms) => setTimeout(cb, ms), cancel = (id) => clearTimeout(id), pass = yieldToMain,
}) {
  let f = 0, t = 0, run = 0, typing = false;
  async function rest(id) {
    typing = false;
    for (const c of all()) {
      if (id !== run) return; // typed again: this round is stale, the next pause starts over
      if (!due(c)) continue;
      await paint(c);
      await pass();
    }
  }
  return {
    /** The brand changed: the front product on the next frame, the rest once typing pauses. */
    typed() {
      typing = true;
      const id = ++run;
      cancelFrame(f); cancel(t);
      f = frame(() => { const c = front(); if (c && due(c)) paint(c); });
      t = later(() => rest(id), pause);
    },
    /**
     * Something came into view (a scroll, a filter, the carousel turned): paint it
     * once the frame that shows the change is on screen, so the tap that caused it
     * is answered first; not while typing, whose own pause paints it.
     */
    shown(wait = 0) {
      if (typing) return;
      const id = ++run;
      cancelFrame(f); cancel(t);
      f = frame(() => { t = later(() => rest(id), wait); });
    },
  };
}

/**
 * The studio's preview while the visitor types or drags: a quick picture on the
 * next frame, only when the preview is in view, and the full one once they pause.
 * Out of view, the full picture waits until seen() says the preview scrolled in.
 * opts: quick(), full(), inView(), and the same clock as printQueue.
 * Returns { changed(), step(), now(), seen() }.
 */
export function quickThenFull({
  quick, full, inView, pause = PAUSE,
  frame = (cb) => requestAnimationFrame(cb), cancelFrame = (id) => cancelAnimationFrame(id),
  later = (cb, ms) => setTimeout(cb, ms), cancel = (id) => clearTimeout(id),
}) {
  let f = 0, t = 0, behind = false;
  const finish = () => { behind = false; full(); };
  return {
    /** A key or a slider step: quick now, full after the pause. */
    changed() {
      cancelFrame(f); cancel(t);
      if (inView()) f = frame(quick);
      t = later(() => { if (inView()) finish(); else behind = true; }, pause);
    },
    /** One step of a drag: quick only; now() follows when it ends. */
    step() { cancelFrame(f); f = frame(quick); },
    /** The drag ended: the full picture at once. */
    now() { cancelFrame(f); cancel(t); finish(); },
    /** The preview came into view. */
    seen() { if (behind) finish(); },
  };
}

/** How wide a picture of shape `ratio` (width / height) is shown when fitted inside a box, at most `max`. */
export function fittedWidth(boxW, boxH, ratio, max) {
  const w = Math.round(Math.min(boxW, boxH * ratio));
  return w > 0 ? Math.min(max, w) : max;
}
