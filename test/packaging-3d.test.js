// Box packaging-3d. The two switches on the real app: 3D shows on the website only
// while the packaging team AND the manager have switched it on; each account moves
// only its own role's switch; either can take 3D off; the public catalogue drops the
// 3D shape while it is off (the studio and the pages follow it), and the team's own
// view keeps it so staff can check a package first. Then the geometry: every
// template, folded at many sizes, closes (edges meet, the folded size is the
// product's) and lays flat into one closed cut outline; the check itself is proven
// by breaking a lid and a fold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-3d-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
process.env.INQUIRY_RATE_PER_MIN = '1000';
// one product ready for 3D: a shape, and every size measured (centimetres)
const BOX = { id: 'pk_test_box', name: 'Test boxes', family: 'food', description: 'A test box.', shape3d: 'mailer', board3d: 'kraft', sizes: [{ id: 'medium', label: 'Medium', w: 30, d: 30, h: 4 }] };
fs.writeFileSync(path.join(tmp, 'packaging-products.json'), JSON.stringify([BOX]));

const { app } = await import('../server.js');
const { view3dLive, switchesOf, has3d, boxOf, needsDepth, measuredSizes, BOX_STYLES } = await import('../lib/box-styles.js');
const { switchFor } = await import('../lib/packaging-3d.js');
const { dieline, TEMPLATES, panelMatrices, foldPoint } = await import('../lib/package-shapes.js');

let server, base;
const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); });
const req = (method, p, { token, body } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(admin, { name, email, role }) {
  const password = 'member-password-123';
  const r = await req('POST', '/api/admin/team', { token: admin, body: { member: { name, email, role, password } } });
  assert.equal(r.status, 200);
  return (await (await req('POST', '/api/team/login', { body: { email, password } })).json()).token;
}
const live = async () => (await json(await req('GET', '/api/packaging-3d'))).body.on;
const publicBox = async () => (await json(await req('GET', '/api/packaging-products'))).body.find((p) => p.id === BOX.id);

test('the AND gate: 3D shows only when both switches are on', () => {
  const s = (team, manager) => ({ team: { on: team }, manager: { on: manager } });
  assert.equal(view3dLive(s(true, true)), true);
  assert.equal(view3dLive(s(true, false)), false, 'the packaging team alone cannot put it on the site');
  assert.equal(view3dLive(s(false, true)), false, 'the manager alone cannot put it on the site');
  assert.equal(view3dLive(s(false, false)), false);
  // only a real true counts: nothing that merely looks on
  for (const v of ['true', 1, 'on', {}, [true], null, undefined]) assert.equal(view3dLive(s(v, true)), false, String(v));
  for (const v of [{}, null, undefined, [], 'on', { team: true, manager: true }]) assert.equal(view3dLive(v), false, JSON.stringify(v));
  assert.deepEqual(switchesOf(s(true, false)), { team: true, manager: false });
  assert.equal(switchFor('pack'), 'team');
  assert.equal(switchFor('manager'), 'manager');
  for (const r of ['agri', 'admin', '', undefined]) assert.equal(switchFor(r), null);
});

test('each holds one switch; 3D reaches the public catalogue only with both on', async () => {
  const admin = await adminToken();
  const pack = await member(admin, { name: 'Pat Pack', email: 'pack@example.com', role: 'pack' });
  const manager = await member(admin, { name: 'Max Manager', email: 'manager@example.com', role: 'manager' });
  const agri = await member(admin, { name: 'Ann Agri', email: 'agri@example.com', role: 'agri' });

  // nothing switched yet: off, and the public catalogue leaves the shape out
  assert.equal(await live(), false);
  assert.equal((await publicBox()).shape3d, null, 'no 3D shape in the public catalogue while it is off');
  const teamView = (await json(await req('GET', '/api/packaging-products?scope=team', { token: pack }))).body.find((p) => p.id === BOX.id);
  assert.equal(teamView.shape3d, 'mailer', 'the team\'s studio keeps the shape, to check a package first');

  // who may see and move the switches
  assert.equal((await req('GET', '/api/team/packaging-3d')).status, 401);
  assert.equal((await req('POST', '/api/team/packaging-3d', { token: agri, body: { on: true } })).status, 403, 'the agriculture team has no switch');
  assert.equal((await req('POST', '/api/team/packaging-3d', { token: admin, body: { on: true } })).status, 403, 'the administrator has no switch');
  assert.equal((await req('POST', '/api/team/packaging-3d', { token: pack, body: { on: 'yes' } })).status, 400);

  // the packaging team switches on: still off the site
  let r = await json(await req('POST', '/api/team/packaging-3d', { token: pack, body: { on: true, which: 'manager', manager: { on: true } } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.yours, 'team');
  assert.equal(r.body.team.on, true);
  assert.equal(r.body.manager.on, false, 'the team cannot move the manager\'s switch, whatever it sends');
  assert.equal(r.body.team.by, 'Pat Pack');
  assert.equal(r.body.live, false);
  assert.equal(await live(), false);
  assert.equal((await publicBox()).shape3d, null);

  // the manager switches on too: on the site
  r = await json(await req('POST', '/api/team/packaging-3d', { token: manager, body: { on: true } }));
  assert.equal(r.body.yours, 'manager');
  assert.equal(r.body.live, true);
  assert.equal(await live(), true);
  assert.equal((await publicBox()).shape3d, 'mailer', 'the public catalogue carries the shape once both are on');
  const seen = await json(await req('GET', '/api/team/packaging-3d', { token: manager }));
  assert.deepEqual([seen.body.team.on, seen.body.manager.on, seen.body.live], [true, true, true]);

  // either can take it off: the team turns theirs off
  r = await json(await req('POST', '/api/team/packaging-3d', { token: pack, body: { on: false } }));
  assert.equal(r.body.live, false);
  assert.equal(r.body.manager.on, true, 'the manager\'s switch stays as the manager left it');
  assert.equal(await live(), false);
  assert.equal((await publicBox()).shape3d, null);

  // the stored file holds both switches with who and when
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'packaging-3d.json'), 'utf8'));
  assert.equal(stored.team.on, false);
  assert.equal(stored.manager.on, true);
  assert.equal(stored.manager.by, 'Max Manager');
  assert.ok(!Number.isNaN(Date.parse(stored.manager.at)));

  // a damaged file reads as both off
  fs.writeFileSync(path.join(tmp, 'packaging-3d.json'), '[true, true]');
  assert.equal(await live(), false);
  fs.writeFileSync(path.join(tmp, 'packaging-3d.json'), '{"team": {"on": "true"}, "manager": {"on": true}}');
  assert.equal(await live(), false);
});

