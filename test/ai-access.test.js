// AI access (lib/ai-access.js) on the real app: an AI reader key reads the log and
// nothing else, only while the admin's switch is on, and stops at once when it is
// removed; the key is stored only as a hash; the admin holds the keys and the
// switch but cannot read the log; the manager reads it and gets the local model's
// address, which must be on this computer or a private network and is allowed in
// the Content-Security-Policy on the admin's and manager's pages only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-ai-'));
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
const { cleanLlm, isLocalHost } = await import('../lib/ai-access.js');

let server, base;
const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); });
const req = (method, p, { token, body, ua = UA } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': ua, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(admin, { name, email, role }) {
  const password = 'member-password-123';
  const r = await req('POST', '/api/admin/team', { token: admin, body: { member: { name, email, role, password } } });
  assert.equal(r.status, 200);
  return (await (await req('POST', '/api/team/login', { body: { email, password } })).json()).token;
}
const store = () => JSON.parse(fs.readFileSync(path.join(tmp, 'ai-access.json'), 'utf8'));

test('the local model must be on this computer or a private network', () => {
  for (const ok of ['http://localhost:11434', 'http://127.0.0.1:1234/v1', 'http://192.168.1.20:11434', 'http://10.0.0.5:8080', 'http://172.20.1.1:11434', 'http://[::1]:11434', 'https://ollama.localhost'])
    assert.ok(cleanLlm({ url: ok, model: 'llama3.1:8b', enabled: true }).llm, ok);
  for (const bad of ['https://api.openai.com/v1', 'http://8.8.8.8:11434', 'http://172.32.0.1', 'http://192.168.1.20.evil.example', 'http://localhost.evil.example', 'http://user:pw@localhost:11434', 'http://localhost:11434/?key=1', 'ftp://localhost', 'javascript:alert(1)', 'http://999.1.1.1'])
    assert.ok(cleanLlm({ url: bad, model: 'm' }).error, bad);
  assert.ok(cleanLlm({ url: 'http://localhost:11434', model: 'llama3; rm -rf /' }).error, 'a model name is only a name');
  assert.ok(cleanLlm({ enabled: true, url: '', model: '' }).error, 'switched on needs an address and a model');
  assert.equal(cleanLlm({ url: 'http://localhost:11434/', model: 'm' }).llm.url, 'http://localhost:11434');
  assert.equal(isLocalHost('169.254.1.1'), false, 'link-local is not an office network');
});

test('an AI reader key reads the log only, only while switched on, and is stored as a hash', async () => {
  const admin = await adminToken();
  const manager = await member(admin, { name: 'Manager M', email: 'm@example.com', role: 'manager' });
  const pack = await member(admin, { name: 'Pack P', email: 'p@example.com', role: 'pack' });

  assert.equal((await req('GET', '/api/ai/log')).status, 401, 'no key');
  assert.equal((await req('GET', '/api/ai/log', { token: 'olira_ai_madeup' })).status, 401, 'a made-up key');
  assert.equal((await req('GET', '/api/ai/log', { token: admin })).status, 401, 'the admin\'s own sign-in is not a reader key');
  assert.ok([401, 403].includes((await req('POST', '/api/admin/ai-access/keys', { token: manager, body: { name: 'x' } })).status), 'only the admin creates accounts');

  assert.equal((await req('POST', '/api/admin/ai-access/keys', { token: admin, body: { name: '' } })).status, 400);
  const made = await (await req('POST', '/api/admin/ai-access/keys', { token: admin, body: { name: 'Claude' } })).json();
  assert.match(made.key, /^olira_ai_[\w-]{32}$/);
  const saved = fs.readFileSync(path.join(tmp, 'ai-access.json'), 'utf8');
  assert.ok(!saved.includes(made.key) && !saved.includes(made.key.slice(9)), 'the key itself is never stored');
  assert.match(store().keys[0].hash, /^[0-9a-f]{64}$/);
  const listed = await (await req('GET', '/api/admin/ai-access', { token: admin })).json();
  assert.ok(!JSON.stringify(listed).includes(made.key.slice(13)), 'nor shown again');
  assert.equal(listed.enabled, false, 'off until the admin switches it on');

  assert.equal((await req('GET', '/api/ai/log', { token: made.key })).status, 403, 'switched off');
  assert.equal((await req('POST', '/api/admin/ai-access', { token: admin, body: { enabled: 'yes' } })).status, 400);
  assert.equal((await req('POST', '/api/admin/ai-access', { token: admin, body: { enabled: true } })).status, 200);
  const r = await req('GET', '/api/ai/log?days=7', { token: made.key });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const log = await r.json();
  assert.equal(log.schema, 'olira-site-log/1'); assert.equal(log.period.days, 7);
  assert.equal((await req('GET', '/api/ai/schema', { token: made.key })).status, 200);
  assert.ok(Array.isArray((await (await req('GET', '/api/ai/history', { token: made.key })).json()).days));
  assert.equal((await req('GET', `/api/ai/log?key=${made.key}`)).status, 401, 'a key in the address is never read');
  assert.ok(store().keys[0].lastReadAt, 'the admin sees when it was last used');

  for (const p of ['/api/analytics', '/api/team/inquiries', '/api/team/manager/ai-log', '/api/admin/ai-access', '/api/email-config', '/api/admin/team'])
    assert.ok([401, 403].includes((await req('GET', p, { token: made.key })).status), `the reader key opens nothing else: ${p}`);

  // the log is the manager's data: not the admin's, not a team's
  assert.ok([401, 403].includes((await req('GET', '/api/team/manager/ai-log', { token: admin })).status), 'the admin cannot read the log');
  assert.equal((await req('GET', '/api/team/manager/ai-log', { token: pack })).status, 403, 'nor a marketing team');
  assert.equal((await req('GET', '/api/team/manager/ai-log?days=90', { token: manager })).status, 200, 'the manager can');

  assert.equal((await req('POST', '/api/admin/ai-access', { token: admin, body: { enabled: false } })).status, 200);
  assert.equal((await req('GET', '/api/ai/log', { token: made.key })).status, 403, 'switched off again: refused at once');
  await req('POST', '/api/admin/ai-access', { token: admin, body: { enabled: true } });
  const id = store().keys[0].id;
  assert.equal((await req('DELETE', `/api/admin/ai-access/keys/${id}`, { token: admin })).status, 200);
  assert.equal((await req('GET', '/api/ai/log', { token: made.key })).status, 401, 'removed: refused at once');
  assert.equal(store().keys[0].hash, undefined, 'nothing left for the key to match');
  assert.equal((await req('DELETE', `/api/admin/ai-access/keys/${id}`, { token: admin })).status, 404);
});

