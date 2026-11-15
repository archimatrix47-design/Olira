// Box home-panels: the two business panels and their trip between the home page
// and each business's page. A trip needs both ends: the panel marked on the home
// page and on its page, its products on both, the trip script on all three pages,
// and a motion rule for every name the script gives. If one side goes missing the
// pages still work, but the trip silently turns into a plain fade, so these
// checks keep both ends together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HOME = read('src/pages/index.astro');
const AGRI = read('src/pages/agriculture.astro');
const PACK = read('src/pages/packaging.astro');
const TRIP = read('src/components/site/PanelTrip.astro');
const TILES = read('src/components/site/ProduceTiles.astro');
const LINEUP = read('src/components/site/PackLineup.astro');
const CSS = read('src/styles/site.css');
const LINES = [...read('src/lib/panels.ts').matchAll(/\bp: '([a-z-]+)'/g)].map((m) => m[1]);

test('home-panels: four product lines are listed', () => {
  assert.deepEqual(LINES, ['sesame', 'pulses', 'spices', 'coffee']);
});

test('home-panels: the home page carries both panels with their products, and each page its own', () => {
  assert.match(HOME, /data-panel="agri"/);
  assert.match(HOME, /data-panel="pack"/);
  assert.match(HOME, /<ProduceTiles \/>/);
  assert.match(HOME, /<PackLineup brand="olira" \/>/, 'the home page prints Olira\'s own logo');
  assert.match(AGRI, /data-panel="agri"/);
  assert.match(AGRI, /<ProduceTiles here \/>/, 'on the agriculture page the tiles point at the range below');
  assert.match(PACK, /data-panel="pack"/);
  assert.match(PACK, /<PackLineup \/>/, 'on the packaging page the products carry the visitor\'s brand');
  assert.match(TILES, /data-p=\{x\.p\}/, 'each tile names its line');
  assert.match(LINEUP, /data-id=\{p\.id\}/, 'each standing product names itself');
});

test('home-panels: the trip script is inline in the head of all three pages', () => {
  for (const [page, src] of [['home', HOME], ['agriculture', AGRI], ['packaging', PACK]]) assert.match(src, /<PanelTrip\b/, `${page}: the trip script`);
  assert.match(TRIP, /<script is:inline>/);
  assert.match(TRIP, /addEventListener\('pageswap'/);
  assert.match(TRIP, /addEventListener\('pagereveal'/);
  assert.match(TRIP, /'\/agriculture\/': 'agri', '\/packaging\/': 'pack'/);
  // only from the top of a page to the top of the other: a #section is a plain page change
  assert.match(TRIP, /!to\.hash/);
  assert.match(TRIP, /location\.hash/);
});

test('home-panels: every name the trip gives has its motion in site.css', () => {
  const names = ['agri-panel', 'pack-panel', '*.pack-item', ...LINES.flatMap((p) => [`agri-tile-${p}`, `agri-label-${p}`])];
  for (const n of names) assert.ok(CSS.includes(`::view-transition-group(${n})`), `site.css has no rule for ${n}`);
  for (const pre of ["'agri-tile-'", "'agri-label-'", "'pack-item-'", "'pack-item'", "'-panel'"]) assert.ok(TRIP.includes(pre), `the script gives ${pre}`);
  // each growing panel keeps its colour, keyed on <html data-trip>
  assert.match(CSS, /:root\[data-trip="agri"\]::view-transition-group\(agri-panel\) \{ background:/);
  assert.match(CSS, /:root\[data-trip="pack"\]::view-transition-group\(pack-panel\) \{ background:/);
  // the other panel is pushed off its own side and comes back from there
  assert.match(CSS, /::view-transition-old\(pack-panel\):only-child \{ animation: vt-out-right/);
  assert.match(CSS, /::view-transition-new\(pack-panel\):only-child \{ animation: vt-in-right/);
  assert.match(CSS, /::view-transition-old\(agri-panel\):only-child \{ animation: vt-out-left/);
  assert.match(CSS, /::view-transition-new\(agri-panel\):only-child \{ animation: vt-in-left/);
});

test('home-panels: no page change dips through a blank screen (the old page holds while the new fades in)', () => {
  assert.match(CSS, /::view-transition-old\(root\) \{ animation: none; \}/);
});
