// Box agri-panel: the green agriculture panel and its trip between the home page
// and the agriculture page. The trip needs both ends: the same tiles and the
// trip script on both pages, and a motion rule for every name the script gives.
// If one side goes missing the pages still work, but the trip silently turns
// into a plain fade, so these checks keep both ends together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HOME = read('src/pages/index.astro');
const AGRI = read('src/pages/agriculture.astro');
const TRIP = read('src/components/site/AgriPanelTrip.astro');
const TILES = read('src/components/site/ProduceTiles.astro');
const CSS = read('src/styles/site.css');
const LINES = [...read('src/lib/produce.ts').matchAll(/\bp: '([a-z-]+)'/g)].map((m) => m[1]);

test('agri-panel: four product lines are listed', () => {
  assert.deepEqual(LINES, ['sesame', 'pulses', 'spices', 'coffee']);
});

test('agri-panel: both pages carry the panel, the same tiles and the trip script', () => {
  for (const [page, src] of [['home', HOME], ['agriculture', AGRI]]) {
    assert.match(src, /data-agri-panel/, `${page}: the panel is marked`);
    assert.match(src, /<ProduceTiles\b/, `${page}: the shared tiles`);
    assert.match(src, /<AgriPanelTrip\b/, `${page}: the trip script`);
  }
  assert.match(AGRI, /<ProduceTiles here\b/, 'on the agriculture page the tiles point at the range below');
  assert.match(TILES, /data-p=\{x\.p\}/, 'each tile names its line');
});

test('agri-panel: the trip script is inline, so it listens before the first frame', () => {
  assert.match(TRIP, /<script is:inline>/);
  assert.match(TRIP, /addEventListener\('pageswap'/);
  assert.match(TRIP, /addEventListener\('pagereveal'/);
  // only from the top of a page to the top of the other: a #section is a plain page change
  assert.match(TRIP, /!to\.hash/);
  assert.match(TRIP, /location\.hash/);
});

test('agri-panel: every name the trip gives has its motion in site.css', () => {
  const names = ['agri-panel', 'pack-panel', ...LINES.flatMap((p) => [`agri-tile-${p}`, `agri-label-${p}`])];
  for (const n of names) assert.ok(CSS.includes(`::view-transition-group(${n})`), `site.css has no rule for ${n}`);
  for (const pre of ["'agri-panel'", "'pack-panel'", "'agri-tile-'", "'agri-label-'"]) assert.ok(TRIP.includes(pre), `the script gives ${pre}`);
  // the packaging panel is pushed off to the right and comes back from there
  assert.match(CSS, /::view-transition-old\(pack-panel\):only-child \{ animation: vt-out-right/);
  assert.match(CSS, /::view-transition-new\(pack-panel\):only-child \{ animation: vt-in-right/);
});

test('agri-panel: no page change dips through a blank screen (the old page holds while the new fades in)', () => {
  assert.match(CSS, /::view-transition-old\(root\) \{ animation: none; \}/);
});
