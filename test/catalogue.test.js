// The packaging catalogue: families, per-product sizes, minimum orders set by the
// packaging team, quote bundles checked against those minimums, routing of
// packaging enquiries, and the boot-time merge that brings new catalogue
// products to a live data folder. Runs the real app on a temporary DATA_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-cat-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
process.env.INQUIRY_RATE_PER_MIN = '1000';

const { app } = await import('../server.js');
const { normalise, checkBundle, minimumFor, units, mergeSeedCatalogue, FAMILIES } = await import('../lib/packaging.js');

let server, base;
const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); });

const req = (method, p, { token, body } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(admin, { name, email, role }) {
  const password = 'member-password-123';
  const r = await req('POST', '/api/admin/team', { token: admin, body: { member: { name, email, role, password } } });
  assert.equal(r.status, 200, JSON.stringify(await json(r.clone())));
  return (await (await req('POST', '/api/team/login', { body: { email, password } })).json()).token;
}
const inquiries = () => JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8'));
const send = (extra) => req('POST', '/api/inquiry', { body: { name: 'Test Buyer', email: 'buyer@example.com', message: 'A price for these, please.', ...extra } });

test('older records read as bags with the studio sizes; minimum parsed from the old text', () => {
  const p = normalise({ id: 'x', name: 'Old bag', moq: '5,000 bags' });
  assert.equal(p.family, 'bags');
  assert.deepEqual(p.sizes.map((s) => s.id), ['small', 'medium', 'large']);
  assert.equal(p.minOrder, 5000);
  // a product saved with an empty size list keeps it empty (no sizes offered)
  assert.deepEqual(normalise({ id: 'y', name: 'Box', family: 'food', sizes: [] }).sizes, []);
  // unknown family falls back, bad numbers are dropped
  assert.equal(normalise({ id: 'z', name: 'Z', family: 'rockets' }).family, 'bags');
  // print colours: blank is "not set", 0 is "plain" (they must not be confused)
  for (const blank of [null, undefined, '']) assert.equal(normalise({ id: 'c', name: 'C', printColours: blank }).printColours, null, `printColours ${blank}`);
  assert.equal(normalise({ id: 'c', name: 'C', printColours: 0 }).printColours, 0);
  assert.equal(normalise({ id: 'c', name: 'C', printColours: '3' }).printColours, 3);
  assert.equal(normalise({ id: 'c', name: 'C', printColours: 9 }).printColours, null);
  assert.equal(units('12,000'), 12000);
  for (const bad of ['', '0', '-5', '1.5', 'many', 20_000_000]) assert.equal(units(bad), null, `units(${bad})`);
});

test('a size minimum wins over the product minimum', () => {
  const p = normalise({ id: 'a', name: 'A', minOrder: 1000, sizes: [{ id: 's', label: 'Small', minOrder: 5000 }, { id: 'm', label: 'Medium' }] });
  assert.equal(minimumFor(p, 's'), 5000);
  assert.equal(minimumFor(p, 'm'), 1000);
});

test('bundle check: below minimum, unknown product, duplicate line, missing size, hidden product', () => {
  const cat = [
    normalise({ id: 'a', name: 'Pizza boxes', family: 'food', minOrder: 2000, sizes: [{ id: 'l', label: 'Large' }] }),
    normalise({ id: 'b', name: 'Medical packets', family: 'medical', sizes: [] }),
    normalise({ id: 'h', name: 'Hidden', family: 'food', site: false, sizes: [] }),
  ];
  assert.equal(checkBundle([{ productId: 'a', sizeId: 'l', qty: 1999 }], cat).code, 'below_minimum');
  assert.match(checkBundle([{ productId: 'a', sizeId: 'l', qty: 1999 }], cat).error, /minimum order for Pizza boxes, Large is 2,000/);
  assert.ok(checkBundle([{ productId: 'zzz', qty: 5 }], cat).error);
  assert.ok(checkBundle([{ productId: 'h', qty: 5 }], cat).error, 'products hidden from the site cannot be bundled');
  assert.match(checkBundle([{ productId: 'a', qty: 5000 }], cat).error, /Choose a size/);
  assert.match(checkBundle([{ productId: 'b', qty: 10 }, { productId: 'b', qty: 20 }], cat).error, /twice/);
  assert.ok(checkBundle([], cat).error);
  assert.ok(checkBundle('nope', cat).error);
  const ok = checkBundle([{ productId: 'a', sizeId: 'l', qty: '2,000', colours: 2 }, { productId: 'b', qty: 300, colours: null }], cat);
  assert.deepEqual(ok.items.map((i) => [i.name, i.size, i.qty, i.colours]), [['Pizza boxes', 'Large', 2000, 2], ['Medical packets', '', 300, null]], 'colours null stays "to discuss", not plain');
  assert.equal(checkBundle([{ productId: 'b', qty: 300, colours: 0 }], cat).items[0].colours, 0, 'plain is kept');
});

test('the catalogue API groups products and gives the new fields', async () => {
  const list = await json(await req('GET', '/api/packaging-products'));
  const fams = new Set(list.map((p) => p.family));
  for (const f of FAMILIES) assert.ok(fams.has(f.id), `family ${f.id} has products`);
  for (const id of ['pk_sos', 'pk_vbottom', 'pk_bakery', 'pk_pizza', 'pk_burger', 'pk_medical', 'pk_foil']) assert.ok(list.some((p) => p.id === id), id);
  const flat = list.find((p) => p.id === 'pk_flat');
  assert.deepEqual(flat.sizes.map((s) => s.id), ['small', 'medium', 'large'], 'the existing bags keep their three sizes');
  assert.ok('minOrder' in flat && 'printColours' in flat);
});

test('the packaging team sets minimums; the agriculture team cannot', async () => {
  const admin = await adminToken();
  const pack = await member(admin, { name: 'Dawit', email: 'dawit.cat@example.com', role: 'pack' });
  const agri = await member(admin, { name: 'Hana', email: 'hana.cat@example.com', role: 'agri' });
  const url = '/api/team/packaging-products/pk_pizza/minimums';
  assert.equal((await req('POST', url, { body: { minOrder: 10 } })).status, 401);
  assert.equal((await req('POST', url, { token: agri, body: { minOrder: 10 } })).status, 403);
  assert.equal((await req('POST', url, { token: pack, body: { minOrder: 'lots' } })).status, 400);
  const r = await req('POST', url, { token: pack, body: { minOrder: '2,000', sizes: { large: 5000 } } });
  const data = await json(r);
  assert.equal(r.status, 200, JSON.stringify(data));
  assert.equal(data.product.minOrder, 2000);
  assert.equal(data.product.sizes.find((s) => s.id === 'large').minOrder, 5000);
  assert.equal(data.product.sizes.find((s) => s.id === 'small').minOrder, null);
  // only the minimums changed
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'packaging-products.json'), 'utf8')).find((p) => p.id === 'pk_pizza');
  assert.equal(stored.name, 'Pizza boxes');
  assert.equal(stored.description.startsWith('Folding pizza boxes'), true);
  // the administrator can clear it again
  const c = await json(await req('POST', url, { token: admin, body: { minOrder: '' } }));
  assert.equal(c.product.minOrder, null);
  await req('POST', url, { token: pack, body: { minOrder: 2000 } });
});