test('which products are ready for 3D, and the package each becomes', () => {
  const sizes = (d) => [{ id: 's', label: 'Small', w: 10, d, h: 15 }, { id: 'medium', label: 'Medium', w: 14, d, h: 20 }];
  assert.equal(has3d({ shape3d: 'carton', sizes: sizes(5) }), true);
  assert.equal(has3d({ shape3d: 'carton', sizes: sizes(null) }), false, 'a carton needs its depth');
  assert.equal(has3d({ shape3d: 'sachet', sizes: sizes(null) }), true, 'a flat sachet needs only width and height');
  assert.equal(has3d({ shape3d: 'sachet', sizes: [{ id: 'm', w: 10, h: 0 }] }), false);
  // the two shapes drawn from a width and a height alone are not held back for a depth
  for (const id of ['sachet', 'pouch']) assert.equal(needsDepth(id), false, id);
  assert.equal(has3d({ shape3d: 'pouch', sizes: sizes(null) }), true);
  for (const id of Object.keys(BOX_STYLES).filter((k) => k !== 'sachet' && k !== 'pouch')) assert.equal(needsDepth(id), true, id);
  assert.deepEqual(measuredSizes({ shape3d: 'bag', sizes: [{ w: 1, d: 1, h: 1 }, { w: 1, h: 1 }] }), { done: 1, of: 2 });
  assert.deepEqual(measuredSizes({ shape3d: null, sizes: [{ w: 1, d: 1, h: 1 }] }), { done: 0, of: 1 });

  const bag = boxOf({ id: 'b', name: 'Twisted handle bags', shape3d: 'bag-twisted', board3d: 'kraft', sizes: sizes(8) });
  assert.equal(bag.template, 'bag');
  assert.equal(bag.handles, 'twisted');
  assert.deepEqual([bag.w, bag.d, bag.h], [140, 80, 200], 'centimetres become millimetres, the medium size first');
  const sachet = boxOf({ id: 's', name: 'Sachets', shape3d: 'sachet', board3d: 'foil', sizes: sizes(null) });
  assert.equal(sachet.d, 0);
  assert.equal(sachet.labels.d, null);
  assert.equal(sachet.board, 'foil');
  // every shape folds from a real template whose main faces exist
  for (const [id, s] of Object.entries(BOX_STYLES)) {
    assert.ok(Object.hasOwn(TEMPLATES, s.template), `${id} uses template ${s.template}`);
    const m = dieline(s.template, { L: 100, W: 50, H: 120 });
    for (const face of s.main) assert.ok(m.panels.some((p) => p.id === face && p.role === 'face'), `${id}: main face ${face}`);
  }
  assert.throws(() => dieline('toString', { L: 1, W: 1, H: 1 }));
});

