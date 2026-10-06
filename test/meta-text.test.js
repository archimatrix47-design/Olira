import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipDescription, fitTitle } from '../src/lib/meta-text.js';

test('a short description is kept whole', () => {
  assert.equal(clipDescription('Paper bags printed with your logo.'), 'Paper bags printed with your logo.');
});

test('a long description ends at a full sentence', () => {
  const s = 'Cleaned Natural Sesame Seeds from Ethiopia, 99.95% purity, minimum order 10 MT. Premium Humera variety with 50%+ oil content and creamy color. 99.95% purity. Perfect for bakery, tahini and oil.';
  const out = clipDescription(s);
  assert.ok(out.length <= 155, out.length);
  assert.ok(out.endsWith('creamy color.'), out);
});

test('without a late sentence end it stops at a word, with an ellipsis', () => {
  const s = 'Square bottom paper bags made in Addis Ababa and printed with your logo, up to four colours, for bakeries, restaurants, shops and pharmacies that want a strong bag with a flat base that stands';
  const out = clipDescription(s);
  assert.ok(out.length <= 156, out.length);
  assert.ok(out.endsWith('…') && !/\s…$/.test(out) && !/,…$/.test(out), out);
  assert.ok(s.startsWith(out.slice(0, -1)), 'cut, not changed');
});

test('titles fall back to a shorter form when the long one does not fit', () => {
  const name = 'Bakery and confectionery boxes';
  const t = fitTitle([`${name}, printed with your logo | Olira Packaging`, `${name} with your logo | Olira Packaging`, `${name} | Olira Packaging`]);
  assert.equal(t, 'Bakery and confectionery boxes | Olira Packaging');
  assert.equal(fitTitle(['Flat handle bags, printed with your logo | Olira Packaging', 'x']), 'Flat handle bags, printed with your logo | Olira Packaging');
});