test('a bundle under the minimum is refused by the server, and nothing is saved', async () => {
  const before = fs.existsSync(path.join(tmp, 'inquiries.json')) ? inquiries().length : 0;
  const r = await send({ product: 'Packaging', line: 'pack', bundle: [{ productId: 'pk_pizza', sizeId: 'small', qty: 500 }] });
  const data = await json(r);
  assert.equal(r.status, 400);
  assert.equal(data.code, 'below_minimum');
  assert.equal(data.min, 2000);
  const after = fs.existsSync(path.join(tmp, 'inquiries.json')) ? inquiries().length : 0;
  assert.equal(after, before);
});

test('a valid bundle is saved on the lead and routed to the packaging team', async () => {
  const r = await send({ product: 'Packaging', line: 'pack', bundle: JSON.stringify([
    { productId: 'pk_pizza', sizeId: 'large', qty: 6000, colours: 2 },
    { productId: 'pk_foil', sizeId: 'medium', qty: 1500 },
  ]) });
  assert.ok([200, 500].includes(r.status), String(r.status)); // 500 = no mail account in tests; the lead is still saved
  const lead = inquiries()[0];
  assert.equal(lead.line, 'pack');
  assert.deepEqual(lead.bundle.map((b) => [b.productId, b.size, b.qty]), [['pk_pizza', 'Large', 6000], ['pk_foil', 'Medium', 1500]]);
});

test('a saved request is reported as received even when no mail can be sent', async () => {
  const r = await send({ product: 'Pizza boxes', name: 'No Mail Buyer' });
  const data = await json(r);
  assert.equal(r.status, 200, JSON.stringify(data));
  assert.equal(data.saved, true);
  assert.equal(data.emailed, false);
  const lead = inquiries()[0];
  assert.equal(lead.name, 'No Mail Buyer');
  assert.equal(lead.emailed, false, 'the lead stays flagged as not emailed for the admin');
});

