// UX briefs built on 2026-11-07 (RESEARCH.md section 4): the studio's remembered
// design is read back safely (UX-4), and what each size holds is stored as the
// team typed it and shown only where they said (UX-8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSaved, fromSaved } from '../src/scripts/studio-memory.js';
import { specRows } from '../lib/catalogue-facts.js';
import { normalise } from '../lib/packaging-rules.js';

const templates = [{ id: 'pk_twisted' }, { id: 'pk_medbox' }];
const inks = { teal: [], black: [] };

test('a remembered design comes back with only valid values', () => {
  const state = { template: 'pk_medbox', size: 'large', ink: 'black', text1: 'KALDI', text2: 'kaldi.et', scale: 1.2, dx: 12.6, dy: -4, oneInk: true, fit: 'contain', logoFile: { name: 'secret.png' } };
  const saved = toSaved(state);
  assert.equal(saved.logoFile, undefined, 'files are never kept');
  assert.equal(saved.dx, 13);
  assert.deepEqual(fromSaved(JSON.stringify(saved), { templates, inks }), { template: 'pk_medbox', size: 'large', ink: 'black', text1: 'KALDI', text2: 'kaldi.et', scale: 1.2, dx: 13, dy: -4, oneInk: true, fit: 'contain' });
});

test('an old, edited or broken entry never breaks the studio', () => {
  for (const bad of ['', 'not json', '{"v":2}', 'null', '[]', JSON.stringify({ v: 1 })]) assert.equal(fromSaved(bad, { templates, inks }), null, String(bad));
  const odd = fromSaved(JSON.stringify({ v: 1, template: 'pk_gone', size: '../x', ink: 'gold', text1: 'X'.repeat(50), scale: 9, dx: -9999, dy: 'far', oneInk: 'yes', fit: 'stretch' }), { templates, inks });
  assert.deepEqual(odd, { text1: 'X'.repeat(18), scale: 1.4, dx: -600 }, 'unknown product, size and ink dropped; text and numbers kept within the fields\' limits');
  assert.equal(fromSaved('{"v":1,"ink":"constructor"}', { templates, inks }), null, 'not fooled by object properties');
});

test('what each size holds: stored as typed, shown only where the team said', () => {
  const p = normalise({ id: 'pk_pouch', name: 'Pouches', family: 'foil', sizes: [{ label: 'Small', holds: '  250 g coffee  ' }, { label: 'Large', holds: 'x'.repeat(80) }, { label: 'Medium' }] });
  assert.equal(p.sizes[0].holds, '250 g coffee');
  assert.equal(p.sizes[1].holds.length, 60);
  assert.equal(p.sizes[2].holds, '');
  const rows = specRows(p, 4);
  assert.deepEqual(rows.slice(0, 5).map(([k]) => k), ['Sizes', 'Minimum order', 'Print', 'Price', 'Ready in'], 'the first five rows keep their places');
  assert.deepEqual(rows[5], ['What fits', `Small: 250 g coffee; Large: ${'x'.repeat(60)}`]);
  assert.equal(specRows(normalise({ id: 'b', name: 'B', sizes: [{ label: 'Small' }] }), 4).length, 5, 'no row when nothing is known');
});

// just enough of a document for the product page's specification sheet
function sheet(rows) {
  const make = (tag, parent = null) => {
    const el = { tag, className: '', dataset: {}, textContent: '', children: [], parent };
    el.append = (...kids) => kids.forEach((k) => { k.parent = el; el.children.push(k); });
    el.after = (k) => { const s = el.parent.children; k.parent = el.parent; s.splice(s.indexOf(el) + 1, 0, k); };
    el.remove = () => { const s = el.parent.children; s.splice(s.indexOf(el), 1); };
    el.closest = (sel) => (sel === '.spec-row' ? el.parent : null);
    return el;
  };
  const dl = make('dl');
  for (const [key, label, value] of rows) {
    const row = make('div', dl); row.className = 'spec-row'; row.dataset.row = key;
    const dt = make('dt', row); dt.textContent = label;
    const v = make('dd', row); v.className = 'v'; v.dataset.fact = key; v.textContent = value;
    row.children.push(dt, v); dl.children.push(row);
  }
  const all = () => dl.children.flatMap((r) => [r, ...r.children]);
  return {
    dl,
    createElement: (tag) => make(tag),
    querySelector: (sel) => {
      const fact = sel.match(/^\[data-fact="(\w+)"\]$/), row = sel.match(/^\.spec-row\[data-row="(\w+)"\]$/);
      if (fact) return all().find((e) => e.dataset.fact === fact[1]) || null;
      if (row) return dl.children.find((e) => e.dataset.row === row[1]) || null;
      throw new Error(`fake document cannot answer ${sel}`);
    },
    labels: () => dl.children.map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`),
  };
}

test('the product page shows "What fits" set after the build, changes it, and removes it when cleared', async () => {
  const { showFits } = await import('../src/scripts/pd-fits.js');
  const doc = sheet([['sizes', 'Sizes', 'Small, Medium'], ['print', 'Print', 'Flexographic']]);
  showFits('Small: A4 documents', doc);
  assert.deepEqual(doc.labels(), ['Sizes=Small, Medium', 'What fits=Small: A4 documents', 'Print=Flexographic'], 'added after Sizes');
  assert.equal(doc.dl.children[1].children[2].textContent, 'From the packaging team');
  showFits('Small: A4 documents; Medium: 2 shoe boxes', doc);
  assert.deepEqual(doc.labels(), ['Sizes=Small, Medium', 'What fits=Small: A4 documents; Medium: 2 shoe boxes', 'Print=Flexographic'], 'changed in place, not added twice');
  showFits('', doc);
  assert.deepEqual(doc.labels(), ['Sizes=Small, Medium', 'Print=Flexographic'], 'cleared: the row goes');
});
