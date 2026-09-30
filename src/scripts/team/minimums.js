// Packaging workspace: minimum orders. Every product in one list, grouped by
// family, with its minimum and, where it differs, a minimum per size. Change as
// many as needed and save once: only the products that changed are sent, each to
// POST /api/team/packaging-products/:id/minimums, which changes nothing else.
import { $, $$, h, api, toast, busy } from '../admin/api.js';
import { clean } from '../admin/tools.js';

const FAMILY = { bags: 'Paper bags', food: 'Bakery and food boxes', medical: 'Medical packets', foil: 'Aluminium foil bags' };
const num = (n) => Number(n).toLocaleString('en-US');
const unitsOf = (v) => { const t = String(v ?? '').replace(/[\s,]/g, ''); if (!t) return null; const n = Number(t); return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : NaN; };
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

function field(id, product, label, value, hint) {
  const input = h('input', { class: 'input', id, inputmode: 'numeric', maxlength: '12', autocomplete: 'off', value: value ? num(value) : '', placeholder: hint });
  const err = h('p', { class: 'err', id: `${id}-err`, hidden: true });
  input.setAttribute('aria-describedby', err.id);
  // the product's name is part of every field's name, for screen readers
  return { wrap: h('div', { class: 'a-field' }, h('label', { for: id }, h('span', { class: 'sr-only' }, `${product}, `), label), input, err), input, err };
}

function rowFor(p) {
  const main = field(`min-${p.id}`, p.name, 'Product minimum', p.minOrder, 'Agreed per quote');
  const sizes = (p.sizes || []).map((s) => ({ s, f: field(`min-${p.id}-${s.id}`, p.name, `${s.label}${s.w && s.h ? ` (${[s.w, s.d, s.h].filter(Boolean).join(' x ')} cm)` : ''}`, s.minOrder, 'As product') }));
  const el = h('div', { class: 't-min-row', 'data-id': p.id },
    h('div', { class: 't-min-name' }, h('strong', {}, p.name), h('span', {}, sizes.length ? `${sizes.length} size${sizes.length === 1 ? '' : 's'}` : 'One size')),
    main.wrap,
    sizes.length ? h('div', { class: 't-min-sizes' }, ...sizes.map((x) => x.f.wrap)) : h('span'));
  const r = { p, main, sizes, el, fields: [main, ...sizes.map((x) => x.f)] };
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
    const bad = Number.isNaN(unitsOf(f.input.value));
    f.err.hidden = !bad; f.err.textContent = bad ? 'A whole number of units, for example 5,000, or blank.' : '';
    if (bad) { f.input.setAttribute('aria-invalid', 'true'); first ||= f.input; } else f.input.removeAttribute('aria-invalid');
  }
  if (first) return first.focus();
  const done = busy($('#tMinSave'));
  const saved = [], failed = [];
  for (const r of changed) {
    try {
      const body = { minOrder: unitsOf(r.main.input.value) ?? '', sizes: Object.fromEntries(r.sizes.map(({ s, f }) => [s.id, unitsOf(f.input.value) ?? ''])) };
      const res = await api(`/api/team/packaging-products/${encodeURIComponent(r.p.id)}/minimums`, { method: 'POST', body });
      Object.assign(r.p, res.product);
      r.main.input.value = res.product.minOrder ? num(res.product.minOrder) : '';
      for (const { s, f } of r.sizes) { const now = (res.product.sizes || []).find((x) => x.id === s.id); f.input.value = now?.minOrder ? num(now.minOrder) : ''; }
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
    const msg = saved.length === 1 ? `${saved[0]}: minimums saved. The packaging page uses them now.` : `Minimums saved for ${saved.length} products. The packaging page uses them now.`;
    toast(msg); say(msg);
  }
  if (failed.length) toast(`Not saved: ${failed.join('. ')}`, 'error');
  $$('.t-min-row.is-changed .input', form())[0]?.focus();
}
