// The packing list: several packaging products, each with a size, a quantity and
// how many print colours, sent together as one quote request.
//
// Kept in this browser only (localStorage), so it survives a reload or a visit
// to the studio. The minimum order for each line comes from the packaging team
// (packaging-data.js keeps it current); a line under its minimum is marked here,
// and the server refuses it too, so the check cannot be skipped.
import { $, $$, h, track, formHooks } from './common.js';
import { byId, onProducts, minimumFor, units, fmt } from './packaging-data.js';
import { flyTo, bump } from './motion.js';

const KEY = 'olira-packing-list';
const dialog = $('#packingList');
const openBtn = $('#plOpen');
const FLEXO_MAX = Number(dialog?.dataset.flexoMax) || 4;

let lines = [];
try { const raw = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(raw)) lines = raw; } catch (e) { lines = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* private window: the list lasts for this page */ } };

// drop lines whose product is gone; fix sizes that no longer exist
function reconcile() {
  lines = lines.filter((l) => l && byId(l.productId)).map((l) => {
    const p = byId(l.productId);
    const sizes = p.sizes || [];
    const sizeId = sizes.some((s) => s.id === l.sizeId) ? l.sizeId : sizes[0]?.id || '';
    return { productId: p.id, sizeId, qty: l.qty ?? '', colours: l.colours ?? '' };
  });
}

/** Problems with a line, in words, or ''. */
function problem(l) {
  const p = byId(l.productId);
  if (!p) return 'This product is no longer offered.';
  if (p.sizes?.length && !l.sizeId) return 'Choose a size.';
  const q = units(l.qty);
  if (!q) return 'Enter a quantity.';
  const min = minimumFor(p, l.sizeId);
  if (min && q < min) return `Minimum order ${fmt(min)}. Raise the quantity to at least ${fmt(min)}.`;
  return '';
}
const maxColours = (p) => (Number.isInteger(p?.printColours) ? p.printColours : FLEXO_MAX);
const colourLabel = (c) => (c === '' || c == null ? 'Print to discuss' : Number(c) === 0 ? 'Plain, no print' : `${c} colour${Number(c) === 1 ? '' : 's'}`);

/* ---------- the drawer ---------- */
function field(label, control) { const f = h('label', { class: 'pl-field' }, label); f.append(control); return f; }
function renderDialog() {
  const list = $('#plLines'), empty = $('#plEmpty');
  empty.hidden = lines.length > 0;
  $('#plFoot').hidden = lines.length === 0;
  list.replaceChildren(...lines.map((l, i) => {
    const p = byId(l.productId);
    const li = h('li', { class: 'pl-line' });
    li.dataset.index = String(i);
    const name = h('div', { class: 'pl-line-name' }, p.name);
    name.append(h('small', {}, familyName(p.family)));
    const rm = h('button', { class: 'pl-remove', type: 'button', 'aria-label': `Remove ${p.name}` });
    rm.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    rm.addEventListener('click', () => remove(i));

    const fields = h('div', { class: 'pl-fields' });
    const sizes = p.sizes || [];
    if (sizes.length) {
      const sel = h('select', { name: `size-${i}` });
      for (const s of sizes) {
        const dims = s.w && s.h ? ` (${[s.w, s.d, s.h].filter(Boolean).join(' x ')} cm)` : '';
        const o = h('option', { value: s.id }, `${s.label}${dims}`); o.selected = s.id === l.sizeId; sel.append(o);
      }
      sel.addEventListener('change', () => { l.sizeId = sel.value; save(); refreshLine(li, l); renderSummary(); });
      fields.append(field('Size', sel));
    }
    const min = minimumFor(p, l.sizeId);
    const qty = h('input', { name: `qty-${i}`, inputmode: 'numeric', autocomplete: 'off', value: l.qty === '' ? '' : String(l.qty), placeholder: min ? fmt(min) : 'For example 5,000', 'aria-describedby': `plMin-${i}` });
    qty.addEventListener('input', () => { l.qty = qty.value.trim(); save(); refreshLine(li, l, false); renderSummary(); });
    qty.addEventListener('blur', () => { const n = units(qty.value); if (n) { qty.value = fmt(n); l.qty = n; save(); } refreshLine(li, l, true); });
    fields.append(field('Quantity', qty));
    const col = h('select', { name: `colours-${i}` });
    for (const v of ['', '0', ...Array.from({ length: maxColours(p) }, (_, k) => String(k + 1))]) {
      const o = h('option', { value: v }, colourLabel(v)); o.selected = String(l.colours ?? '') === v; col.append(o);
    }
    col.addEventListener('change', () => { l.colours = col.value; save(); renderSummary(); });
    fields.append(field('Print', col));

    li.append(name, rm, fields, h('p', { class: 'pl-min', id: `plMin-${i}` }));
    refreshLine(li, l, false);
    return li;
  }));
  const n = lines.length;
  $('#plTotal').textContent = `${n} product${n === 1 ? '' : 's'}`;
}
function refreshLine(li, l, showError = true) {
  const p = byId(l.productId), msgEl = $('.pl-min', li), qty = $('input', li);
  const min = minimumFor(p, l.sizeId);
  const err = problem(l);
  const hard = err && (showError || (units(l.qty) && min && units(l.qty) < min));
  msgEl.classList.toggle('is-error', !!hard);
  msgEl.textContent = hard ? err : min ? `Minimum order ${fmt(min)}` : 'Minimum order confirmed with your quote';
  if (hard && /quantity|Minimum/i.test(err)) qty.setAttribute('aria-invalid', 'true'); else qty.removeAttribute('aria-invalid');
  qty.placeholder = min ? fmt(min) : 'For example 5,000';
}
let FAMILY_NAMES = {};
try { FAMILY_NAMES = JSON.parse(dialog?.dataset.families || '{}'); } catch (e) { FAMILY_NAMES = {}; }
const familyName = (id) => FAMILY_NAMES[id] || '';

