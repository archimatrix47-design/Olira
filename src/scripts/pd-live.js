// A packaging product's own page is built with the catalogue as it was at the
// last deploy. The packaging team changes prices, minimums and lead times
// between deploys, so the page asks the API once and updates those facts in
// place (the catalogue panel does the same through packaging-data.js).
import { specRows } from './catalogue-panel.js';

const box = document.querySelector('[data-live-product]');
if (box) {
  const LABEL = { sizes: 'Sizes', minimum: 'Minimum order', print: 'Print', price: 'Price', ready: 'Ready in' };
  fetch('/api/packaging-products').then((r) => (r.ok ? r.json() : null)).then((list) => {
    const p = Array.isArray(list) && list.find((x) => x.id === box.dataset.liveProduct);
    if (!p) return;
    const rows = Object.fromEntries(specRows(p, Number(box.dataset.flexoMax) || 4));
    for (const dd of document.querySelectorAll('[data-fact]')) {
      const v = rows[LABEL[dd.dataset.fact]];
      if (v && dd.textContent !== v) dd.textContent = v;
    }
  }).catch(() => {});
}
