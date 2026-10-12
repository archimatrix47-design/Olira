import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pendingFacts, pendingLine, pendingList, knownRows, specRows, photoFirst, flowItem } from '../src/scripts/catalogue-facts.js';
import { cardHTML, itemKey } from '../src/scripts/product-grid.js';

// The product grid and the quote facts (fresh-eyes review FR-R9, FR-R11): every
// product in view, photos first, and price, minimum and lead time shown only once
// the packaging team has set them, named in one line until then.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const bare = { id: 'pk_flat', name: 'Flat handle bags', family: 'bags', sizes: [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }] };
const set = { ...bare, minOrder: 5000, leadTimeDays: 10, pricePer1000: 1250 };

test('the facts the team has not set are the ones still to come', () => {
  assert.deepEqual(pendingFacts(bare), ['price', 'minimum', 'ready']);
  assert.deepEqual(pendingFacts(set), []);
  assert.deepEqual(pendingFacts({ ...bare, leadTimeDays: 7 }), ['price', 'minimum']);
  assert.deepEqual(pendingFacts({ ...bare, sizes: [{ id: 'small', label: 'Small', minOrder: 2000, pricePer1000: 900 }] }), ['ready'], 'a size of its own counts');
  assert.deepEqual(pendingFacts({ ...bare, minOrder: 0, leadTimeDays: -1 }), ['price', 'minimum', 'ready'], 'zero and negative are not set');
});

test('one line names what is still to come', () => {
  assert.equal(pendingLine(['price', 'minimum', 'ready']), 'Price, minimum order and lead time are confirmed in your quote.');
  assert.equal(pendingLine(['price', 'ready']), 'Price and lead time are confirmed in your quote.');
  assert.equal(pendingLine(['ready']), 'Lead time is confirmed in your quote.');
  assert.equal(pendingLine([]), '');
  assert.equal(pendingList(['minimum']), 'Minimum order');
});

test('the details show set facts only, never a placeholder row', () => {
  const placeholder = /Confirmed with your quote|Price in your quote/;
  assert.ok(specRows(bare).some(([, v]) => placeholder.test(v)), 'specRows itself still fills the gaps (llms and live pages read it)');
  const { rows, line } = knownRows(bare);
  assert.equal(rows.some(([, v]) => placeholder.test(v)), false);
  assert.deepEqual(rows.map(([k]) => k), ['Sizes', 'Print']);
  assert.equal(line, 'Price, minimum order and lead time are confirmed in your quote.');
  const full = knownRows(set);
  assert.deepEqual(full.rows.map(([k]) => k), ['Sizes', 'Minimum order', 'Print', 'Price', 'Ready in']);
  assert.equal(full.line, '');
});

test('the product page hides unset rows and shows the single line, and its live update keeps them in step', () => {
  const page = read('src/components/site/ProductPage.astro');
  assert.match(page, /<dt data-row=\{f\.key \|\| null\} hidden=\{f\.hidden\}>/);
  assert.match(page, /<div class="spec-row" data-row=\{f\.key \|\| null\} hidden=\{f\.hidden\}>/);
  assert.match(page, /data-pending-line hidden=\{!pendingText\}/);
  assert.match(page, /data-pending-row hidden=\{!p\.pending\}/);
  const slug = read('src/pages/packaging/[slug].astro');
  for (const k of ['price', 'minimum', 'ready']) assert.match(slug, new RegExp(`hidden: pending\\.includes\\('${k}'\\)`), k);
  assert.match(slug, /pending\.includes\('minimum'\) \? \[\] :/, 'structured data leaves out a minimum that is not set');
  const live = read('src/scripts/pd-live.js');
  assert.match(live, /showPending\(pendingFacts\(p\)\)/);
  const css = read('src/styles/site.css');
  assert.match(css, /\.spec-row\[hidden\], \.pd-pending\[hidden\], \.det-pending\[hidden\] \{ display: none; \}/, 'a styled row must still hide');
  assert.match(read('src/scripts/catalogue.js'), /knownRows\(p, FLEXO_MAX\)/, 'the details window uses the set facts only');
  assert.match(read('src/lib/llms.ts'), /knownRows\(p, FLEXO_MAX_COLOURS\)/, 'llms.txt too');
});

test('products with a photo come first, in the team\'s order', () => {
  const list = [{ id: 'a' }, { id: 'b', image: '/b.webp' }, { id: 'c' }, { id: 'd', image: '/d.webp' }];
  assert.deepEqual(photoFirst(list).map((p) => p.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(list.map((p) => p.id), ['a', 'b', 'c', 'd'], 'the original list is left alone');
});

test('a card without a photo shows its name and sizes, not an empty tile', () => {
  const item = flowItem(bare, { bags: 'Paper bags' });
  assert.equal(item.note, 'Small, Medium');
  assert.equal(flowItem({ ...bare, sizes: [] }).note, 'Made to your size');
  assert.equal(flowItem({ ...bare, image: '/x.webp' }).note, '');
  const html = cardHTML(item);
  assert.match(html, /class="pg-card no-photo"/);
  assert.match(html, /<span class="pg-ph" aria-hidden="true"><b>Flat handle bags<\/b><small>Small, Medium<\/small><\/span>/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /<span class="pg-name">Flat handle bags<\/span><span class="pg-sub">Paper bags<\/span>/);
});

test('a card with a photo loads it lazily unless it is in the first row, and carries its live print', () => {
  const item = flowItem({ ...bare, image: '/uploads/packaging/flat-cutout-1.webp', quad: [[0, 0], [1, 0], [1, 1], [0, 1]] }, {});
  assert.match(cardHTML(item), /loading="lazy"/);
  assert.match(cardHTML(item, { eager: true }), /loading="eager"/);
  assert.match(cardHTML(item, { eager: true, lazy: true }), /loading="lazy"/, 'a range below its hero always waits');
  assert.match(cardHTML(item), /<canvas class="flow-print" data-print data-cutout=/);
  assert.match(cardHTML({ id: 'x', name: '<b>' }), /&lt;b&gt;/, 'names are escaped');
});

test('a card is kept across a filter unless what it shows changed', () => {
  const a = flowItem({ ...bare, image: '/a.webp' });
  assert.equal(itemKey(a), itemKey({ ...a }));
  assert.notEqual(itemKey(a), itemKey({ ...a, image: '/b.webp' }), 'a new photo rebuilds the card');
  assert.notEqual(itemKey(a), itemKey({ ...a, name: 'Other' }));
  assert.match(cardHTML(a), /^<li data-id="pk_flat" data-key="\[&quot;pk_flat&quot;,/, 'the key travels on the card, escaped');
});

test('a product photo carries over to its own page, from one named source at a time', () => {
  const sheet = read('src/styles/sheet.css');
  assert.match(sheet, /\.pd-media \{ view-transition-name: product-photo; \}/, 'the product page names its photo');
  const common = read('src/scripts/common.js');
  assert.match(common, /for \(const m of document\.querySelectorAll\('\.pd-media'\)\) m\.style\.viewTransitionName = 'none';\n {2}src\.style\.viewTransitionName = VT_PHOTO;/, 'the page being left clears its own name first, then names the source');
  assert.match(common, /addEventListener\('pageshow'/, 'and puts the names back when it is returned to');
  assert.match(read('src/pages/packaging.astro'), /id="pkPage" data-vt-photo="detail"/);
  assert.match(read('src/pages/agriculture.astro'), /id="detPage" href="#range" data-vt-photo="detail"/);
  assert.match(read('src/components/site/ProductPage.astro'), /<a class="pd-card" href=\{r\.href\} data-vt-photo="card">/);
});
