// The catalogue's facts as a spreadsheet (UX-2): the teams download what the site
// knows and what is missing, fill it in away from the screen, and import it back.
// An import is checked row by row with the same rules as the forms, previewed as a
// list of changes, and saved only when every row is acceptable. Server only: it
// reads with the packaging and specification rules (lib/packaging-rules.js, agri-spec.js).
import { units, pricePer1000, leadDays, dimOf } from './packaging-rules.js';
import { SPEC_FIELDS } from './agri-spec.js';

/* ---------- CSV ---------- */

// A cell Excel would run as a formula is written with a leading apostrophe (and
// read back without it), so a downloaded file can never execute anything.
const FORMULA = /^[=+\-@\t\r]/;
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Rows of cells as CSV text, with a byte order mark so Excel reads Amharic and accents right. */
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** CSV text as rows of cells (quoted cells, doubled quotes, commas and line breaks inside quotes). */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], v = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { v += '"'; i++; }
      else if (c === '"') q = false;
      else v += c;
    } else if (c === '"' && v === '') q = true;
    else if (c === ',') { row.push(v); v = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(v); rows.push(row); row = []; v = '';
    } else v += c;
  }
  if (v !== '' || row.length) { row.push(v); rows.push(row); }
  // a cell written with a protective apostrophe comes back as typed; blank lines are dropped
  return rows.map((r) => r.map((x) => (x.startsWith("'") && FORMULA.test(x.slice(1)) ? x.slice(1) : x).trim())).filter((r) => r.some(Boolean));
}

/** The header must be exactly the one downloaded: a missing or renamed column would clear values. */
function readTable(text, header) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: 'The file is empty.' };
  const got = rows[0];
  if (got.length !== header.length || got.some((h, i) => h !== header[i])) return { error: 'The columns do not match the download. Download a fresh copy, fill it in, and import that file without renaming, adding or removing columns.' };
  return { records: rows.slice(1).map((cells, i) => ({ line: i + 2, cells })) };
}

/* ---------- packaging: prices, minimums, lead times, measurements, what fits ---------- */

export const PACK_HEADER = ['Product ID', 'Product', 'Size ID', 'Size', 'Width (cm)', 'Depth (cm)', 'Height (cm)', 'Holds', 'Minimum order', 'Price per 1,000 (ETB)', 'Ready in (working days)'];

/** One row for each product (its own minimum, price and lead time), then one for each of its sizes. */
export function packRows(products) {
  const out = [PACK_HEADER];
  for (const p of products) {
    out.push([p.id, p.name, '', '(whole product)', '', '', '', '', p.minOrder ?? '', p.pricePer1000 ?? '', p.leadTimeDays ?? '']);
    for (const s of p.sizes || []) out.push([p.id, p.name, s.id, s.label, s.w ?? '', s.d ?? '', s.h ?? '', s.holds || '', s.minOrder ?? '', s.pricePer1000 ?? '', '']);
  }
  return out;
}

/**
 * The changes an imported packaging file makes: { changes, errors, next } where next
 * is the product list with every change applied (nothing is applied when there are
 * errors). A blank cell clears the value, as in the form.
 */
