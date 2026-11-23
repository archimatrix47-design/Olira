// A marketing team's insights: each team sees its own line's pages and products
// only; the manager may look at either line; the admin and the public cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tally } from '../lib/analytics.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-insights-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
const { app } = await import('../server.js');

let server, base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server?.close());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const req = (method, p, { token, body } = {}) => fetch(base + p, { method, headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const admin = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(role, email) {
  const a = await admin();
  await req('POST', '/api/admin/team', { token: a, body: { member: { name: `${role} person`, email, role, password: 'member-password-12' } } });
  return (await (await req('POST', '/api/team/login', { body: { email, password: 'member-password-12' } })).json()).token;
}

test('each team sees its own line; the manager chooses; nobody else gets in', async () => {
  // visits: three to agriculture pages, two to packaging, one home
  for (const p of ['/agriculture/', '/agriculture/', '/agriculture/premium-spices/', '/packaging/', '/packaging/pizza-boxes/', '/']) {
    assert.equal((await req('POST', '/api/track', { body: { path: p } })).status, 204);
  }
  await req('POST', '/api/track', { body: { event: 'product', product: 'Premium Spices' } });
  await req('POST', '/api/track', { body: { event: 'product', product: 'Pizza boxes' } });
  const agri = await member('agri', 'agri.ins@example.com'), pack = await member('pack', 'pack.ins@example.com'), mgr = await member('manager', 'mgr.ins@example.com');

  assert.equal((await req('GET', '/api/team/insights')).status, 401);
  assert.equal((await req('GET', '/api/team/insights', { token: await admin() })).status, 403, 'the admin runs the site, not the sales');

  const a = await (await req('GET', '/api/team/insights?line=pack', { token: agri })).json();
  assert.equal(a.line, 'agri', 'a team cannot ask for the other line');
  assert.equal(a.views, 3, 'agriculture pages only');
  assert.ok(a.pages.every((p) => p.path.startsWith('/agriculture')));
  assert.ok(a.products.some((p) => p.name === 'Premium Spices' && p.opens === 1));
  assert.ok(!a.products.some((p) => p.name === 'Pizza boxes'), 'the other line\'s products are not listed');
  assert.equal(a.series.length, 30);

  const k = await (await req('GET', '/api/team/insights', { token: pack })).json();
  assert.equal(k.line, 'pack');
  assert.equal(k.views, 2);
  assert.ok(k.products.some((p) => p.name === 'Pizza boxes' && p.opens === 1));

  const m = await (await req('GET', '/api/team/insights?line=pack', { token: mgr })).json();
  assert.equal(m.line, 'pack', 'the manager chooses the line');
  assert.ok(Array.isArray(m.site.channels) && m.site.devices, 'site-wide sources come along, labelled as such');
});

test('counts under names a visitor sent: inherited names go to "other", and the names are capped', () => {
  const o = {};
  for (const k of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) tally(o, k);
  assert.deepEqual(Object.keys(o), ['other']);
  assert.equal(o.other, 4);
  assert.equal(Object.getPrototypeOf(o), Object.prototype, 'the prototype is untouched');
  const capped = {};
  for (let i = 0; i < 10; i++) tally(capped, `made-up ${i}`, 1, 3);
  assert.equal(Object.keys(capped).length, 4, 'three names, then "other"');
  assert.equal(capped.other, 7);
  tally(capped, 'made-up 0', 2, 3);
  assert.equal(capped['made-up 0'], 3, 'a name already counted keeps counting past the cap');
});

test('a ping naming "toString" or "constructor" leaves the reports as numbers', async () => {
  await req('POST', '/api/track', { body: { event: 'product', product: 'toString' } });
  await req('POST', '/api/track', { body: { event: 'product', product: 'constructor' } });
  await req('POST', '/api/track', { body: { path: '/', referrer: 'http://constructor/' } });
  const mgr = await member('manager', 'mgr.proto@example.com');
  const r = await req('GET', '/api/analytics?days=30', { token: mgr });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!/function|\[native code\]|NaN/.test(text), 'no function text or NaN in the report');
});
