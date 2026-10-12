import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onScreen, printQueue, yieldToMain, quickThenFull, fittedWidth, PAUSE } from '../src/scripts/print-queue.js';
import { inkCells } from '../src/scripts/mockup/engine.js';

// A hand-driven clock: frames run when the test says so, timers when it moves time on.
function clock() {
  let now = 0, seq = 0;
  const frames = new Map(), timers = new Map();
  return {
    frame: (cb) => { frames.set(++seq, cb); return seq; },
    cancelFrame: (id) => frames.delete(id),
    later: (cb, ms) => { timers.set(++seq, { cb, at: now + ms }); return seq; },
    cancel: (id) => timers.delete(id),
    runFrame() { const due = [...frames.values()]; frames.clear(); due.forEach((cb) => cb()); },
    // fires what is due without waiting for it; the tests let it run with settle()
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.cb(); }
      await settle();
    },
  };
}
const settle = () => new Promise((r) => setImmediate(r));

// A page with a front card, two more on screen and one off it; `log` records paints and yields.
function page({ pass } = {}) {
  const c = clock(), log = [];
  const shown = new Set(['front', 'side', 'below']);
  const painted = new Map();
  let brand = 'A';
  const q = printQueue({
    front: () => 'front',
    all: () => ['front', 'side', 'below', 'far'],
    due: (x) => shown.has(x) && painted.get(x) !== brand,
    paint: (x) => { painted.set(x, brand); log.push(x); },
    frame: c.frame, cancelFrame: c.cancelFrame, later: c.later, cancel: c.cancel,
    pass: pass || (() => { log.push('|'); return Promise.resolve(); }),
  });
  return { c, q, log, type: (b) => { brand = b; q.typed(); } };
}

test('a product beside the screen at the same height is not on screen (the carousel)', () => {
  const W = 390, H = 844;
  const box = (left, top, w = 260, h = 340) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  assert.equal(onScreen(box(65, 300), W, H), true, 'the front card');
  assert.equal(onScreen(box(300, 300), W, H), true, 'a card partly in view at the side');
  assert.equal(onScreen(box(420, 300), W, H), false, 'a card off the right edge, at the same height');
  assert.equal(onScreen(box(-300, 300), W, H), false, 'a card off the left edge');
  assert.equal(onScreen(box(65, 900), W, H), false, 'below the screen');
  assert.equal(onScreen(box(65, 900), W, H, 0, 120), true, 'just below, within the margin');
  assert.equal(onScreen(box(65, 300, 0, 0), W, H), false, 'not laid out (a closed panel)');
});

test('a key paints only the product in front, on the next frame', () => {
  const { c, log, type } = page();
  type('K');
  assert.deepEqual(log, [], 'nothing inside the key itself');
  c.runFrame();
  assert.deepEqual(log, ['front']);
});

test('the rest waits until typing pauses, and each key restarts the wait', async () => {
  const { c, log, type } = page();
  type('K'); c.runFrame();
  await c.advance(PAUSE - 30);
  type('Ka'); c.runFrame();
  await c.advance(PAUSE - 30);
  assert.deepEqual(log, ['front', 'front'], 'still typing: the others are not painted');
  await c.advance(30); await settle();
  assert.deepEqual(log, ['front', 'front', 'side', '|', 'below', '|'], 'after the pause, one at a time with a yield between');
});

test('a product off screen is not painted, and the front is not painted twice', async () => {
  const { c, log, type } = page();
  type('K'); c.runFrame(); await c.advance(PAUSE); await settle();
  assert.equal(log.includes('far'), false);
  assert.equal(log.filter((x) => x === 'front').length, 1);
});

test('typing again stops a round that is under way', async () => {
  let release;
  const { c, log, type } = page({ pass: () => { log.push('|'); return new Promise((r) => { release = r; }); } });
  type('K'); c.runFrame(); await c.advance(PAUSE); await settle();
  assert.deepEqual(log, ['front', 'side', '|']);
  type('Ka');
  release(); await settle();
  assert.deepEqual(log, ['front', 'side', '|'], '"below" is left for the next round');
});

