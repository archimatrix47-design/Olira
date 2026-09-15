// API test suite (Node built-in runner: `node --test`).
//
// Every test imports the real Express app (F6 made this possible) and drives it
// over a real socket. Several tests are direct regressions for bugs that caused
// production outages during launch — labelled REGRESSION.
//
// Env is set BEFORE importing server.js because the app reads it at module load.
// NODE_ENV is left unset (neither 'production' nor 'development') so admin login
// stays enabled and the production CORS path is exercised.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
// Config files normally live next to server.js; keep test writes in the temp dir.
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000'; // headroom: the suite makes many logins
process.env.GENERAL_RATE_PER_MIN = '1000'; // headroom: enquiry and settings posts share this bucket
delete process.env.CORS_ORIGINS;

const { app } = await import('../server.js');

let server;
let base;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { if (server) server.close(); });

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA, ...headers },
    body: JSON.stringify(body)
  });
const get = (p, headers = {}) => fetch(base + p, { headers: { 'User-Agent': BROWSER_UA, ...headers } });

// ---- Health (F5) ----
test('GET /api/health returns 200 with checks', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.status, 'ok');
  assert.equal(typeof b.checks.dataDirWritable, 'boolean');
  assert.ok(Array.isArray(b.failing));
});

// ---- Content APIs ----
test('GET /api/products returns an array', async () => {
  const r = await get('/api/products');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));
});

// ---- Analytics tracking ----
test('POST /api/track pageview returns 204', async () => {
  const r = await post('/api/track', { path: '/', referrer: '' });
  assert.equal(r.status, 204);
});

test('POST /api/track product event returns 204', async () => {
  const r = await post('/api/track', { event: 'product', product: 'Ethiopian Coffee' });
  assert.equal(r.status, 204);
});

test('REGRESSION: same-origin POST with Origin header does NOT 500 (CORS bug)', async () => {
  // The empty-CORS_ORIGINS bug threw on any Origin, turning every POST into a
  // 500 for hours. A rejected origin must decline quietly, never fatal.
  const r = await post('/api/track', { path: '/' }, { Origin: 'https://oliraagroindustry.com' });
  assert.notEqual(r.status, 500);
  assert.equal(r.status, 204);
});

test('POST /api/track from a bot UA is ignored (204, not counted)', async () => {
  const r = await post('/api/track', { path: '/' }, { 'User-Agent': 'Googlebot/2.1' });
  assert.equal(r.status, 204);
});

// ---- Inquiry (contact form) ----
test('POST /api/inquiry honeypot silently succeeds without sending', async () => {
  const r = await post('/api/inquiry', {
    name: 'Spammer', email: 'spam@example.com', message: 'buy my stuff now please',
    website: 'http://spam.example'  // honeypot filled -> treated as spam
  });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.success, true);
});

test('POST /api/inquiry rejects missing required fields', async () => {
  const r = await post('/api/inquiry', { name: 'x' }); // no email/message
  assert.equal(r.status, 400);
});

// ---- Admin auth ----
test('POST /api/admin/login rejects wrong password (401)', async () => {
  const r = await post('/api/admin/login', { password: 'definitely_wrong_password' });
  assert.equal(r.status, 401);
});