/* ---------------- the geometry: does each template really close? ---------------- */

const TOL = 0.5;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const edgeOf = (m, mats, id, i) => { const p = m.panels.find((q) => q.id === id).poly; return [foldPoint(mats, id, p[i], THREE, 0), foldPoint(mats, id, p[(i + 1) % p.length], THREE, 0)]; };
/** How far apart two panel edges end up when folded (0 when they meet). Edges are numbered from a panel's first corner: for a rectangle, 0 bottom, 1 right, 2 top, 3 left. */
function gap(m, mats, [idA, iA], [idB, iB]) {
  const [a1, a2] = edgeOf(m, mats, idA, iA), [b1, b2] = edgeOf(m, mats, idB, iB);
  return Math.min(Math.max(dist(a1, b1), dist(a2, b2)), Math.max(dist(a1, b2), dist(a2, b1)));
}
function extent(m, mats, ids) {
  const pts = ids.flatMap((id) => m.panels.find((q) => q.id === id).poly.map((q) => foldPoint(mats, id, q, THREE)));
  return [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))).sort((a, b) => a - b);
}
/** Every failure for one template at one size, in words. */
function closureFailures(m, L, W, H) {
  const out = [];
  const mats = panelMatrices(m, 1, false, THREE);
  const meet = (a, b, what) => { const d = gap(m, mats, a, b); if (d > TOL) out.push(`${what}: ${d.toFixed(2)} mm apart`); };
  const size = (ids, want, what) => { const e = extent(m, mats, ids), x = [...want].sort((a, b) => a - b); if (e.some((v, i) => Math.abs(v - x[i]) > TOL)) out.push(`${what}: ${e.map((v) => v.toFixed(1)).join(' x ')}`); };
  const t = m.template;
  if (t === 'tuckEnd' || t === 'bag') {
    meet(['back', 3], ['side2', 1], 'back meets the right side');
    meet(['bottom', 0], ['back', 0], 'the bottom reaches the back');
    if (t === 'tuckEnd') meet(['lid', 2], ['front', 2], 'the lid reaches the front');
    size(['front', 'back', 'side1', 'side2'], [L, W, H], 'body');
  }
  if (t === 'mailer' || t === 'tray') {
    meet(['left', 2], ['front', 3], 'left wall meets the front wall');
    meet(['right', 2], ['front', 1], 'right wall meets the front wall');
    meet(['left', 0], ['back', 3], 'left wall meets the back wall');
    if (t === 'mailer') meet(['lid', 0], ['front', 2], 'the lid reaches the front wall');
    size(['base', 'front', 'back', 'left', 'right'], [L, W, H], 'tray');
  }
  if (t === 'pouch' || t === 'sachet' || t === 'pillow') {
    meet(['back', 1], ['front', 3], 'the back seals onto the front');
    size(['front'], [L, 0, H], 'face');
  }
  if (t === 'scoop') {
    // the walls lean, so they meet at less than a right angle: the last wall must still land on the first
    const n = m.panels.find((q) => q.id === 'back').poly.length;
    meet(['back', n - 1], ['side2', 1], 'the back meets the right side');
    meet(['bottom', 2], ['back', 0], 'the bottom reaches the back');
    size(['side1', 'side2'], [L, W, H], 'the opening and the height');
    // standing on its bottom: the four bottom corners are level
    const ys = ['front', 'back'].flatMap((id) => [0, 1].map((i) => foldPoint(mats, id, m.panels.find((q) => q.id === id).poly[i], THREE)[1]));
    if (Math.max(...ys) - Math.min(...ys) > TOL) out.push('the bottom is not level');
  }
  // the cut lines join into closed outlines: every end point is shared by an even number of lines
  const ends = new Map(), pt = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  for (const [x1, y1, x2, y2] of m.cut) for (const q of [pt(x1, y1), pt(x2, y2)]) ends.set(q, (ends.get(q) || 0) + 1);
  if ([...ends.values()].some((v) => v % 2)) out.push('the cut lines leave loose ends');
  // laid flat, every panel lies in the sheet
  const flat = panelMatrices(m, 0, false, THREE);
  if (m.panels.some((q) => q.poly.some((p) => { const f = foldPoint(flat, q.id, p, THREE); return Math.abs(f[0] - p[0]) > 1e-6 || Math.abs(f[1] - p[1]) > 1e-6 || Math.abs(f[2] + q.inset) > 1e-6; }))) out.push('not flat when laid flat');
  return out;
}

