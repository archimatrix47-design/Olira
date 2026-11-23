// With no JWT_SECRET (a lost setting, a new app), sign-in is switched off AND no token signed
// with the public default secret is accepted: before 23 Nov 2026 the guards still checked
// tokens with that default, so anyone could forge an admin or manager session.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL', 'JWT_SECRET']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-nosecret-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.ADMIN_PASSWORD = 'test_admin_password_123';

const { app } = await import('../server.js');
let server, base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const forge = (claims, secret) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};
const get = (p, token) => fetch(base + p, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140', Authorization: `Bearer ${token}` } });

test('no secret set: a token signed with the public default is refused everywhere', async () => {
  const admin = forge({}, 'default_secret_change_in_production');
  assert.equal((await get('/api/admin/verify', admin)).status, 401);
  assert.equal((await get('/api/admin/health', admin)).status, 401);
  const manager = forge({ role: 'manager', uid: 'tm_x', pv: 1 }, 'default_secret_change_in_production');
  assert.equal((await get('/api/team/inquiries', manager)).status, 401);
  // and an empty secret is no better
  assert.equal((await get('/api/admin/verify', forge({}, ''))).status, 401);
});