test('POST /api/admin/login accepts the correct password', async () => {
  const r = await post('/api/admin/login', { password: 'test_admin_password_123' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.ok(typeof b.token === 'string' && b.token.length > 0);
});

test('GET /api/analytics requires auth (401 without token)', async () => {
  const r = await get('/api/analytics');
  assert.equal(r.status, 401);
});

test('GET /api/analytics accepts a valid token', async () => {
  const login = await post('/api/admin/login', { password: 'test_admin_password_123' });
  const { token } = await login.json();
  const r = await get('/api/analytics?days=7', { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.ok(b.totals && typeof b.totals.views === 'number');
});

// ---- Admin rebuild (2026-09) ----
test('SECURITY: integrations writes require an admin session', async () => {
  assert.equal((await post('/api/integrations/analytics', { measurementId: 'G-ABCDEFGHIJ' })).status, 401);
  assert.equal((await post('/api/integrations/ads', { conversionId: '1234567890' })).status, 401);
});

test('admin can save integrations with a token', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const r = await post('/api/integrations/analytics', { measurementId: 'G-ABCDEFGHIJ', propertyId: '' }, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  assert.equal((await (await get('/api/integrations')).json()).analytics.measurementId, 'G-ABCDEFGHIJ');
});

test('products can be reordered without dropping or inventing items', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const auth = { Authorization: `Bearer ${token}` };
  await post('/api/products', { products: [{ id: 'a', name: 'A', description: 'a' }, { id: 'b', name: 'B', description: 'b' }, { id: 'c', name: 'C', description: 'c' }] }, auth);
  assert.equal((await post('/api/products/order', { ids: ['a'] })).status, 401);
  const r = await post('/api/products/order', { ids: ['c', 'ghost', 'a', 'c'] }, auth);
  assert.equal(r.status, 200);
  assert.deepEqual((await (await get('/api/products')).json()).map((p) => p.id), ['c', 'a', 'b']);
  assert.equal((await post('/api/products/order', { ids: 'c' }, auth)).status, 400);
});

test('contact details keep only clean place fields and numeric coordinates', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const r = await post('/api/contact-details', {
    phones: ['+251 900 123 456'], emails: ['info@example.com'],
    address: { line1: ' Lemi Kura ', city: 'Addis Ababa', evil: { x: 1 } },
    factory: { name: 'Burayu', lat: '9.0366', lng: 'not a number' },
    office: 'nope'
  }, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  const d = await (await get('/api/contact-details')).json();
  assert.deepEqual(d.address, { line1: 'Lemi Kura', city: 'Addis Ababa' });
  assert.deepEqual(d.factory, { name: 'Burayu', lat: 9.0366 });
  assert.equal(d.office, null);
});


// ---- Phone numbers are not handed to scrapers ----
test('PRIVACY: public contact details and social links carry no phone number', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const auth = { Authorization: `Bearer ${token}` };
  await post('/api/contact-details', { phones: ['+251-900 12 34 56', '+251 110 00 11 22'], emails: ['info@example.com'] }, auth);
  await post('/api/social-links', { whatsapp: 'https://wa.me/251900000001', telegram: 'https://t.me/olira_test' }, auth);
  const digitsOf = (s) => s.replace(/\D/g, '');
  // the matcher must see a formatted number, or a clean result means nothing
  assert.ok(digitsOf('+251-900 12 34 56').includes('900123456'));

  const pubContacts = await (await get('/api/contact-details')).text();
  const pubSocial = await (await get('/api/social-links')).text();
  for (const n of ['900123456', '110001122', '900000001']) {
    assert.ok(!digitsOf(pubContacts).includes(n), `contact-details leaks ${n}`);
    assert.ok(!digitsOf(pubSocial).includes(n), `social-links leaks ${n}`);
  }
  assert.equal(JSON.parse(pubSocial).telegram, 'https://t.me/olira_test'); // not a phone, stays public

  // the admin still sees and edits the real values
  const adminContacts = await (await get('/api/contact-details', auth)).json();
  assert.deepEqual(adminContacts.phones, ['+251-900 12 34 56', '+251 110 00 11 22']);
  assert.equal((await (await get('/api/social-links', auth)).json()).whatsapp, 'https://wa.me/251900000001');
});

test('PRIVACY: numbers are revealed only by POST from a browser, never to bots', async () => {
  const r = await post('/api/contact/reveal', {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const b = await r.json();
  assert.deepEqual(b.phones.map((p) => p.href), ['tel:+251900123456', 'tel:+251110001122']);
  assert.equal(b.phones[1].label, 'Office');
  assert.deepEqual(b.whatsapp, { href: 'https://wa.me/251900000001', display: '+251900000001' });
  assert.equal((await post('/api/contact/reveal', {}, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).status, 403);
  assert.equal((await get('/api/contact/reveal')).status, 404); // a crawler following links gets nothing
});

// ---- Insights (2026-09) ----
test('track records channel, campaign, language, entry page, time of day and engagement', async () => {
  const ua = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/139 InsightsA' };
  await post('/api/track', { path: '/agriculture/', referrer: 'https://www.google.com.et/', lang: 'ar-ae' }, ua);
  await post('/api/track', { path: '/packaging/', referrer: '', utm: { source: 'newsletter', medium: 'email', campaign: 'sept<script>' } }, ua);
  await post('/api/track', { event: 'leave', path: '/agriculture/', seconds: 42, scroll: 80 }, ua);
  await post('/api/track', { event: 'leave', path: '/agriculture/', seconds: 3, scroll: 10 }, ua);
  await post('/api/track', { event: 'reveal_whatsapp', path: '/agriculture/' }, ua);
  await post('/api/track', { event: 'form_start', path: '/packaging/' }, ua);
  await post('/api/track', { event: 'studio_download', path: '/packaging/' }, ua);
  await post('/api/track', { event: 'not_a_real_event', path: '/' }, ua);
  await post('/api/track', { event: 'product', product: 'Ethiopian Coffee', path: '/agriculture/' }, ua);

  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const a = await (await get('/api/analytics?days=7', { Authorization: `Bearer ${token}` })).json();
  assert.ok(a.channels.search >= 1, 'google.com.et counts as search');
  assert.ok(a.channels.email >= 1, 'utm medium email counts as email');
  assert.ok(a.campaigns.some((c) => c.name === 'newsletter / email / septscript'), 'campaign tag stripped of markup');
  assert.ok(a.languages.some((l) => l.name === 'ar-AE'));
  assert.equal(a.heatmap.length, 7); assert.equal(a.heatmap[0].length, 24);
  assert.ok(a.heatmap.flat().reduce((n, v) => n + v, 0) >= 2);
  const agri = a.pages.find((p) => p.path === '/agriculture/');
  assert.equal(agri.leaves, 2); assert.equal(agri.engagedRate, 50); assert.equal(agri.avgSeconds, 23);
  assert.ok(a.events.reveal_whatsapp >= 1 && a.events.form_start_pack >= 1 && a.events.studio_download >= 1);
  assert.equal(a.events.not_a_real_event, undefined, 'unknown events are ignored');
  // same-day funnel for this visitor: saw agriculture and packaging, opened a product, used the designer, showed contact intent
  for (const k of ['visit', 'agri', 'pack', 'product', 'studio', 'contactAgri', 'contactPack']) assert.ok(a.funnel[k] >= 1, `funnel step ${k}`);
  assert.ok(a.previous && typeof a.previous.views === 'number', 'previous period included');
  assert.equal(a.series.length, 7); assert.equal(a.previousSeries.length, 7);
});

test('every captured enquiry counts, even when the notification email fails', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const before = (await (await get('/api/analytics?days=1', { Authorization: `Bearer ${token}` })).json()).totals.inquiries;
  // the test server has no email configured, so this lead is captured but not emailed
  const r = await post('/api/inquiry', { name: 'Insight Buyer', email: 'buyer@example.com', message: 'Need 25 MT sesame to Jebel Ali', product: 'Kraft paper bags' });
  assert.equal(r.status, 500);
  const after = await (await get('/api/analytics?days=1', { Authorization: `Bearer ${token}` })).json();
  assert.equal(after.totals.inquiries, before + 1);
  assert.ok(after.inquiryLines.pack >= 1);
});

test('enquiry pipeline keeps a dated history and a private note', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const auth = { Authorization: `Bearer ${token}` };
  const { inquiries } = await (await get('/api/admin/inquiries', auth)).json();
  const id = inquiries.find((i) => i.name === 'Insight Buyer').id;
  assert.equal((await post(`/api/admin/inquiries/${id}`, { status: 'contacted' }, auth)).status, 200);
  assert.equal((await post(`/api/admin/inquiries/${id}`, { status: 'quoted', note: 'Sent CIF price for 25 MT' }, auth)).status, 200);
  assert.equal((await post(`/api/admin/inquiries/${id}`, { status: 'shipped' }, auth)).status, 400);
  assert.equal((await post(`/api/admin/inquiries/${id}`, { note: 'x'.repeat(2001) }, auth)).status, 400);
  const rec = (await (await get('/api/admin/inquiries', auth)).json()).inquiries.find((i) => i.id === id);
  assert.deepEqual(rec.history.map((h) => h.status), ['contacted', 'quoted']);
  assert.equal(rec.history[0].from, 'new');
  assert.ok(!Number.isNaN(Date.parse(rec.history[1].at)));
  assert.equal(rec.note, 'Sent CIF price for 25 MT');
  const counts = (await (await get('/api/admin/inquiries', auth)).json()).counts;
  assert.ok(counts.quoted >= 1 && counts.won === 0);
});

// ---- Restart-free admin credentials ----
test('admin can change the password from the panel, effective immediately (no restart)', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'test_admin_password_123' })).json();
  const chg = await post('/api/admin/change-password', { newPassword: 'panel_new_password_1' }, { Authorization: `Bearer ${token}` });
  assert.equal(chg.status, 200);
  // old password now rejected, new one works — with no process restart
  assert.equal((await post('/api/admin/login', { password: 'test_admin_password_123' })).status, 401);
  assert.equal((await post('/api/admin/login', { password: 'panel_new_password_1' })).status, 200);
});

test('change-password rejects a too-short password', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'panel_new_password_1' })).json();
  const r = await post('/api/admin/change-password', { newPassword: 'short' }, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 400);
});

test('REGRESSION: reset file recovers admin login without a restart', async () => {
  // The real outage: password unknown / locked out, and restarts don't work on
  // the host. Dropping DATA_DIR/admin-reset.txt must recover login live.
  fs.writeFileSync(path.join(tmp, 'admin-reset.txt'), 'file_recovered_pw_9');
  const r = await post('/api/admin/login', { password: 'file_recovered_pw_9' });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(tmp, 'admin-reset.txt')), false); // consumed after use
});

// ---- Lockout (runs last: it trips the per-IP counter) ----
test('progressive lockout returns 429 after repeated failures', async () => {
  let sawLockout = false;
  for (let i = 0; i < 6; i++) {
    const r = await post('/api/admin/login', { password: 'wrong_every_time' });
    if (r.status === 429) { sawLockout = true; break; }
  }
  assert.equal(sawLockout, true);
});

