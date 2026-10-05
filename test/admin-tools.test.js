// The admin's activity log, test email and site health: only the admin sees
// them, enquiry work is never in the log, and a failed test says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeEvent, deviceOf } from '../lib/admin-tools.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-admintools-'));
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
const req = (method, p, { token, body } = {}) => fetch(base + p, { method, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (password = process.env.ADMIN_PASSWORD) => (await (await req('POST', '/api/admin/login', { body: { password } })).json()).token;
const settle = () => new Promise((r) => setTimeout(r, 120)); // the audit log is appended asynchronously

test('the log is written in words, and enquiry work is not in it (self-check)', () => {
  const names = (id) => ({ tm_1: 'Hana Tesfaye' }[id] || 'Someone');
  assert.equal(describeEvent({ event: 'team_login_success', member: 'tm_1', t: 'x' }, names).text, 'Hana Tesfaye signed in');
  assert.equal(describeEvent({ event: 'login_failed' }).kind, 'problem');
  assert.equal(describeEvent({ event: 'email_test_sent', ok: false, error: 'x' }).kind, 'problem', 'a failed test is a problem');
  assert.equal(describeEvent({ event: 'email_test_sent', ok: true, to: 'a@b.c' }).kind, 'change');
  assert.equal(describeEvent({ event: 'packaging_minimum_set', by: 'tm_1', id: 'pk_flat' }, names).text, 'Hana Tesfaye changed prices and minimums (pk_flat)');
  for (const e of ['lead_file_downloaded', 'team_reply_sent', 'inquiry_deleted', 'inquiry_honeypot', 'admin_auth_rejected', 'team_auth_rejected']) assert.equal(describeEvent({ event: e }), null, `${e} is not for the admin`);
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'), 'Chrome on Windows');
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone or iPad');
});

test('only the admin can read the log, send a test or see the health', async () => {
  for (const [m, p] of [['GET', '/api/admin/activity'], ['POST', '/api/admin/email-test'], ['GET', '/api/admin/health']]) {
    assert.equal((await req(m, p)).status, 401, `${m} ${p} signed out`);
  }
  const admin = await login();
  await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Mgr Tools', email: 'mgr.tools@example.com', role: 'manager', password: 'manager-password-1' } } });
  const mgr = (await (await req('POST', '/api/team/login', { body: { email: 'mgr.tools@example.com', password: 'manager-password-1' } })).json()).token;
  assert.ok(mgr);
  for (const [m, p] of [['GET', '/api/admin/activity'], ['POST', '/api/admin/email-test'], ['GET', '/api/admin/health']]) {
    assert.ok([401, 403].includes((await req(m, p, { token: mgr })).status), `${m} ${p} as a manager`);
  }
});

test('sign-ins, wrong passwords and settings changes are in the log; filters work', async () => {
  assert.equal((await req('POST', '/api/admin/login', { body: { password: 'not-the-password-123' } })).status, 401);
  const admin = await login();
  assert.equal((await req('POST', '/api/contact-details', { token: admin, body: { phones: [], emails: ['info@example.com'], address: {} } })).status, 200);
  await settle();
  const all = (await (await req('GET', '/api/admin/activity', { token: admin })).json()).items;
  const texts = all.map((i) => i.text);
  assert.ok(texts.includes('The administrator signed in'), texts.slice(0, 8).join(' | '));
  assert.ok(texts.includes('A wrong admin password was tried'));
  assert.ok(texts.includes('Company details saved'), 'settings changes are audited');
  assert.ok(texts.some((t) => t.startsWith('Staff account saved: Mgr Tools')));
  assert.ok(all.every((i) => i.at && i.device), 'each entry has a time and a device');
  assert.ok(Date.parse(all[0].at) >= Date.parse(all.at(-1).at), 'newest first');
  const problems = (await (await req('GET', '/api/admin/activity?kind=problem', { token: admin })).json()).items;
  assert.ok(problems.length && problems.every((i) => i.kind === 'problem'));
});

test('a test email: refused until set up, then the mail server\'s answer is kept', async () => {
  const admin = await login();
  const none = await req('POST', '/api/admin/email-test', { token: admin });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, 'not_set');
  // a mail server nobody answers on
  assert.equal((await req('POST', '/api/email-config', { token: admin, body: { smtpHost: '127.0.0.1', smtpPort: '1', smtpUser: 'test@example.com', smtpPassword: 'not-a-real-password', recipientEmail: 'inbox@example.com', fromName: 'Test' } })).status, 200);
  const r = await req('POST', '/api/admin/email-test', { token: admin });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.ok, false);
  assert.ok(body.error.length > 3 && !body.error.includes('not-a-real-password'), 'the answer, never the password');
  const health = await (await req('GET', '/api/admin/health', { token: admin })).json();
  assert.equal(health.email.ok, false);
  assert.equal(health.email.to, 'inbox@example.com');
  assert.ok(Array.isArray(health.checks.failing) && typeof health.dataBytes === 'number' && health.node.startsWith('v'));
  await settle();
  const log = (await (await req('GET', '/api/admin/activity', { token: admin })).json()).items.map((i) => i.text);
  assert.ok(log.includes('Email delivery settings saved'));
  assert.ok(log.some((t) => t.startsWith('Test email failed')));
});
