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

// The enquiry form's product field: a product added since the build is added to
// it, so the buyer can still pick it.
function chooseProduct(name) {
  const form = $('#inquiry');
  if (!form) return;
  form.dataset.product = name;
  const sel = form.querySelector('[data-product-select]');
  if (!sel) { prefill(`Interested in ${name}. Volume and shipment window: `); return; }
  if (![...sel.options].some((o) => o.value === name)) sel.insertBefore(h('option', { value: name }, name), sel.querySelector('option[value="Several products"]'));
  sel.value = name;
  sel.dispatchEvent(new Event('change'));
}

// a product page's "Request a quote" lands here with ?ask=<product id>
{
  const ask = new URLSearchParams(location.search).get('ask');
  const p = ask && RAW.find((x) => x.id === ask);
  if (p) chooseProduct(p.name);
}

$('#detAsk').addEventListener('click', () => {
  const p = flow.current();
  flow.close();
  chooseProduct(p.name);
});

