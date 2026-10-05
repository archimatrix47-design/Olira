// Search engine ownership files: only the codes the admin saved answer, and only
// the admin can save them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanGoogleCode, cleanBingCode } from '../lib/search-verification.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-verify-'));
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
const req = (method, p, { token, body } = {}) => fetch(base + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
const BING = '0123456789ABCDEF0123456789ABCDEF';

test('what the admin pastes is read down to the code (self-check of the readers)', () => {
  assert.equal(cleanGoogleCode('google1a2b3c4d5e6f7a8b.html'), '1a2b3c4d5e6f7a8b');
  assert.equal(cleanGoogleCode('https://oliraagroindustry.com/google1a2b3c4d5e6f7a8b.html'), '1a2b3c4d5e6f7a8b');
  assert.equal(cleanGoogleCode('1a2b3c4d5e6f7a8b'), '1a2b3c4d5e6f7a8b');
  assert.equal(cleanGoogleCode('google../../server.js'), null);
  assert.equal(cleanGoogleCode('google<script>.html'), null);
  assert.equal(cleanBingCode(BING.toLowerCase()), BING);
  assert.equal(cleanBingCode(`<meta name="msvalidate.01" content="${BING}" />`), BING);
  assert.equal(cleanBingCode('<users><user>' + BING + '</user></users>'), BING);
  assert.equal(cleanBingCode('not a code'), null);
  assert.equal(cleanBingCode(BING + 'FF'), null, 'a longer run of letters is not the code');
});

test('nothing answers until codes are saved, and only the admin can save them', async () => {
  assert.equal((await req('GET', '/google1a2b3c4d5e6f7a8b.html')).status, 404);
  assert.equal((await req('GET', '/BingSiteAuth.xml')).status, 404);
  assert.equal((await req('POST', '/api/integrations/verification', { body: { google: 'google1a2b3c4d5e6f7a8b.html' } })).status, 401);
  const admin = await adminToken();
  const bad = await req('POST', '/api/integrations/verification', { token: admin, body: { google: 'google../x.html' } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'google');
  assert.equal((await req('POST', '/api/integrations/verification', { token: admin, body: { bing: 'short' } })).status, 400);
  const ok = await req('POST', '/api/integrations/verification', { token: admin, body: { google: 'google1a2b3c4d5e6f7a8b.html', bing: `<meta name="msvalidate.01" content="${BING.toLowerCase()}" />` } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).config, { google: '1a2b3c4d5e6f7a8b', bing: BING });
});

test('the saved codes answer exactly as Google and Bing expect; other names are a 404', async () => {
  const g = await req('GET', '/google1a2b3c4d5e6f7a8b.html');
  assert.equal(g.status, 200);
  assert.match(g.headers.get('content-type'), /text\/html/);
  assert.equal(await g.text(), 'google-site-verification: google1a2b3c4d5e6f7a8b.html');
  assert.equal((await req('GET', '/google0000000000000000.html')).status, 404, 'a wrong file name is a 404');
  const b = await req('GET', '/BingSiteAuth.xml');
  assert.equal(b.status, 200);
  assert.match(b.headers.get('content-type'), /xml/);
  assert.match(await b.text(), new RegExp(`<user>${BING}</user>`));
  // the public settings show the codes (they are public by design: the files serve them)
  assert.equal((await (await req('GET', '/api/integrations')).json()).verification.google, '1a2b3c4d5e6f7a8b');
});

test('clearing the codes takes the files down', async () => {
  const admin = await adminToken();
  assert.equal((await req('POST', '/api/integrations/verification', { token: admin, body: { google: '', bing: '' } })).status, 200);
  assert.equal((await req('GET', '/google1a2b3c4d5e6f7a8b.html')).status, 404);
  assert.equal((await req('GET', '/BingSiteAuth.xml')).status, 404);
});
