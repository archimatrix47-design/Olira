// The catalogue's facts as a spreadsheet (UX-2, lib/facts-csv.js): written so Excel
// can open it and never run it, read back exactly, and imported only when every row
// passes the same rules as the forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, parseCsv, packRows, packImport, PACK_HEADER, agriRows, agriImport, AGRI_HEADER } from '../lib/facts-csv.js';
import { normalise } from '../lib/packaging-rules.js';

const products = [normalise({ id: 'pk_pouch', name: 'Kraft pouches', family: 'foil', minOrder: 5000, sizes: [{ id: 'small', label: 'Small', w: 12, d: 6, h: 20 }, { id: 'large', label: 'Large' }] })];
const edit = (rows, f) => toCsv(f(rows.map((r) => r.map(String))));

test('a CSV round trip keeps quotes, commas, line breaks and accents, and never runs a formula', () => {
  const rows = [['A', 'B'], ['=HYPERLINK("x")', 'a, "b"\nc'], ['-5', 'Addis Ababa, ኢትዮጵያ'], ['@SUM(1)', '+1']];
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('﻿'), 'a byte order mark for Excel');
  assert.match(csv, /"'=HYPERLINK/, 'a formula is written as text');
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv.replace(/"'=/, '')), 'no cell starts with =');
  assert.deepEqual(parseCsv(csv), rows, 'read back exactly as written ("-5" stays a number)');
  assert.deepEqual(parseCsv('a,b\r\n\r\n1,2\n'), [['a', 'b'], ['1', '2']], 'blank lines dropped, both line endings read');
});

test('packaging: the download, a filled-in copy, and the changes it makes', () => {
  const rows = packRows(products);
  assert.deepEqual(rows[0], PACK_HEADER);
  assert.deepEqual(rows.map((r) => r[2]), ['Size ID', '', 'small', 'large'], 'a whole-product row, then each size');
  const csv = edit(rows, (r) => { r[1][9] = '1,250.50'; r[1][10] = '12'; r[3][5] = '9,5'; r[3][7] = '250 g coffee'; r[2][4] = ''; return r; });
  const out = packImport(csv, products);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.changes.map((c) => [c.size, c.field, c.to]), [['', 'Price per 1,000', 1250.5], ['', 'Ready in', 12], ['small', 'Width', ''], ['large', 'Depth', 9.5], ['large', 'Holds', '250 g coffee']]);
  assert.deepEqual(out.changes.map((c) => c.sizeLabel), ['', '', 'Small', 'Large', 'Large'], 'the preview names each size as the team wrote it');
  const next = out.next[0];
  assert.equal(next.sizes[0].w, null, 'a cleared cell clears the value');
  assert.equal(products[0].pricePer1000, null, 'the original list is not changed');
  assert.equal(packImport(toCsv(rows), products).changes.length, 0, 'the file as downloaded changes nothing');
});

test('packaging: any bad row stops the whole import, each named', () => {
  const rows = packRows(products);
  const csv = edit(rows, (r) => { r[1][9] = 'cheap'; r[2][4] = '700'; r[3][10] = '5'; r[1][4] = '3'; r.push(['pk_gone', 'Gone', '', '', '', '', '', '', '', '', '']); r.push([...r[2]]); r.push(['pk_pouch', '', 'medium', '', '', '', '', '', '', '', '']); return r; });
  const out = packImport(csv, products);
  assert.equal(out.next, null, 'nothing is applied');
  const text = out.errors.map((e) => `${e.line}: ${e.message}`).join('\n');
  for (const want of [/measurements and "Holds" belong on the size rows/, /Width "700" is not centimetres/, /"Ready in" is set for the whole product/, /No product with the ID "pk_gone"/, /appears twice/, /has no size "medium"/]) assert.match(text, want);
  assert.match(packImport('Product,Size\npk_pouch,small\n', products).errors[0].message, /columns do not match/, 'a changed header is refused before anything else');
});

test('agriculture: purity, minimum and the specification sheet', () => {
  const agri = [{ id: 'sesame', name: 'Sesame', purity: '99.95%', moq: '10 MT', spec: { moisture: '6% max' } }];
  const rows = agriRows(agri);
  assert.deepEqual(rows[0], AGRI_HEADER);
  const iMoist = AGRI_HEADER.indexOf('Moisture'), iAfla = AGRI_HEADER.indexOf('Aflatoxin');
  const out = agriImport(edit(rows, (r) => { r[1][iAfla] = '4 ppb total max'; r[1][iMoist] = ''; r[1][3] = ''; return r; }), agri);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.next[0].spec, { aflatoxin: '4 ppb total max' }, 'a cleared field is removed, a new one added');
  assert.equal(out.next[0].moq, '', 'a cleared minimum is stored empty, as the form does');
  const long = agriImport(edit(rows, (r) => { r[1][iAfla] = 'x'.repeat(121); return r; }), agri);
  assert.match(long.errors[0].message, /longer than 120/);
  assert.equal(long.next, null);
});
