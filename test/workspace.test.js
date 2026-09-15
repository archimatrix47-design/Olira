// Team workspaces and packaging products (lib/workspace.js, lib/packaging.js).
// Runs the real app on a temporary DATA_DIR, like api.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

// server.js loads .env with dotenv, which fills in any variable that is not
// already present. Keys set to '' count as present, so the real mail account,
// origins and environment in .env can never leak into a test run.
for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-ws-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
process.env.TEAM_REPLY_RATE_PER_MIN = '1000';

const { app } = await import('../server.js');
const { sniffFile } = await import('../lib/workspace.js');
const { validQuad, backgroundOf, sameShotScore } = await import('../lib/packaging.js');

let server, base;
const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); });

const req = (method, p, { token, body, form } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: form || (body !== undefined ? JSON.stringify(body) : undefined),
});
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function adminToken() {
  const r = await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } });
  return (await r.json()).token;
}
async function member(admin, { name, email, role, password = 'member-password-123' }) {
  const r = await req('POST', '/api/admin/team', { token: admin, body: { member: { name, email, role, password } } });
  const data = await json(r);
  assert.equal(r.status, 200, JSON.stringify(data));
  const m = data.member;
  const l = await req('POST', '/api/team/login', { body: { email, password } });
  assert.equal(l.status, 200);
  return { ...m, token: (await l.json()).token, password };
}
const png = (w, h, bg, box) => sharp({ create: { width: w, height: h, channels: 3, background: bg } })
  .composite(box ? [{ input: { create: { width: box.w, height: box.h, channels: 3, background: box.color } }, left: box.x, top: box.y }] : [])
  .png().toBuffer();
async function lead(product, extra = {}) {
  const r = await req('POST', '/api/inquiry', { body: { name: 'Test Buyer', email: 'buyer@example.com', company: 'Buyer Co', message: 'We would like a price for your product, please.', product, ...extra } });
  assert.ok([200, 500].includes(r.status)); // 500 = email not configured, the lead is still saved
  const list = JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8'));
  return list[0];
}