// sizes in mm: the study's samples plus small, large and lopsided ones
const SIZES = {
  tuckEnd: [[50, 20, 90], [70, 30, 120], [90, 40, 150], [30, 30, 30], [200, 60, 80], [40, 100, 250]],
  mailer: [[300, 300, 40], [110, 110, 80], [200, 200, 100], [350, 250, 45], [80, 120, 30]],
  tray: [[200, 130, 50], [150, 100, 50], [250, 160, 60], [90, 90, 90]],
  bag: [[260, 120, 320], [180, 80, 220], [320, 170, 280], [120, 70, 300], [400, 200, 320]],
  pouch: [[160, 80, 240], [120, 70, 200], [200, 100, 300]],
  sachet: [[80, 0, 120], [140, 0, 200], [60, 0, 90]],
  pillow: [[120, 40, 180], [80, 30, 120], [200, 60, 260]],
  scoop: [[120, 50, 130], [90, 40, 110], [160, 70, 150], [100, 100, 60]],
};

test('every template closes at every size, and lays flat with one closed cut outline', () => {
  let checked = 0;
  assert.deepEqual(Object.keys(SIZES).sort(), Object.keys(TEMPLATES).sort(), 'every template is checked');
  for (const [t, list] of Object.entries(SIZES)) {
    for (const [L, W, H] of list) {
      const m = dieline(t, { L, W, H });
      assert.deepEqual(closureFailures(m, L, W, H), [], `${t} ${L} x ${W} x ${H}`);
      checked++;
    }
  }
  assert.ok(checked >= 33);
});

test('the scoop check catches a wall folded square (its walls lean, so 90 degrees does not close)', () => {
  const m = dieline('scoop', { L: 120, W: 50, H: 130 });
  for (const p of m.panels) if (p.role === 'face' && p.parent && p.id !== 'bottom') p.fold = 90;
  assert.ok(closureFailures(m, 120, 50, 130).some((f) => f.startsWith('the back meets the right side')));
});

test('the closure check catches a broken package (proof that it can fail)', () => {
  // a lid 6 mm short no longer reaches the front wall
  const m = dieline('mailer', { L: 300, W: 300, H: 40 });
  const lid = m.panels.find((p) => p.id === 'lid');
  lid.poly = lid.poly.map(([x, y]) => [x, y > -40 - 1 ? y : y + 6]);
  assert.ok(closureFailures(m, 300, 300, 40).some((f) => f.startsWith('the lid reaches the front wall')));
  // one fold turned the wrong way: the side swings out instead of in
  const c = dieline('tuckEnd', { L: 70, W: 30, H: 120 });
  c.panels.find((p) => p.id === 'side2').sign *= -1;
  assert.ok(closureFailures(c, 70, 30, 120).length > 0);
});
