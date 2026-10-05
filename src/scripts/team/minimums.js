// Packaging workspace: prices and minimums. Every product in one list, grouped by
// family, with its minimum order, its price per 1,000 units, its lead time and,
// where they differ, a minimum and a price per size. Change as many as needed and
// save once: only the products that changed are sent, each to
// POST /api/team/packaging-products/:id/minimums, which changes nothing else.
import { $, $$, h, api, toast, busy } from '../admin/api.js';
import { clean } from '../admin/tools.js';

const FAMILY = { bags: 'Paper bags', food: 'Bakery and food boxes', medical: 'Medical packets', foil: 'Aluminium foil bags' };
const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
// what each kind of field accepts: null when blank, NaN when not acceptable
const READ = {
  units: (v) => { const t = String(v ?? '').replace(/[\s,]/g, ''); if (!t) return null; const n = Number(t); return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : NaN; },
  price: (v) => { const t = String(v ?? '').replace(/[\s,]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : NaN; },
  days: (v) => { const t = String(v ?? '').trim(); if (!t) return null; const n = Number(t); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : NaN; },
};
const PROBLEM = {
  units: 'A whole number of units, for example 5,000, or blank.',
  price: 'An amount in birr for 1,000 units, for example 1,250, or blank.',
  days: 'A whole number of working days, 1 to 365, or blank.',
};
const say = (msg) => { const s = $('#tMinLive'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
const form = () => $('#tMinForm');

let rows = [];
let bound = false;

export async function show() {
  const box = $('#tMinList');
  if (!bound) {
    bound = true;
    form().addEventListener('submit', submit);
    form().addEventListener('input', mark);
  }
  if (form().hasAttribute('data-dirty')) return; // keep unsaved changes when coming back
  try {
    const list = await api('/api/packaging-products?scope=team');
    rows = (Array.isArray(list) ? list : []).map(rowFor);
    form().querySelector('.a-savebar').hidden = !rows.length;
    if (!rows.length) { box.replaceChildren(h('p', { class: 'note' }, 'No packaging products yet. Add them under Packaging products.')); return; }
    const families = [...new Set(rows.map((r) => r.p.family || 'bags'))];
    box.replaceChildren(...families.map((f) => h('section', { class: 'a-card t-min-group', 'aria-labelledby': `minfam-${f}` },
      h('h2', { id: `minfam-${f}` }, FAMILY[f] || f),
      ...rows.filter((r) => (r.p.family || 'bags') === f).map((r) => r.el))));
    mark();
    clean(form());
  } catch (e) {
    if (e.status !== 401) box.replaceChildren(h('p', { class: 'note' }, e.message));
  }
}

function field(id, product, label, value, hint, kind, unit) {
  const input = h('input', { class: 'input', id, inputmode: kind === 'price' ? 'decimal' : 'numeric', maxlength: '14', autocomplete: 'off', value: value ? num(value) : '', placeholder: hint });
  const err = h('p', { class: 'err', id: `${id}-err`, hidden: true });
  input.setAttribute('aria-describedby', err.id);
  const control = unit ? h('div', { class: 't-unit', style: `--unit:${unit.length}` }, input, h('span', { 'aria-hidden': 'true' }, unit)) : input;
  // the product's name is part of every field's name, for screen readers
  return { wrap: h('div', { class: 'a-field' }, h('label', { for: id }, h('span', { class: 'sr-only' }, `${product}, `), label), control, err), input, err, kind };
}

function rowFor(p) {
  const sized = (p.sizes || []).length > 0;
  const main = field(`min-${p.id}`, p.name, 'Minimum order', p.minOrder, 'Agreed per quote', 'units');
  const price = field(`price-${p.id}`, p.name, sized ? 'Price per 1,000, any size' : 'Price per 1,000', p.pricePer1000, 'In the quote', 'price', 'ETB');
  const lead = field(`lead-${p.id}`, p.name, 'Ready in', p.leadTimeDays, 'Per quote', 'days', 'working days');
  const sizes = (p.sizes || []).map((s) => {
    const name = `${s.label}${s.w && s.h ? ` (${[s.w, s.d, s.h].filter(Boolean).join(' x ')} cm)` : ''}`;
    return {
      s,
      min: field(`min-${p.id}-${s.id}`, `${p.name}, ${s.label}`, 'Minimum', s.minOrder, 'As product', 'units'),
      price: field(`price-${p.id}-${s.id}`, `${p.name}, ${s.label}`, 'Per 1,000', s.pricePer1000, 'As product', 'price', 'ETB'),
      name,
    };
  });
  const el = h('div', { class: 't-min-row', 'data-id': p.id },
    h('div', { class: 't-min-name' }, h('strong', {}, p.name), h('span', {}, sized ? `${sizes.length} size${sizes.length === 1 ? '' : 's'}` : 'One size')),
    h('div', { class: 't-min-product' }, main.wrap, price.wrap, lead.wrap),
    sized
      ? h('div', { class: 't-min-sizes' }, ...sizes.map((x) => h('fieldset', { class: 't-min-size' }, h('legend', {}, x.name), x.min.wrap, x.price.wrap)))
      : h('span'));
  const r = { p, main, price, lead, sizes, el, fields: [main, price, lead, ...sizes.flatMap((x) => [x.min, x.price])] };
  r.values = () => r.fields.map((f) => f.input.value.replace(/[\s,]/g, ''));
  r.initial = JSON.stringify(r.values());
  r.changed = () => JSON.stringify(r.values()) !== r.initial;
  return r;
}

/** Mark the rows that changed, and say how many. */
function mark() {
  let n = 0;
  for (const r of rows) { const c = r.changed(); r.el.classList.toggle('is-changed', c); if (c) n++; }
  $('#tMinDirty').textContent = n ? `${n} product${n === 1 ? '' : 's'} changed` : 'Unsaved changes';
}

async function submit(e) {
  e.preventDefault();
  const changed = rows.filter((r) => r.changed());
  if (!changed.length) { toast('Nothing has changed yet.'); return; }
  let first = null;
  for (const r of changed) for (const f of r.fields) {
    const bad = Number.isNaN(READ[f.kind](f.input.value));
    f.err.hidden = !bad; f.err.textContent = bad ? PROBLEM[f.kind] : '';
    if (bad) { f.input.setAttribute('aria-invalid', 'true'); first ||= f.input; } else f.input.removeAttribute('aria-invalid');
  }
  if (first) return first.focus();
  const done = busy($('#tMinSave'));
  const saved = [], failed = [];
  const val = (f) => READ[f.kind](f.input.value) ?? '';
  for (const r of changed) {
    try {
      const body = {
        minOrder: val(r.main), pricePer1000: val(r.price), leadTimeDays: val(r.lead),
        sizes: Object.fromEntries(r.sizes.map(({ s, min }) => [s.id, val(min)])),
        prices: Object.fromEntries(r.sizes.map(({ s, price }) => [s.id, val(price)])),
      };
      const res = await api(`/api/team/packaging-products/${encodeURIComponent(r.p.id)}/minimums`, { method: 'POST', body });
      Object.assign(r.p, res.product);
      const show = (f, v) => { f.input.value = v ? num(v) : ''; };
      show(r.main, res.product.minOrder); show(r.price, res.product.pricePer1000); show(r.lead, res.product.leadTimeDays);
      for (const x of r.sizes) { const now = (res.product.sizes || []).find((z) => z.id === x.s.id); show(x.min, now?.minOrder); show(x.price, now?.pricePer1000); }
      r.initial = JSON.stringify(r.values());
      saved.push(r.p.name);
    } catch (x) {
      if (x.status === 401) break;
      failed.push(`${r.p.name}: ${x.message}`);
    }
  }
  done();
  mark();
  if (!failed.length) clean(form());
  if (saved.length) {
    const msg = saved.length === 1 ? `${saved[0]}: prices and minimums saved. The packaging page uses them now.` : `Prices and minimums saved for ${saved.length} products. The packaging page uses them now.`;
    toast(msg); say(msg);
  }
  if (failed.length) toast(`Not saved: ${failed.join('. ')}`, 'error');
  $$('.t-min-row.is-changed .input', form())[0]?.focus();
}