test('file sniffing trusts bytes, not names (self-test of the matcher)', async () => {
  assert.equal(sniffFile(await png(20, 20, '#fff')), 'png');
  assert.equal(sniffFile(Buffer.from('%PDF-1.7\n1 0 obj')), 'pdf');
  assert.equal(sniffFile(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffFile(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniffFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00')), null);
});

test('team tokens cannot use admin endpoints or see phone numbers', async () => {
  const admin = await adminToken();
  const a = await member(admin, { name: 'Abebe', email: 'abebe@example.com', role: 'agri' });
  assert.equal((await req('GET', '/api/admin/inquiries', { token: a.token })).status, 403);
  assert.equal((await req('GET', '/api/admin/verify', { token: a.token })).status, 401);
  assert.equal((await req('POST', '/api/products', { token: a.token, body: { product: { name: 'X', description: 'Y' } } })).status, 403);
  const cd = await json(await req('GET', '/api/contact-details', { token: a.token }));
  assert.deepEqual(cd.phones, [], 'a team token must not unlock phone numbers');
  assert.equal((await req('GET', '/api/admin/team', { token: a.token })).status, 403);
  const me = await json(await req('GET', '/api/team/me', { token: a.token }));
  assert.equal(me.user.role, 'agri');
});

test('each team sees only its own line, and accepting is first come first served', async () => {
  const admin = await adminToken();
  const agri1 = await member(admin, { name: 'Agri One', email: 'agri1@example.com', role: 'agri' });
  const agri2 = await member(admin, { name: 'Agri Two', email: 'agri2@example.com', role: 'agri' });
  const pack = await member(admin, { name: 'Pack One', email: 'pack1@example.com', role: 'pack' });
  const sesame = await lead('Humera sesame');
  const bags = await lead('Kraft paper bags');

  const agriList = await json(await req('GET', '/api/team/inquiries?line=pack', { token: agri1.token }));
  assert.ok(agriList.inquiries.every((i) => i.line === 'agri'), 'agri member forced to agri line');
  assert.ok(agriList.inquiries.some((i) => i.id === sesame.id));
  assert.ok(!agriList.inquiries.some((i) => i.id === bags.id));
  assert.equal((await req('POST', `/api/team/inquiries/${bags.id}`, { token: agri1.token, body: { status: 'read' } })).status, 404);
  assert.equal((await req('POST', `/api/team/inquiries/${sesame.id}`, { token: pack.token, body: { assign: 'me' } })).status, 404);

  const acc = await json(await req('POST', `/api/team/inquiries/${sesame.id}`, { token: agri1.token, body: { assign: 'me' } }));
  assert.equal(acc.inquiry.assignee.id, agri1.id);
  assert.equal(acc.inquiry.status, 'read');
  assert.equal(acc.inquiry.history.at(-1).by.id, agri1.id);
  const clash = await req('POST', `/api/team/inquiries/${sesame.id}`, { token: agri2.token, body: { assign: 'me' } });
  assert.equal(clash.status, 409);
  assert.equal((await req('POST', `/api/team/inquiries/${sesame.id}`, { token: agri2.token, body: { assign: 'none' } })).status, 403);

  const logged = await json(await req('POST', `/api/team/inquiries/${sesame.id}/activity`, { token: agri1.token, body: { type: 'call', text: 'Called, wants 50 MT to Jebel Ali' } }));
  assert.equal(logged.inquiry.status, 'contacted');
  assert.equal(logged.inquiry.activity.at(-1).type, 'call');

  const bad = await req('POST', `/api/team/inquiries/${sesame.id}/quote`, { token: agri1.token, body: { quote: { items: [{ item: 'Sesame', qty: 0, price: 10 }] } } });
  assert.equal(bad.status, 400);
  const q = await json(await req('POST', `/api/team/inquiries/${sesame.id}/quote`, { token: agri1.token, body: { quote: { currency: 'USD', items: [{ item: 'Humera sesame', qty: 50, unit: 'MT', price: 1850 }], terms: { incoterm: 'FOB Djibouti' } } } }));
  assert.equal(q.inquiry.status, 'quoted');
  assert.equal(q.inquiry.quote.total, 92500);
  assert.match(q.inquiry.quote.number, /^Q-\d{8}-/);

  // no SMTP in tests: the reply is refused and nothing is recorded as sent
  const reply = await req('POST', `/api/team/inquiries/${sesame.id}/reply`, { token: agri1.token, body: { subject: 'Your offer', body: 'Dear buyer, please find our offer.' } });
  assert.equal(reply.status, 503);
  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8')).find((i) => i.id === sesame.id);
  assert.ok(!after.activity.some((a) => a.type === 'reply'));
});

test('switching an account off or resetting its password ends its sessions', async () => {
  const admin = await adminToken();
  const m = await member(admin, { name: 'Temp', email: 'temp@example.com', role: 'pack' });
  assert.equal((await req('GET', '/api/team/me', { token: m.token })).status, 200);
  await req('POST', '/api/admin/team', { token: admin, body: { member: { id: m.id, name: 'Temp', email: 'temp@example.com', role: 'pack', active: true, password: 'a-brand-new-password' } } });
  assert.equal((await req('GET', '/api/team/me', { token: m.token })).status, 401, 'old token must die after a reset');
  const l = await json(await req('POST', '/api/team/login', { body: { email: 'temp@example.com', password: 'a-brand-new-password' } }));
  assert.ok(l.token);
  await req('POST', '/api/admin/team', { token: admin, body: { member: { id: m.id, name: 'Temp', email: 'temp@example.com', role: 'pack', active: false } } });
  assert.equal((await req('GET', '/api/team/me', { token: l.token })).status, 401);
  assert.equal((await req('POST', '/api/team/login', { body: { email: 'temp@example.com', password: 'a-brand-new-password' } })).status, 401);
  assert.equal((await req('POST', '/api/team/login', { body: { email: 'nobody@example.com', password: 'whatever-password' } })).status, 401);
});

test('packaging quote requests carry files only with consent, stored privately', async () => {
  const admin = await adminToken();
  const pack = await member(admin, { name: 'Pack Files', email: 'packfiles@example.com', role: 'pack' });
  const agri = await member(admin, { name: 'Agri Files', email: 'agrifiles@example.com', role: 'agri' });
  const logo = await png(64, 64, '#186078');
  const form = (fields, files) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); for (const [k, buf, name, type] of files) fd.append(k, new Blob([buf], { type }), name); return fd; };
  const fields = { name: 'Bag Buyer', email: 'bags@example.com', message: 'Quote for 20000 medium bags please.', product: 'Kraft paper bags' };

  const noConsent = await req('POST', '/api/inquiry', { form: form(fields, [['files', logo, 'logo.png', 'image/png']]) });
  assert.equal(noConsent.status, 400);
  const wrongLine = await req('POST', '/api/inquiry', { form: form({ ...fields, product: 'Humera sesame', consent: '1' }, [['files', logo, 'logo.png', 'image/png']]) });
  assert.equal(wrongLine.status, 400);
  const fake = await req('POST', '/api/inquiry', { form: form({ ...fields, consent: '1' }, [['files', Buffer.from('<html><script>alert(1)</script>'), 'logo.png', 'image/png']]) });
  assert.equal(fake.status, 400);
  assert.equal((await fake.json()).saved, true, 'the enquiry is kept even when its files are refused');

  const design = JSON.stringify({ template: 'pk_flat', size: 'large', ink: 'red', text1: 'CAFE', scale: 9, hasLogo: true, evil: '<script>' });
  const ok = await req('POST', '/api/inquiry', { form: form({ ...fields, consent: '1', design }, [['files', logo, 'artwork.png', 'image/png'], ['logo', logo, 'mylogo.png', 'image/png'], ['mockup', logo, 'studio.png', 'image/png']]) });
  assert.ok([200, 500].includes(ok.status));
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8'))[0];
  assert.equal(rec.files.length, 3);
  assert.deepEqual(rec.files.map((f) => f.kind).sort(), ['artwork', 'logo', 'mockup']);
  assert.equal(rec.design.scale, 1.4, 'design values are clamped');
  assert.equal(rec.design.evil, undefined, 'unknown design keys are dropped');
  const f = rec.files[0];
  assert.ok(!fs.existsSync(path.join(process.env.UPLOADS_DIR, f.stored)), 'client files are not in the public uploads folder');

  const dl = await req('GET', `/api/team/inquiries/${rec.id}/files/${f.id}`, { token: pack.token });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment;/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await dl.arrayBuffer()).length, logo.length);
  assert.equal((await req('GET', `/api/team/inquiries/${rec.id}/files/${f.id}`, { token: agri.token })).status, 404);
  assert.equal((await req('GET', `/api/team/inquiries/${rec.id}/files/${f.id}`)).status, 401);
  assert.equal((await req('DELETE', `/api/team/inquiries/${rec.id}/files/${f.id}`, { token: pack.token })).status, 403, 'client files are kept');

  const up = new FormData(); up.append('file', new Blob([logo], { type: 'image/png' }), 'mockup.png'); up.append('kind', 'mockup');
  const added = await json(await req('POST', `/api/team/inquiries/${rec.id}/files`, { token: pack.token, form: up }));
  const mine = added.inquiry.files.find((x) => x.source === 'team');
  assert.equal(mine.kind, 'mockup');
  // working on an unaccepted New enquiry takes it over and moves it out of New
  assert.equal(added.inquiry.assignee.id, pack.id);
  assert.equal(added.inquiry.status, 'read', 'owned enquiries never stay in New');
  assert.equal((await req('DELETE', `/api/team/inquiries/${rec.id}/files/${mine.id}`, { token: pack.token })).status, 200);

  const dir = path.join(tmp, 'client-files', rec.id);
  assert.ok(fs.existsSync(dir));
  assert.equal((await req('DELETE', `/api/admin/inquiries/${rec.id}`, { token: admin })).status, 200);
  assert.ok(!fs.existsSync(dir), 'deleting the enquiry deletes its files');
});

