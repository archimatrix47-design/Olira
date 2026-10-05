// A product's own page is built with the catalogue as it was at the last deploy.
// The teams change it between deploys, so the page asks the API once and updates
// those facts in place: for packaging the price, minimum and lead time (the
// catalogue panel does the same through packaging-data.js); for agriculture the
// purity, minimum and specification sheet. Values are only ever set as text.
import { specRows } from './catalogue-panel.js';
import { SPEC_FIELDS } from '../../lib/agri-spec.js';

const box = document.querySelector('[data-live-product]');
const set = (key, value) => { for (const dd of document.querySelectorAll(`[data-fact="${key}"]`)) if (dd.textContent !== value) dd.textContent = value; };

if (box && box.dataset.line === 'pack') {
  const LABEL = { sizes: 'Sizes', minimum: 'Minimum order', print: 'Print', price: 'Price', ready: 'Ready in' };
  fetch('/api/packaging-products').then((r) => (r.ok ? r.json() : null)).then((list) => {
    const p = Array.isArray(list) && list.find((x) => x.id === box.dataset.liveProduct);
    if (!p) return;
    const rows = Object.fromEntries(specRows(p, Number(box.dataset.flexoMax) || 4));
    for (const [key, label] of Object.entries(LABEL)) if (rows[label]) set(key, rows[label]);
  }).catch(() => {});
} else if (box) {
  fetch('/api/products').then((r) => (r.ok ? r.json() : null)).then((list) => {
    const p = Array.isArray(list) && list.find((x) => x.id === box.dataset.liveProduct);
    if (!p) return;
    if (p.purity) set('purity', p.purity);
    if (p.moq) set('moq', p.moq);
    const sheet = document.querySelector('.specsheet-rows');
    if (!sheet) return;
    // new rows go before "Origin", where the built ones are
    const anchor = [...sheet.children].find((row) => row.querySelector('dt')?.textContent === 'Origin') || null;
    for (const f of SPEC_FIELDS) {
      const key = `spec-${f.key}`, value = p.spec?.[f.key] || '';
      const dd = sheet.querySelector(`[data-fact="${key}"]`);
      if (value && dd) set(key, value);
      else if (value) {
        const row = document.createElement('div'); row.className = 'spec-row';
        const dt = document.createElement('dt'); dt.textContent = f.label;
        const v = document.createElement('dd'); v.className = 'v'; v.dataset.fact = key; v.textContent = value;
        const d = document.createElement('dd'); d.className = 'd';
        row.append(dt, v, d);
        sheet.insertBefore(row, anchor);
      } else if (dd) dd.closest('.spec-row')?.remove();
    }
  }).catch(() => {});
}
