// The packaging catalogue, in the same carousel as the agriculture range
// (flow.js). The group buttons choose which products are in the ring, links from
// other pages can pick a group (?family=food), the detail panel shows sizes,
// minimum order and print with "Add to packing list" and "Design it in the
// studio", and the ring is re-rendered when the admin or the packaging team has
// changed a product since the page was built.
import { $, $$, h, track } from './common.js';
import { onProducts } from './packaging-data.js';
import { flowItem, specRows, inStudio } from './catalogue-panel.js';
import { mountFlow } from './flow.js';

const root = $('#catalogue');
const tabs = $$('.fam');
let FAMILIES = {};
try { FAMILIES = JSON.parse(root?.dataset.families || '{}'); } catch (e) { FAMILIES = {}; }
const FLEXO_MAX = Number(root?.dataset.flexoMax) || 4;
let ALL = JSON.parse($('#packagingData')?.textContent || '[]');
let current = 'all';
const byId = (id) => ALL.find((p) => p.id === id);

const flow = mountFlow($('.flow-wrap[data-flow="pack"]', root), {
  products: ALL.map((p) => flowItem(p, FAMILIES)),
  onDetail: (item, panel) => {
    const p = byId(item.id) || {};
    const dl = $('.spec-list', panel);
    dl.replaceChildren(...specRows(p, FLEXO_MAX).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    dl.hidden = false;
    $('.detail-specs', panel).replaceChildren(...(p.specs || []).map((s) => h('li', {}, s)));
    $('.pp-add', panel).dataset.id = p.id;
    const studio = $('#pkStudio'); studio.hidden = !inStudio(p); studio.dataset.id = p.id;
    $('.detail-media', panel).classList.toggle('is-cutout', !!item.cutout);
    // a fresh canvas each time, so the live print paints this product, not the last one
    const old = $('.detail-media .flow-print', panel);
    const c = old.cloneNode(false);
    if (item.print) Object.assign(c.dataset, { print: '', cutout: item.print.cutout, quad: JSON.stringify(item.print.quad), safeTop: String(item.print.safeTop ?? 0.04), ink: 'teal' });
    else delete c.dataset.print;
    old.replaceWith(c);
    document.dispatchEvent(new CustomEvent('catalogue:rendered')); // marks the Add button, paints the print
  },
  onOpen: (item) => track({ event: 'product', product: item.name }),
});

function apply(fam, keepId) {
  current = FAMILIES[fam] ? fam : 'all';
  const list = ALL.filter((p) => current === 'all' || p.family === current);
  flow.set(list.map((p) => flowItem(p, FAMILIES)), keepId);
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
  flow.close();
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
  apply(current, flow.current()?.id);
});

// a link to one product (a product the studio cannot preview yet) shows it here
document.addEventListener('catalogue:show', (e) => {
  const id = e.detail?.id;
  if (!flow.show(id)) { apply('all', id); flow.show(id); }
  requestAnimationFrame(() => root.scrollIntoView({ block: 'center' }));
});

const start = new URLSearchParams(location.search).get('family');
if (start && FAMILIES[start]) apply(start);
