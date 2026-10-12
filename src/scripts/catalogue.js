// The packaging catalogue, in the same grid as the agriculture range
// (product-grid.js). The group buttons choose which products are shown, links from
// other pages can pick a group (?family=food), the details window shows sizes,
// minimum order and print with "Add to packing list" and "Design it in the
// studio", and the grid is updated when the admin or the packaging team has
// changed a product since the page was built. Products with a photo come first.
import { $, $$, h, track } from './common.js';
import { onProducts } from './packaging-data.js';
import { flowItem, knownRows, inStudio, photoFirst } from './catalogue-panel.js';
import { mountGrid } from './product-grid.js';

const root = $('#catalogue');
const tabs = $$('.fam');
let FAMILIES = {};
try { FAMILIES = JSON.parse(root?.dataset.families || '{}'); } catch (e) { FAMILIES = {}; }
const FLEXO_MAX = Number(root?.dataset.flexoMax) || 4;
let ALL = JSON.parse($('#packagingData')?.textContent || '[]');
const PAGES = JSON.parse($('#productPages')?.textContent || '{}'); // products added after the build have no page yet
let current = 'all';
const byId = (id) => ALL.find((p) => p.id === id);

const grid = mountGrid($('.pgrid-wrap[data-grid="pack"]', root), {
  products: photoFirst(ALL).map((p) => flowItem(p, FAMILIES)),
  onDetail: (item, panel) => {
    const p = byId(item.id) || {};
    // the facts the team has set; the ones still to come in one line, not three placeholders
    const { rows, line } = knownRows(p, FLEXO_MAX);
    const dl = $('.spec-list', panel);
    dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    dl.hidden = false;
    let note = $('.det-pending', panel);
    if (!note) { note = h('p', { class: 'note det-pending' }); dl.after(note); }
    note.textContent = line;
    note.hidden = !line;
    $('.detail-specs', panel).replaceChildren(...(p.specs || []).map((s) => h('li', {}, s)));
    $('.pp-add', panel).dataset.id = p.id;
    const studio = $('#pkStudio'); studio.hidden = !inStudio(p); studio.dataset.id = p.id;
    const page = $('#pkPage'); if (page) { page.hidden = !PAGES[p.id]; if (PAGES[p.id]) page.href = PAGES[p.id]; }
    $('.detail-media', panel).classList.toggle('is-cutout', !!item.cutout);
    // a fresh canvas each time, so the live print paints this product, not the last one
    const old = $('.detail-media .flow-print', panel);
    const c = old.cloneNode(false);
    if (item.print) Object.assign(c.dataset, { print: '', cutout: item.print.cutout, quad: JSON.stringify(item.print.quad), safeTop: String(item.print.safeTop ?? 0.04), ink: 'teal' });
    else delete c.dataset.print;
    // the card's print, already painted, shows at once; the live print then redraws it here
    const painted = item.print && $(`#pkGrid .pg-card[data-id="${CSS.escape(item.id)}"] canvas.is-printed`);
    if (painted?.width) { c.width = painted.width; c.height = painted.height; c.getContext('2d').drawImage(painted, 0, 0); }
    old.replaceWith(c);
    document.dispatchEvent(new CustomEvent('catalogue:rendered')); // marks the Add button, paints the print
  },
  onOpen: (item) => track({ event: 'product', product: item.name }),
});

function apply(fam) {
  current = FAMILIES[fam] ? fam : 'all';
  const list = photoFirst(ALL.filter((p) => current === 'all' || p.family === current));
  grid.set(list.map((p) => flowItem(p, FAMILIES)));
  tabs.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.family === current)));
  $('#catalogueStatus').textContent = current === 'all' ? `Showing all ${list.length} products.` : `Showing ${list.length} ${FAMILIES[current].toLowerCase()}.`;
  document.dispatchEvent(new CustomEvent('catalogue:rendered'));
}

tabs.forEach((t) => t.addEventListener('click', () => {
  if (t.dataset.family === current) return;
  apply(t.dataset.family);
  track({ event: 'catalogue_filter' });
  const u = new URL(location.href);
  if (current === 'all') u.searchParams.delete('family'); else u.searchParams.set('family', current);
  history.replaceState(history.state, '', u);
}));

// "Design it in the studio" stays on the page: pick that product in the studio
$('#pkStudio')?.addEventListener('click', (e) => {
  const id = e.currentTarget.dataset.id;
  if (!id) return;
  e.preventDefault();
  grid.close();
  document.dispatchEvent(new CustomEvent('studio:pick', { detail: { id } }));
  $('#studio')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

function counts(products) {
  for (const t of tabs) {
    const n = t.dataset.family === 'all' ? products.length : products.filter((p) => p.family === t.dataset.family).length;
    const el = $('.n', t); if (el) el.textContent = String(n);
    t.hidden = n === 0 && t.dataset.family !== 'all';
  }
}

onProducts((products) => {
  ALL = products;
  counts(products);
  apply(current);
});

// a link to one product (a product the studio cannot preview yet) shows it here
document.addEventListener('catalogue:show', (e) => {
  const id = e.detail?.id;
  if (!grid.show(id)) { apply('all'); grid.show(id); }
});

const start = new URLSearchParams(location.search).get('family');
if (start && FAMILIES[start]) apply(start);