test('scrolling or turning the carousel paints after the frame, but not in the middle of typing', async () => {
  const { c, q, log, type } = page();
  q.shown();
  await c.advance(0);
  assert.deepEqual(log, [], 'not before the frame that shows the change');
  c.runFrame(); await c.advance(0); await settle();
  assert.deepEqual(log, ['front', '|', 'side', '|', 'below', '|']);
  log.length = 0;
  type('K'); q.shown(); c.runFrame(); await c.advance(0); await settle();
  assert.deepEqual(log, ['front'], 'while typing, only the key\'s own front paint');
});

test('yielding uses scheduler.yield where the browser has it, else a timeout', async () => {
  let used = false;
  globalThis.scheduler = { yield: () => { used = true; return Promise.resolve(); } };
  try { await yieldToMain(); } finally { delete globalThis.scheduler; }
  assert.equal(used, true);
  await yieldToMain(); // falls back to setTimeout without throwing
});

test('the warp skips the mesh cells the design does not touch', () => {
  const AW = 1000, AH = 1200, cols = 10, rows = 12; // cells 100 x 100
  assert.equal(inkCells(null, AW, AH, cols, rows).length, 120, 'no box: every cell');
  const band = inkCells({ x0: 80, y0: 520, x1: 920, y1: 690 }, AW, AH, cols, rows);
  assert.deepEqual([...new Set(band.map(([r]) => r))], [5, 6], 'a line of text: only its rows');
  assert.equal(band.length, 20);
  assert.equal(inkCells({ x0: 0, y0: 0, x1: 0, y1: 0 }, AW, AH, cols, rows).length, 0, 'nothing drawn: no cells');
  assert.deepEqual(inkCells({ x0: 450, y0: 299, x1: 460, y1: 301 }, AW, AH, cols, rows), [[2, 4], [3, 4]], 'a box across a cell edge takes both cells');
});

// The studio: a quick picture at the size it is shown for each key, the full 1200 px one on a pause.
function studio(visible = true) {
  const c = clock(), log = [];
  let inView = visible;
  const s = quickThenFull({ quick: () => log.push('quick'), full: () => log.push('full'), inView: () => inView, frame: c.frame, cancelFrame: c.cancelFrame, later: c.later, cancel: c.cancel });
  return { c, s, log, show: (v) => { inView = v; } };
}

test('studio typing: a quick picture on the next frame, the full one only once typing pauses', async () => {
  const { c, s, log } = studio();
  s.changed(); c.runFrame();
  assert.deepEqual(log, ['quick']);
  await c.advance(PAUSE - 20); s.changed(); c.runFrame(); await c.advance(PAUSE - 20);
  assert.deepEqual(log, ['quick', 'quick'], 'no full picture while keys keep coming');
  await c.advance(20);
  assert.deepEqual(log, ['quick', 'quick', 'full']);
});

test('studio out of view (typing the brand at the top): nothing until it scrolls in, then the full picture', async () => {
  const { c, s, log, show } = studio(false);
  s.changed(); c.runFrame(); await c.advance(PAUSE);
  assert.deepEqual(log, []);
  show(true); s.seen();
  assert.deepEqual(log, ['full']);
  s.seen();
  assert.deepEqual(log, ['full'], 'once');
});

test('a drag draws quick steps and the full picture when it ends', async () => {
  const { c, s, log } = studio();
  s.step(); s.step(); c.runFrame();
  assert.deepEqual(log, ['quick'], 'one quick picture a frame');
  s.step(); s.now(); c.runFrame();
  assert.deepEqual(log, ['quick', 'full'], 'the pending quick step is dropped');
});

test('the quick picture is the size it is shown, never more than full size', () => {
  assert.equal(fittedWidth(358, 448, 1200 / 1500, 1200), 358, 'phone: the frame is the picture');
  assert.equal(fittedWidth(600, 600, 0.8, 1200), 480, 'desktop: a tall photo fitted into a wider frame');
  assert.equal(fittedWidth(2400, 3000, 0.8, 1200), 1200);
  assert.equal(fittedWidth(0, 0, 0.8, 1200), 1200, 'not laid out yet: full size');
});
