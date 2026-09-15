// Quote builder: line items and terms for the enquiry's line, saved on the
// enquiry (moves it to Quoted) and printed as a one-page quote, which the
// browser can save as a PDF. No phone numbers are printed on the quote.
import { $, h, api, toast } from '../admin/api.js';
import { session } from './session.js';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const money = (cur, n) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let catalogue = null;
async function productNames() {
  if (catalogue) return catalogue;
  try {
    catalogue = session.line === 'pack'
      ? (await api('/api/packaging-products?scope=team')).map((p) => p.name)
      : (await api('/api/products')).map((p) => p.name);
  } catch (e) { catalogue = []; }
  return catalogue;
}

function defaults(l) {
  const pack = session.line === 'pack';
  const prev = l.quote;
  if (prev) return JSON.parse(JSON.stringify(prev));
  const port = (String(l.message || '').match(/Destination port:\s*(.+)/i) || [])[1]?.trim() || '';
  const qty = (String(l.message || '').match(/Quantity:\s*([\d.,]+)/i) || [])[1]?.replace(/,/g, '') || '';
  return {
    currency: pack ? 'ETB' : 'USD',
    items: [{ item: l.product && !/^(Agricultural products|Packaging)$/i.test(l.product) ? l.product : '', detail: '', qty, unit: pack ? 'bags' : 'MT', price: '' }],
    extra: '', extraLabel: pack ? 'Printing plates' : '',
    validUntil: inDays(pack ? 14 : 7),
    terms: pack ? { port, leadTime: '', payment: '' } : { incoterm: 'FOB Djibouti', port, payment: '', shipment: '', packing: '' },
    notes: '',
  };
}