test('the local model: saved by the admin, offered to the manager, allowed only on their pages', async () => {
  const admin = await adminToken();
  const manager = await member(admin, { name: 'Manager N', email: 'n@example.com', role: 'manager' });
  const agri = await member(admin, { name: 'Agri A', email: 'a@example.com', role: 'agri' });
  assert.equal((await req('POST', '/api/admin/ai-access', { token: admin, body: { llm: { enabled: true, kind: 'ollama', url: 'https://api.example.com', model: 'm' } } })).status, 400, 'not a public server');
  assert.deepEqual((await (await req('GET', '/api/team/manager/ai', { token: manager })).json()).llm, null, 'nothing offered until it is switched on');
  assert.equal((await req('POST', '/api/admin/ai-access', { token: admin, body: { llm: { enabled: true, kind: 'ollama', url: 'http://localhost:11434', model: 'llama3.1:8b' } } })).status, 200);
  assert.deepEqual((await (await req('GET', '/api/team/manager/ai', { token: manager })).json()).llm, { kind: 'ollama', url: 'http://localhost:11434', model: 'llama3.1:8b' });
  assert.equal((await req('GET', '/api/team/manager/ai', { token: agri })).status, 403);
  const csp = async (p) => (await req('GET', p)).headers.get('content-security-policy') || '';
  const connect = (h) => (h.match(/connect-src ([^;]+)/) || [])[1] || '';
  assert.match(connect(await csp('/admin/')), /http:\/\/localhost:11434/, 'the admin can check the connection');
  assert.match(connect(await csp('/team/manager/')), /http:\/\/localhost:11434/, 'the manager can ask');
  for (const p of ['/', '/packaging/', '/team/packaging/', '/team/agriculture/', '/team/'])
    assert.doesNotMatch(connect(await csp(p)), /localhost:11434/, `never on ${p}`);
  await req('POST', '/api/admin/ai-access', { token: admin, body: { llm: { enabled: false, kind: 'ollama', url: '', model: '' } } });
  assert.doesNotMatch(connect(await csp('/team/manager/')), /localhost/, 'cleared, gone from the policy too');
});

test('real visitors\' speed reaches the log; a bot\'s and nonsense do not', async () => {
  const admin = await adminToken();
  const manager = await member(admin, { name: 'Manager O', email: 'o@example.com', role: 'manager' });
  const before = (await (await req('GET', '/api/team/manager/ai-log', { token: manager })).json()).speed?.overall?.pageViews || 0;
  assert.equal((await req('POST', '/api/track', { body: { event: 'vitals', path: '/packaging/', lcp: 1800, inp: 120, cls: 0.02, ttfb: 300 } })).status, 204);
  await req('POST', '/api/track', { body: { event: 'vitals', path: '/packaging/', lcp: 1800 }, ua: 'Mozilla/5.0 HeadlessChrome/120' });
  await req('POST', '/api/track', { body: { event: 'vitals', path: '/packaging/', lcp: 'slow', cls: -4 } });
  const log = await (await req('GET', '/api/team/manager/ai-log', { token: manager })).json();
  assert.equal(log.speed.overall.pageViews - before, 1);
  assert.equal(log.speed.byPage.packaging.lcp.p75AtMost, 2000);
  assert.equal(log.speed.byDevice.desktop.inp.rating, 'good');
});

test('enquiries sent through the website appear as counts, never as people', async () => {
  const admin = await adminToken();
  const manager = await member(admin, { name: 'Manager Q', email: 'q@example.com', role: 'manager' });
  const people = [['Tigist Sample', 'tigist@sample-bunna-export.com', '+251 900 00 44 55', 'Bunna Export PLC'], ['Dawit Sample', 'sample.buyer.dawit@gmail.com', '+44 7700 900123', 'Haile Trading']];
  for (const [name, email, phone, company] of people) {
    const r = await req('POST', '/api/inquiry', { body: { name, email, phone, company, product: 'Sesame Seeds', message: `This is ${name} of ${company}; ring ${phone} after six about our private order.` } });
    assert.ok([200, 500].includes(r.status), `saved (${r.status})`);
  }
  const log = await (await req('GET', '/api/team/manager/ai-log', { token: manager })).json();
  assert.ok(log.enquiries.received >= 2);
  const text = JSON.stringify(log).toLowerCase();
  for (const p of people) for (const s of p) assert.ok(!text.includes(s.toLowerCase()), `"${s}" is not in the log`);
  assert.ok(!text.includes('private order'));
});