export function packImport(text, products) {
  const t = readTable(text, PACK_HEADER);
  if (t.error) return { changes: [], errors: [{ line: 1, message: t.error }], next: null };
  const next = products.map((p) => ({ ...p, sizes: (p.sizes || []).map((s) => ({ ...s })) }));
  const changes = [], errors = [];
  const seen = new Set();
  for (const { line, cells } of t.records) {
    const [pid, , sid, , w, d, h, holds, min, price, ready] = cells;
    const p = next.find((x) => x.id === pid);
    if (!p) { errors.push({ line, message: `No product with the ID "${pid}". Keep the Product ID column as downloaded.` }); continue; }
    const key = `${pid}|${sid}`;
    if (seen.has(key)) { errors.push({ line, message: `${p.name}${sid ? `, size ${sid},` : ''} appears twice.` }); continue; }
    seen.add(key);
    const sizeName = sid ? (p.sizes.find((x) => x.id === sid)?.label || sid) : '';
    const bad = (what, value, rule) => errors.push({ line, message: `${p.name}${sid ? ` (${sid})` : ''}: ${what} "${value}" ${rule}` });
    const take = (obj, field, label, value, read, rule) => {
      if (value === '') { if (obj[field] != null && obj[field] !== '') { changes.push({ line, product: p.name, size: sid || '', sizeLabel: sizeName, field: label, from: obj[field], to: '' }); obj[field] = field === 'holds' ? '' : null; } return; }
      const v = read(value);
      if (v === null || Number.isNaN(v)) return bad(label, value, rule);
      if (v !== obj[field]) { changes.push({ line, product: p.name, size: sid || '', sizeLabel: sizeName, field: label, from: obj[field] ?? '', to: v }); obj[field] = v; }
    };
    if (!sid) {
      if (w || d || h || holds) { errors.push({ line, message: `${p.name}: measurements and "Holds" belong on the size rows, not the whole-product row.` }); continue; }
      take(p, 'minOrder', 'Minimum order', min, units, 'is not a whole number of units.');
      take(p, 'pricePer1000', 'Price per 1,000', price, (v) => pricePer1000(v), 'is not an amount in birr.');
      take(p, 'leadTimeDays', 'Ready in', ready, (v) => leadDays(v), 'is not 1 to 365 working days.');
      continue;
    }
    const s = p.sizes.find((x) => x.id === sid);
    if (!s) { errors.push({ line, message: `${p.name} has no size "${sid}". Add new sizes in the product editor first.` }); continue; }
    if (ready) { errors.push({ line, message: `${p.name} (${sid}): "Ready in" is set for the whole product, on its first row.` }); continue; }
    take(s, 'w', 'Width', w, dimOf, 'is not centimetres, up to 500.');
    take(s, 'd', 'Depth', d, dimOf, 'is not centimetres, up to 500.');
    take(s, 'h', 'Height', h, dimOf, 'is not centimetres, up to 500.');
    take(s, 'holds', 'Holds', holds, (v) => (v.length <= 60 ? v : NaN), 'is longer than 60 characters.');
    take(s, 'minOrder', 'Minimum order', min, units, 'is not a whole number of units.');
    take(s, 'pricePer1000', 'Price per 1,000', price, (v) => pricePer1000(v), 'is not an amount in birr.');
  }
  return { changes, errors, next: errors.length ? null : next };
}

/* ---------- agriculture: purity, minimum and the specification sheet ---------- */

export const AGRI_HEADER = ['Product ID', 'Product', 'Purity', 'Minimum order', ...SPEC_FIELDS.map((f) => f.label)];

export const agriRows = (products) => [AGRI_HEADER, ...products.map((p) => [p.id, p.name, p.purity || '', p.moq || '', ...SPEC_FIELDS.map((f) => p.spec?.[f.key] || '')])];

/** The changes an imported agriculture file makes, as for packaging. Text up to the form's limits. */
export function agriImport(text, products) {
  const t = readTable(text, AGRI_HEADER);
  if (t.error) return { changes: [], errors: [{ line: 1, message: t.error }], next: null };
  const next = products.map((p) => ({ ...p, spec: { ...(p.spec || {}) } }));
  const changes = [], errors = [], seen = new Set();
  for (const { line, cells } of t.records) {
    const [pid, , purity, moq, ...spec] = cells;
    const p = next.find((x) => x.id === pid);
    if (!p) { errors.push({ line, message: `No product with the ID "${pid}". Keep the Product ID column as downloaded.` }); continue; }
    if (seen.has(pid)) { errors.push({ line, message: `${p.name} appears twice.` }); continue; }
    seen.add(pid);
    const set = (obj, field, label, value, max) => {
      if (value.length > max) return errors.push({ line, message: `${p.name}: ${label} is longer than ${max} characters.` });
      const was = obj[field] || '';
      if (value !== was) {
        changes.push({ line, product: p.name, size: '', field: label, from: was, to: value });
        // a blank purity or minimum is stored empty, as the form stores it; a blank specification field is left out
        if (value || obj === p) obj[field] = value; else delete obj[field];
      }
    };
    set(p, 'purity', 'Purity', purity, 50);
    set(p, 'moq', 'Minimum order', moq, 50);
    SPEC_FIELDS.forEach((f, i) => set(p.spec, f.key, f.label, spec[i] || '', 120));
  }
  return { changes, errors, next: errors.length ? null : next };
}
