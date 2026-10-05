// Agriculture page: the range in the shared product carousel (flow.js), the
// detail panel's purity and minimum order, the "Ask about this product" link,
// and a fresh render if the admin has changed the products since the build.
import { $, h, prefill, getJSON, track } from './common.js';
import { mountFlow } from './flow.js';

const toItem = (p) => ({ ...p, sub: p.category, cat: p.category });
let RAW = JSON.parse($('#productsData').textContent || '[]');
const PAGES = JSON.parse($('#productPages')?.textContent || '{}'); // products added after the build have no page yet

const flow = mountFlow($('.flow-wrap[data-flow="agri"]'), {
  products: RAW.map(toItem),
  onDetail: (p) => {
    const dl = $('#detSpec'); dl.replaceChildren();
    for (const [k, v] of [['Purity', p.purity], ['Min. order', p.moq]]) if (v) dl.append(h('dt', {}, k), h('dd', {}, v));
    dl.hidden = !dl.children.length;
    $('#detSpecs').replaceChildren(...(p.specs || []).map((s) => h('li', {}, s)));
    const page = $('#detPage');
    if (page) { page.hidden = !PAGES[p.id]; if (PAGES[p.id]) page.href = PAGES[p.id]; }
  },
  onOpen: (p) => track({ event: 'product', product: p.name }),
});

getJSON('/api/products').then((live) => {
  if (!Array.isArray(live) || !live.length) return;
  if (JSON.stringify(live) === JSON.stringify(RAW)) return; // unchanged since the build
  RAW = live;
  flow.set(live.map(toItem));
});

// a product page's "Request a quote" lands here with ?ask=<product id>
{
  const ask = new URLSearchParams(location.search).get('ask');
  const p = ask && RAW.find((x) => x.id === ask);
  if (p) {
    const form = $('#inquiry'); if (form) form.dataset.product = p.name;
    prefill(`Interested in ${p.name}. Volume and shipment window: `);
  }
}

$('#detAsk').addEventListener('click', () => {
  const p = flow.current();
  flow.close();
  const form = $('#inquiry'); if (form) form.dataset.product = p.name;
  prefill(`Interested in ${p.name}. Volume and shipment window: `);
});