test('packaging products without "bag" in the name still go to the packaging team', async () => {
  for (const product of ['Pizza boxes', 'Aluminium foil bags', 'Medical packets']) {
    await send({ product });
    assert.equal(inquiries()[0].line, 'pack', product);
  }
  await send({ product: 'Sesame seeds' });
  assert.equal(inquiries()[0].line, 'agri');
});

test('boot merge: new catalogue products reach a live folder once; deleted ones stay deleted', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-live-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-repo-'));
  const io = {
    readJsonFile: (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } },
    writeJsonFile: (f, v) => { fs.writeFileSync(f, JSON.stringify(v)); return true; },
  };
  const write = (dir, list) => fs.writeFileSync(path.join(dir, 'packaging-products.json'), JSON.stringify(list));
  const ids = () => io.readJsonFile(path.join(live, 'packaging-products.json'), []).map((p) => p.id);
  // a live site from before: the admin deleted the twisted bag and renamed the flat one
  write(live, [{ id: 'pk_flat', name: 'Renamed by admin' }, { id: 'pk_wide', name: 'Wide' }]);
  write(repo, [{ id: 'pk_flat', name: 'Flat' }, { id: 'pk_wide', name: 'Wide' }, { id: 'pk_twisted', name: 'Twisted' }, { id: 'pk_pizza', name: 'Pizza boxes' }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), ['pk_pizza']);
  assert.deepEqual(ids(), ['pk_flat', 'pk_wide', 'pk_pizza'], 'the deleted first-seed bag is not brought back');
  assert.equal(io.readJsonFile(path.join(live, 'packaging-products.json'))[0].name, 'Renamed by admin', 'existing products are untouched');
  // the admin deletes the new one: a later boot does not re-add it
  write(live, [{ id: 'pk_flat', name: 'Renamed by admin' }, { id: 'pk_wide', name: 'Wide' }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), []);
  assert.deepEqual(ids(), ['pk_flat', 'pk_wide']);
  // a product added to the repo later still arrives
  write(repo, [{ id: 'pk_flat' }, { id: 'pk_pizza' }, { id: 'pk_foil', name: 'Foil' }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), ['pk_foil']);

  // a photo added to a repo product reaches a live product without one, once;
  // everything else about the live product stays as the admin left it
  const quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  write(live, [{ id: 'pk_twisted', name: 'Renamed twisted', image: null, minOrder: 5000 }]);
  write(repo, [{ id: 'pk_twisted', name: 'Twisted', image: '/images/packaging/products/t.webp', width: 1000, height: 1500, quad, safeTop: 0.04 }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), ['pk_twisted (photo)']);
  const t = io.readJsonFile(path.join(live, 'packaging-products.json'))[0];
  assert.equal(t.image, '/images/packaging/products/t.webp');
  assert.deepEqual(t.quad, quad);
  assert.equal(t.name, 'Renamed twisted', 'the name the admin chose is kept');
  assert.equal(t.minOrder, 5000, 'the minimum the team set is kept');
  // the admin removes the photo: it is not put back
  write(live, [{ ...t, image: null, quad: null }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), []);
  assert.equal(io.readJsonFile(path.join(live, 'packaging-products.json'))[0].image, null);
  // a shipped stock photo is upgraded to its new version, with its new print corners
  const q2 = [[0.2, 0.3], [0.8, 0.3], [0.8, 0.8], [0.2, 0.8]];
  write(live, [{ id: 'pk_flat', name: 'Flat', image: '/images/packaging/products/flat.webp', width: 1400, height: 1983, quad }]);
  write(repo, [{ id: 'pk_flat', image: '/images/packaging/products/flat-v2.webp', width: 1200, height: 1500, quad: q2 }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), ['pk_flat (photo)']);
  const f2 = io.readJsonFile(path.join(live, 'packaging-products.json'))[0];
  assert.deepEqual([f2.image, f2.width, f2.height, f2.quad], ['/images/packaging/products/flat-v2.webp', 1200, 1500, q2]);
  // a live product that has its own photo is never touched
  write(live, [{ id: 'pk_twisted', image: '/uploads/packaging/own.webp' }]);
  write(repo, [{ id: 'pk_twisted', image: '/images/packaging/products/new.webp', quad }]);
  assert.deepEqual(mergeSeedCatalogue(live, repo, io), []);
  assert.equal(io.readJsonFile(path.join(live, 'packaging-products.json'))[0].image, '/uploads/packaging/own.webp');
});