/* ---------- the list inside the quote form ---------- */
function renderSummary() {
  const box = $('[data-pl-summary]');
  if (!box) return;
  box.hidden = lines.length === 0;
  const qtyField = $('#p-qty')?.closest('.field');
  if (qtyField) qtyField.hidden = lines.length > 0; // each line carries its own quantity
  $('#plSummaryCount').textContent = `${lines.length} product${lines.length === 1 ? '' : 's'}`;
  $('#plSummaryBody').replaceChildren(...lines.map((l) => {
    const p = byId(l.productId);
    const s = (p.sizes || []).find((x) => x.id === l.sizeId);
    const tr = h('tr');
    const td = h('td', {}, p.name);
    td.append(h('small', {}, [s?.label, colourLabel(l.colours)].filter(Boolean).join(', ')));
    const err = problem(l);
    tr.append(td, h('td', {}, units(l.qty) ? fmt(units(l.qty)) : 'Quantity needed'));
    if (err) tr.lastChild.style.color = 'var(--danger)';
    return tr;
  }));
}

/* ---------- counts and the Add buttons ---------- */
function renderCount() {
  const c = $('.count', openBtn);
  if (!c) return;
  c.textContent = String(lines.length);
  c.toggleAttribute('data-zero', lines.length === 0);
  openBtn.setAttribute('aria-label', `Packing list, ${lines.length} product${lines.length === 1 ? '' : 's'}`);
  for (const b of $$('.pp-add')) {
    const inList = lines.some((l) => l.productId === b.dataset.id);
    b.setAttribute('aria-pressed', String(inList));
    $('span', b).textContent = inList ? 'In packing list' : 'Add to packing list';
  }
}
const renderAll = () => { renderCount(); renderSummary(); if (dialog?.open) renderDialog(); };

/* ---------- actions ---------- */
function add(id, fromEl) {
  const p = byId(id);
  if (!p) return;
  const i = lines.findIndex((l) => l.productId === id);
  if (i >= 0) { open(i); return; }
  lines.push({ productId: id, sizeId: p.sizes?.[0]?.id || '', qty: minimumFor(p, p.sizes?.[0]?.id) || '', colours: '' });
  save();
  track({ event: 'bundle_add' });
  const counter = $('.count', openBtn);
  flyTo(fromEl, counter, p.name, () => bump(counter));
  renderAll();
  announce(`${p.name} added to the packing list. ${lines.length} product${lines.length === 1 ? '' : 's'} in the list.`);
}
function remove(i) {
  const p = byId(lines[i]?.productId);
  lines.splice(i, 1);
  save();
  track({ event: 'bundle_remove' });
  renderAll();
  renderDialog();
  announce(`${p?.name || 'Product'} removed.`);
  ($('.pl-line .pl-remove', dialog) || $('#plClose')).focus();
}
function open(focusIndex) {
  if (!dialog) return;
  renderDialog();
  if (!dialog.open) dialog.showModal();
  const li = focusIndex != null ? $(`.pl-line[data-index="${focusIndex}"]`, dialog) : null;
  (li ? $('input', li) : $('#plClose')).focus();
}
const live = $('#plStatus');
function announce(msg) { if (!live) return; live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 60); }

openBtn?.addEventListener('click', () => open());
$('#plClose')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (e) => { if (e.target === dialog || e.target.closest('[data-pl-close]')) dialog.close(); }); // the backdrop, or a link out
$('#plSend')?.addEventListener('click', () => {
  const bad = lines.findIndex((l) => problem(l));
  if (bad >= 0) { renderDialog(); $$('.pl-line', dialog).forEach((li, i) => refreshLine(li, lines[i], true)); $(`.pl-line[data-index="${bad}"] input`, dialog)?.focus(); track({ event: 'bundle_below_min' }); return; }
  dialog.close();
  const form = $('#inquiry');
  if (form) form.dataset.product = 'Packaging';
  track({ event: 'bundle_send' });
  $('#quote')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('#inquiry input[name="name"]')?.focus({ preventScroll: true });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.pp-add');
  if (b) add(b.dataset.id, b);
  if (e.target.closest?.('[data-pl-edit]')) open();
});

/* ---------- the quote form ---------- */
formHooks.bundle = () => {
  if (!lines.length) return null;
  const bad = lines.find((l) => problem(l));
  if (bad) return { error: `${byId(bad.productId)?.name}: ${problem(bad)}` };
  return { items: lines.map((l) => ({ productId: l.productId, sizeId: l.sizeId || undefined, qty: units(l.qty), colours: l.colours === '' ? undefined : Number(l.colours) })) };
};
formHooks.bundleProblem = () => { track({ event: 'bundle_below_min' }); open(lines.findIndex((l) => problem(l))); };
formHooks.rejected = (reply) => {
  if (reply.productId) open(Math.max(0, lines.findIndex((l) => l.productId === reply.productId)));
};
formHooks.sent = () => { lines = []; save(); renderAll(); };

/* ---------- start ---------- */
reconcile(); save(); renderAll();
onProducts(() => { reconcile(); save(); renderAll(); });
// the catalogue re-drew its panels: mark the ones already in the list
document.addEventListener('catalogue:rendered', renderCount);
// the status bar on the other pages links here with ?list=open
{
  const u = new URL(location.href);
  if (u.searchParams.get('list') === 'open') {
    u.searchParams.delete('list');
    history.replaceState(history.state, '', u);
    if (lines.length) open();
  }
}

export const packingList = { add, open, count: () => lines.length };
