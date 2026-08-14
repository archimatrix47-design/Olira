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
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000'; // headroom: the suite makes many logins
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