export function quoteBuilder(l, { onSaved, draft } = {}) {
  const pack = session.line === 'pack';
  const q = draft || defaults(l);
  const wrap = h('details', { class: 't-quote', 'data-quote': '', open: draft || !l.quote ? null : null });
  const summary = h('summary', {}, l.quote ? `Quote ${l.quote.number}, ${money(l.quote.currency, l.quote.total)}, saved ${new Date(l.quote.at).toLocaleDateString()}` : 'Build a quote');
  const listId = `names-${l.id}`;
  const datalist = h('datalist', { id: listId });
  productNames().then((names) => datalist.replaceChildren(...names.map((n) => h('option', { value: n }))));

  const rows = h('div', { class: 't-lines' });
  const total = h('strong', { class: 't-quote-total' });
  const currency = h('select', { class: 'input', 'aria-label': 'Currency' }, ['USD', 'EUR', 'ETB'].map((c) => h('option', { value: c, selected: q.currency === c || null }, c)));

  let lineNo = 0;
  const addRow = (it = {}) => {
    const n = ++lineNo;
    const cell = (name, label, attrs = {}) => {
      const id = `q-${name}-${l.id}-${n}`;
      const i = h('input', { class: 'input', id, name, ...attrs });
      i.value = it[name] ?? '';
      i.addEventListener('input', recalc);
      return h('div', { class: `t-cell t-cell-${name}` }, h('label', { for: id }, label), i);
    };
    const remove = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Remove this line' }, 'Remove');
    const line = h('div', { class: 't-line', role: 'group', 'aria-label': 'Quote line' },
      cell('item', 'Product', { list: listId, maxlength: '160', placeholder: pack ? 'Flat handle bags' : 'Humera sesame' }),
      cell('detail', 'Details', { maxlength: '240', placeholder: pack ? 'Medium, brown kraft, 2 colours' : 'Grade, purity, crop year' }),
      cell('qty', 'Quantity', { inputmode: 'decimal', class: 'input num' }),
      cell('unit', 'Unit', { maxlength: '20' }),
      cell('price', 'Unit price', { inputmode: 'decimal', class: 'input num' }),
      h('div', { class: 't-cell t-cell-total' }, h('span', {}, 'Line total'), h('output', { class: 't-line-total' })),
      h('div', { class: 't-cell t-cell-remove' }, remove));
    remove.addEventListener('click', () => { if (rows.children.length > 1) { line.remove(); recalc(); } });
    rows.append(line);
    recalc();
  };
  const field = (label, name, value, attrs = {}) => {
    const id = `${name}-${l.id}`;
    const input = h(attrs.tag || 'input', { class: 'input', id, name, ...attrs, tag: null });
    input.value = value ?? '';
    return h('div', { class: 'a-field' }, h('label', { for: id }, label), input);
  };
  const extraAmount = h('input', { class: 'input num', name: 'extra', inputmode: 'decimal', 'aria-label': 'Amount of the other charge', placeholder: 'Amount' });
  extraAmount.value = q.extra || '';
  extraAmount.addEventListener('input', recalc);
  const extraLabel = h('input', { class: 'input', name: 'extraLabel', maxlength: '80', 'aria-label': 'Other charge', placeholder: pack ? 'Printing plates' : 'Other charges' });
  extraLabel.value = q.extraLabel || '';

  function read() {
    const items = [...rows.children].map((tr) => ({
      item: tr.querySelector('[name=item]').value.trim(), detail: tr.querySelector('[name=detail]').value.trim(),
      qty: Number(String(tr.querySelector('[name=qty]').value).replace(/,/g, '')), unit: tr.querySelector('[name=unit]').value.trim(),
      price: Number(String(tr.querySelector('[name=price]').value).replace(/,/g, '')),
    })).filter((it) => it.item);
    const val = (n) => wrap.querySelector(`[name=${n}]`)?.value.trim() || '';
    return {
      currency: currency.value, items, extra: Number(String(extraAmount.value).replace(/,/g, '')) || 0, extraLabel: extraLabel.value.trim(),
      validUntil: val('validUntil'), notes: val('notes'),
      terms: pack ? { port: val('port'), leadTime: val('leadTime'), payment: val('payment') } : { incoterm: val('incoterm'), port: val('port'), payment: val('payment'), shipment: val('shipment'), packing: val('packing') },
    };
  }
  function recalc() {
    let sum = 0;
    for (const tr of rows.children) {
      const qty = Number(String(tr.querySelector('[name=qty]').value).replace(/,/g, '')) || 0;
      const price = Number(String(tr.querySelector('[name=price]').value).replace(/,/g, '')) || 0;
      tr.querySelector('.t-line-total').textContent = qty && price ? money(currency.value, qty * price) : '';
      sum += qty * price;
    }
    sum += Number(String(extraAmount?.value || '').replace(/,/g, '')) || 0;
    total.textContent = `Total ${money(currency.value, sum)}`;
  }
  currency.addEventListener('change', recalc);
  (q.items?.length ? q.items : [{}]).forEach(addRow);

  const table = rows;

  const terms = pack
    ? h('div', { class: 'a-three' }, field('Delivery to', 'port', q.terms?.port, { maxlength: '80' }), field('Lead time', 'leadTime', q.terms?.leadTime, { maxlength: '80', placeholder: '15 working days after artwork approval' }), field('Payment', 'payment', q.terms?.payment, { maxlength: '120', placeholder: '50% with order, 50% before delivery' }))
    : h('div', { class: 'a-three' },
      (() => { const id = `incoterm-${l.id}`; const s = h('select', { class: 'input', id, name: 'incoterm' }, ['FOB Djibouti', 'CFR', 'CIF', 'EXW Addis Ababa', 'FCA Addis Ababa'].map((v) => h('option', { value: v, selected: q.terms?.incoterm === v || null }, v))); return h('div', { class: 'a-field' }, h('label', { for: id }, 'Incoterm'), s); })(),
      field('Port or place', 'port', q.terms?.port, { maxlength: '80', placeholder: 'Destination port for CFR and CIF' }),
      field('Payment', 'payment', q.terms?.payment, { maxlength: '120', placeholder: 'LC at sight, or CAD' }),
      field('Shipment', 'shipment', q.terms?.shipment, { maxlength: '120', placeholder: 'Within 30 days of confirmed order' }),
      field('Packing', 'packing', q.terms?.packing, { maxlength: '160', placeholder: '50 kg PP bags' }));

  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, l.quote ? 'Save as a new version' : 'Save quote');
  const print = h('button', { class: 'btn btn-secondary', type: 'button', disabled: !l.quote || null }, 'Print or save as PDF');
  print.addEventListener('click', () => printQuote(l, l.quote));

  const form = h('form', { class: 't-quote-form', novalidate: true },
    h('div', { class: 't-quote-top' }, h('div', { class: 'a-field' }, h('label', {}, 'Currency', currency)), field('Valid until', 'validUntil', q.validUntil, { type: 'date', min: today() })),
    table,
    h('div', { class: 'row', style: '--gap:8px;flex-wrap:wrap' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addRow({ unit: pack ? 'bags' : 'MT' }) }, 'Add a line')),
    h('div', { class: 't-extra' }, extraLabel, extraAmount),
    terms,
    field('Notes for the buyer', 'notes', q.notes, { tag: 'textarea', maxlength: '1500', rows: '3' }),
    h('div', { class: 't-quote-foot' }, total, h('div', { class: 'a-actions' }, save, print)),
    l.quote ? h('p', { class: 'a-note' }, 'Saving again keeps the earlier version in the timeline and replaces the current quote.') : null);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const quote = read();
    if (!quote.items.length) return toast('Add at least one line with a product.', 'error');
    const bad = quote.items.find((it) => !it.qty || !(it.price >= 0));
    if (bad) return toast(`Give "${bad.item}" a quantity and a unit price.`, 'error');
    save.disabled = true;
    try {
      const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/quote`, { method: 'POST', body: { quote } });
      toast(`Quote ${r.inquiry.quote.number} saved. The enquiry is now Quoted.`);
      onSaved?.(r.inquiry);
    } catch (x) { toast(x.message, 'error'); }
    finally { save.disabled = false; }
  });

  wrap.__draft = () => (wrap.open ? read() : null);
  if (draft) wrap.open = true;
  wrap.append(summary, datalist, form);
  return wrap;
}

/* ---------- print ---------- */
let company = null;
async function companyDetails() {
  if (company) return company;
  try {
    const [c, b] = await Promise.all([fetch('/api/contact-details').then((r) => r.json()), fetch('/api/branding').then((r) => r.json()).catch(() => ({}))]);
    company = { email: (c.emails || [])[0] || '', address: [c.address?.line2, c.address?.line1, c.address?.poBox, [c.address?.city, c.address?.country].filter(Boolean).join(', ')].filter(Boolean), logo: b?.logo || '/logo.png' };
  } catch (e) { company = { email: '', address: [], logo: '/logo.png' }; }
  return company;
}

export async function printQuote(l, q) {
  if (!q) return toast('Save the quote first.', 'error');
  const c = await companyDetails();
  const pack = q.line === 'pack' || session.line === 'pack';
  const sheet = $('#printSheet');
  const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const t = q.terms || {};
  const termRows = [
    ['Incoterm', t.incoterm ? `${t.incoterm}${t.port && !/Djibouti|Addis/.test(t.incoterm) ? ` ${t.port}` : ''}` : null],
    [pack ? 'Delivery to' : 'Destination', pack ? t.port : (t.incoterm ? null : t.port)],
    ['Packing', t.packing], ['Shipment', t.shipment], ['Lead time', t.leadTime], ['Payment', t.payment],
    ['Valid until', q.validUntil ? date(`${q.validUntil}T00:00:00`) : null],
  ].filter(([, v]) => v);
  sheet.replaceChildren(
    h('header', { class: 'p-head' },
      h('img', { src: c.logo, alt: '', width: '120' }),
      h('div', {}, h('strong', {}, pack ? 'Olira Packaging' : 'Olira Agro Industry'), ...c.address.map((a) => h('span', {}, a)), c.email ? h('span', {}, c.email) : null)),
    h('div', { class: 'p-title' }, h('h1', {}, 'Quotation'), h('dl', {},
      h('div', {}, h('dt', {}, 'Number'), h('dd', {}, q.number)),
      h('div', {}, h('dt', {}, 'Date'), h('dd', {}, date(q.at || Date.now()))))),
    h('div', { class: 'p-to' }, h('span', {}, 'Prepared for'), h('strong', {}, l.name || ''), l.company ? h('span', {}, l.company) : null, l.email ? h('span', {}, l.email) : null),
    h('table', { class: 'p-items' },
      h('thead', {}, h('tr', {}, ['Product', 'Quantity', 'Unit price', 'Amount'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', {},
        q.items.map((it) => h('tr', {},
          h('td', {}, h('strong', {}, it.item), it.detail ? h('span', {}, it.detail) : null),
          h('td', { class: 'num' }, `${Number(it.qty).toLocaleString('en-US')} ${it.unit || ''}`),
          h('td', { class: 'num' }, money(q.currency, it.price)),
          h('td', { class: 'num' }, money(q.currency, it.qty * it.price)))),
        q.extra ? h('tr', {}, h('td', {}, q.extraLabel || 'Other charges'), h('td'), h('td'), h('td', { class: 'num' }, money(q.currency, q.extra))) : null),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: '3' }, 'Total'), h('td', { class: 'num' }, money(q.currency, q.total))))),
    termRows.length ? h('dl', { class: 'p-terms' }, termRows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null,
    q.notes ? h('p', { class: 'p-notes' }, q.notes) : null,
    h('footer', { class: 'p-foot' }, `Prepared by ${q.by?.name || session.user?.name || 'Olira'}${session.user?.email && q.by?.id === session.user.id ? `, ${session.user.email}` : ''}.`));
  const img = sheet.querySelector('img');
  await new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } });
  document.title = `${q.number} ${l.company || l.name || ''}`.trim();
  window.print();
  document.title = `${session.line === 'pack' ? 'Packaging' : 'Agriculture'} workspace, Olira`;
}