test('print corners must form a proper four-sided shape (self-test)', () => {
  assert.ok(validQuad([[0.1, 0.2], [0.9, 0.2], [0.9, 0.9], [0.1, 0.9]]));
  assert.ok(!validQuad([[0.1, 0.2], [0.9, 0.9], [0.9, 0.2], [0.1, 0.9]]), 'crossed corners');
  assert.ok(!validQuad([[0.1, 0.2], [0.12, 0.2], [0.12, 0.22], [0.1, 0.22]]), 'too small');
  assert.ok(!validQuad([[0.1, 0.2], [1.4, 0.2], [0.9, 0.9], [0.1, 0.9]]), 'outside the photo');
});

test('photo checks: white background, and a dark photo must be the same shot', async () => {
  const bagOnWhite = await png(400, 560, '#ffffff', { x: 80, y: 140, w: 240, h: 360, color: '#c9a27a' });
  const bagOnBlack = await png(400, 560, '#050505', { x: 80, y: 140, w: 240, h: 360, color: '#c9a27a' });
  const otherOnBlack = await png(400, 560, '#050505', { x: 20, y: 30, w: 120, h: 140, color: '#c9a27a' });
  assert.equal((await backgroundOf(bagOnWhite)).tone, 'light');
  assert.equal((await backgroundOf(bagOnBlack)).tone, 'dark');
  const same = await sameShotScore(bagOnWhite, bagOnBlack), other = await sameShotScore(bagOnWhite, otherOnBlack);
  assert.ok(same > 0.6, `same shot scores ${same}`);
  assert.ok(other < 0.6, `different shot scores ${other}`);

  const admin = await adminToken();
  const up = (buf, variant, extra = {}) => { const fd = new FormData(); fd.append('image', new Blob([buf], { type: 'image/png' }), 'bag.png'); fd.append('variant', variant); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return req('POST', '/api/admin/packaging-products/image', { token: admin, form: fd }); };
  const light = await json(await up(bagOnWhite, 'light'));
  assert.equal(light.background, 'light');
  assert.equal(light.warning, null);
  const grey = await json(await up(await png(400, 560, '#6b8cc2', { x: 80, y: 140, w: 240, h: 360, color: '#c9a27a' }), 'light'));
  assert.ok(grey.warning, 'a non-white background is flagged');
  assert.equal((await up(bagOnBlack, 'dark', { light: light.path })).status, 200);
  assert.equal((await up(otherOnBlack, 'dark', { light: light.path })).status, 422);
  assert.equal((await up(await png(560, 400, '#050505', { x: 80, y: 100, w: 240, h: 200, color: '#c9a27a' }), 'dark', { light: light.path })).status, 422, 'different proportions');

  const bad = await req('POST', '/api/admin/packaging-products', { token: admin, body: { product: { name: 'Bad', description: 'x', image: '/uploads/packaging/../../server.js', quad: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] } } });
  assert.equal(bad.status, 400);
  const created = await json(await req('POST', '/api/admin/packaging-products', { token: admin, body: { product: { name: 'Test bags', description: 'For tests', image: light.path, width: 400, height: 560, quad: [[0.2, 0.25], [0.8, 0.25], [0.8, 0.89], [0.2, 0.89]], site: false } } }));
  assert.ok(created.product.id);
  const publicList = await json(await req('GET', '/api/packaging-products'));
  assert.ok(!publicList.some((p) => p.id === created.product.id), 'hidden products stay off the public list');
  const all = await json(await req('GET', '/api/packaging-products?scope=all', { token: admin }));
  assert.ok(all.some((p) => p.id === created.product.id));
  assert.equal((await req('GET', '/api/packaging-products?scope=all')).status, 401);
});
