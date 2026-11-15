// The studio's 3D box: which products may be shown as one (lib/box-styles.js),
// how the studio orders them, and the guard that keeps a box from ever being
// drawn at a size the packaging team did not enter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { has3d, boxStyle, boxBoard, boxOf, cmLabel, BOX_STYLES, BOARDS } from '../lib/box-styles.js';
import { inStudio, studioOrder, hasPhotoMockup } from '../lib/catalogue-facts.js';

const measured = [{ id: 's', label: 'Small', w: 25, d: 25, h: 4 }, { id: 'l', label: 'Large', w: 40, d: 40, h: 5 }];
const box = (extra) => ({ id: 'pk_pizza', name: 'Pizza boxes', shape3d: 'mailer', sizes: measured, ...extra });
const QUAD = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];

test('a box is shown in 3D only with a style and every size measured', () => {
  assert.equal(has3d(box()), true);
  assert.equal(has3d(box({ shape3d: 'carton' })), true);
  assert.equal(has3d(box({ shape3d: null })), false, 'no style: photo only');
  assert.equal(has3d(box({ shape3d: 'rocket' })), false, 'an unknown style');
  assert.equal(has3d(box({ shape3d: 'toString' })), false, 'not fooled by object properties');
  assert.equal(has3d(box({ sizes: [] })), false, 'no sizes: nothing to build it from');
  assert.equal(has3d(box({ sizes: undefined })), false);
  // one size short of a measurement keeps the whole product out: never a guessed size
  for (const k of ['w', 'd', 'h']) {
    for (const bad of [null, undefined, 0, -3, NaN, '25']) {
      const sizes = [measured[0], { ...measured[1], [k]: bad }];
      assert.equal(has3d(box({ sizes })), false, `${k} = ${String(bad)}`);
    }
  }
  assert.equal(has3d(null), false);
});

test('stored values are read safely', () => {
  assert.equal(boxStyle('mailer'), 'mailer');
  for (const v of ['', null, undefined, 'Mailer', '__proto__', 42]) assert.equal(boxStyle(v), null, String(v));
  assert.equal(boxBoard('white'), 'white');
  assert.equal(boxBoard('both'), 'both');
  for (const v of ['', null, 'gold', 'constructor']) assert.equal(boxBoard(v), 'kraft', String(v));
  // the first two ids are kept as stored before more shapes were added
  assert.deepEqual(Object.keys(BOX_STYLES).sort(), ['bag', 'bag-flat', 'bag-twisted', 'carton', 'mailer', 'pillow', 'pouch', 'sachet', 'scoop', 'tray']);
  assert.deepEqual(Object.keys(BOARDS).sort(), ['both', 'foil', 'kraft', 'white']);
  assert.equal(boxBoard('foil'), 'foil');
});

test('a measured box joins the studio without a photo, after the photographed products', () => {
  const photo = { id: 'pk_bag', name: 'Bags', image: '/images/packaging/products/bag.webp', quad: QUAD, sizes: [] };
  const only3d = box();
  const unmeasured = box({ id: 'pk_tray', sizes: [{ id: 's', label: 'Small', w: 20, d: null, h: 5 }] });
  assert.equal(inStudio(only3d), true);
  assert.equal(inStudio(unmeasured), false);
  assert.equal(hasPhotoMockup(only3d), false);
  assert.deepEqual(studioOrder([only3d, unmeasured, photo]).map((p) => p.id), ['pk_bag', 'pk_pizza']);
  // a photographed box with a 3D shape is listed once, with the photographed ones
  assert.deepEqual(studioOrder([{ ...photo, ...box({ id: 'pk_med', image: photo.image, quad: QUAD }) }]).map((p) => p.id), ['pk_med']);
});

test('the box is built only from measured sizes, in millimetres from the centimetres the team enters', () => {
  const p = box({ board3d: 'both', sizes: [{ id: 'small', label: 'Small', w: 25, d: 25, h: 4 }, { id: 'medium', label: 'Medium', w: 30, d: 30, h: 4.5 }] });
  const b = boxOf(p, 'small', 'white');
  assert.deepEqual([b.w, b.d, b.h], [250, 250, 40]);
  assert.deepEqual(b.labels, { w: '25 cm', d: '25 cm', h: '4 cm' });
  assert.equal(b.board, 'white', 'the visitor chooses when the box comes in both boards');
  assert.equal(boxOf(p, 'nope').sizeLabel, 'Medium', 'an unknown size falls back to medium');
  assert.equal(boxOf({ ...p, board3d: 'kraft' }, 'small', 'white').board, 'kraft', 'a box made in one board stays in it');
  assert.equal(boxOf(box({ sizes: [{ id: 's', label: 'Small', w: 20, d: null, h: 5 }] }), 's'), null, 'never a guessed size');
  assert.equal(boxOf(box({ shape3d: null })), null);
  assert.equal(cmLabel(12.5), '12.5 cm');
});

test('the studio and product pages build their package with boxOf; three.js loads only on demand', () => {
  for (const file of ['../src/scripts/studio-3d.js', '../src/scripts/package-3d/viewer.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /boxOf\(/, `${file} uses the shared boxOf`);
    assert.doesNotMatch(src, /example sizes|min: \[|\* 10/i, `${file} does no size maths of its own`);
    assert.doesNotMatch(src, /^import .*three/m, `${file} does not load three.js with the page`);
    assert.match(src, /import\('\.\/(package-3d\/)?scene\.js'\)/, `${file} fetches the scene when a package is first shown`);
  }
  // the product page loads the viewer only once the live switches say 3D is on
  const pd = fs.readFileSync(new URL('../src/scripts/pd-pack.js', import.meta.url), 'utf8');
  assert.match(pd, /\/api\/packaging-3d/);
  assert.match(pd, /if \(!on\) return;\s*const \{ mountViewer \} = await import\('\.\/package-3d\/viewer\.js'\)/);
  assert.doesNotMatch(pd, /^import .*(three|package-3d)/m, 'nothing of the 3D view loads before the switches are known');
});
