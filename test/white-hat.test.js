// Guards for what the white-hat audit of 23 Nov 2026 proved on the sandbox: requests that
// froze or hung the server, log flooding, staff lockout by email, inherited names passing
// lookups, missing no-store, and the enquiry form as an open file store.
// Runs the real app on a temporary DATA_DIR, like api.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-whitehat-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
process.env.INTAKE_DAY_BUDGET_MB = '1'; // one megabyte of files a day per address, for the budget test

const { app } = await import('../server.js');
const { sniffFile } = await import('../lib/workspace.js');

let server, base;
const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
// `from` sets the address the server sees (trust proxy = 1 hop, as behind the host's proxy)
const req = (method, p, { token, body, form, from } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': UA, ...(from ? { 'X-Forwarded-For': from } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  signal: AbortSignal.timeout(5000),
});
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: 'test_admin_password_123' } })).json()).token;
const timed = async (fn) => { const t = performance.now(); const r = await fn(); return [r, performance.now() - t]; };

test('a file of empty HTML comments is checked in a moment, real SVG still recognised', () => {
  for (const n of [30, 60, 585]) {
    const t = performance.now();
    assert.equal(sniffFile(Buffer.from('<!---->'.repeat(n) + 'x')), null);
    assert.ok(performance.now() - t < 50, `${n} comments took ${(performance.now() - t).toFixed(1)} ms`);
  }
  assert.equal(sniffFile(Buffer.from('<?xml version="1.0"?>\n<!-- made in a drawing app -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg width="10"></svg>')), 'svg');
  assert.equal(sniffFile(Buffer.from('<!-- a - b -- c --> <!-- two -->\n<svg xmlns="http://www.w3.org/2000/svg">')), 'svg');
  assert.equal(sniffFile(Buffer.from('<!-- x --><html><body></body></html>')), null);
});

test('a very long email address is refused at once, not matched', async () => {
  const email = 'a@' + 'a.'.repeat(25000) + '@';
  const [r, ms] = await timed(() => req('POST', '/api/inquiry', { body: { name: 'Long Mail', email, message: 'x' } }));
  assert.equal(r.status, 400);
  assert.ok(ms < 300, `took ${ms.toFixed(0)} ms`);
  assert.equal((await req('POST', '/api/inquiry', { body: { name: 'Fine Buyer', email: 'fine@example.com', message: 'A price for sesame, please.' } })).status !== 400, true, 'a normal address still passes');
});

test('?scope=constructor gets an answer (the public list), not a hang', async () => {
  for (const scope of ['constructor', 'toString', 'valueOf', '__proto__']) {
    const r = await req('GET', `/api/packaging-products?scope=${scope}`);
    assert.equal(r.status, 200, scope);
    assert.ok(Array.isArray(await r.json()));
  }
});

test('signing out a made-up token writes nothing to the activity log', async () => {
  const log = path.join(tmp, 'admin-audit.log');
  const size = () => (fs.existsSync(log) ? fs.statSync(log).size : 0);
  await new Promise((r) => setTimeout(r, 150)); // earlier log lines are appended asynchronously
  const before = size();
  for (let i = 0; i < 10; i++) assert.equal((await req('POST', '/api/admin/logout', { token: `x.${i}abc.y` })).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(size(), before, 'no "signed out" lines from made-up tokens');
  // refused requests from one address are logged at most once a minute
  for (let i = 0; i < 10; i++) assert.equal((await req('GET', '/api/admin/health', { from: '198.51.100.77' })).status, 401);
  await new Promise((r) => setTimeout(r, 150));
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.includes('198.51.100.77'));
  assert.equal(lines.length, 1);
});

test('wrong passwords from one address do not lock the person out everywhere', async () => {
  const admin = await adminToken();
  const email = 'locked.member@example.com', password = 'member-password-12';
  assert.equal((await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Locked Member', email, role: 'pack', password } } })).status, 200);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await req('POST', '/api/team/login', { from: '203.0.113.10', body: { email, password: 'wrong-password-123' } })).status);
  assert.equal(codes.at(-1), 429, 'that address is locked for this account');
  assert.equal((await req('POST', '/api/team/login', { from: '203.0.113.10', body: { email, password } })).status, 429);
  assert.equal((await req('POST', '/api/team/login', { from: '203.0.113.99', body: { email, password } })).status, 200, 'the person signs in from their own address');
});

test('names Object already has do not pass the role and activity lookups', async () => {
  const admin = await adminToken();
  for (const role of ['constructor', 'toString', '__proto__']) {
    const r = await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Odd Role', email: `odd.${role.replace(/_/g, '')}@example.com`, role, password: 'member-password-12' } } });
    assert.equal(r.status, 400, role);
  }
  await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Act Manager', email: 'act.manager@example.com', role: 'manager', password: 'member-password-12' } } });
  const mgr = (await (await req('POST', '/api/team/login', { body: { email: 'act.manager@example.com', password: 'member-password-12' } })).json()).token;
  const list = (await (await req('GET', '/api/team/inquiries', { token: mgr })).json()).inquiries;
  assert.ok(list.length, 'an enquiry to log against');
  const r = await req('POST', `/api/team/inquiries/${list[0].id}/activity`, { token: mgr, body: { type: 'constructor', text: 'x' } });
  assert.equal(r.status, 400);
});

test('answers for signed-in people are never cached', async () => {
  const admin = await adminToken();
  const mgr = (await (await req('POST', '/api/team/login', { body: { email: 'act.manager@example.com', password: 'member-password-12' } })).json()).token;
  for (const [p, token] of [['/api/team/inquiries', mgr], ['/api/team/me', mgr], ['/api/admin/team', admin], ['/api/contact-details', admin], ['/api/admin/verify', admin]]) {
    const r = await req('GET', p, { token });
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
  }
});

test('a stranger can leave only so many megabytes of files a day', async () => {
  const fd = (name) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: 'Bag Buyer', email: 'bags@example.com', message: 'Quote for 20000 bags.', product: 'Kraft paper bags', consent: '1' })) f.append(k, v);
    f.append('files', new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600 * 1024, 32)])], { type: 'application/pdf' }), name);
    return f;
  };
  const first = await req('POST', '/api/inquiry', { from: '192.0.2.50', form: fd('one.pdf') });
  assert.ok(first.status !== 400, `the first file is taken (${first.status})`);
  const second = await req('POST', '/api/inquiry', { from: '192.0.2.50', form: fd('two.pdf') });
  assert.equal(second.status, 400, 'over the day\'s budget: the request is in, the file is not');
  assert.equal((await second.json()).saved, true);
  const other = await req('POST', '/api/inquiry', { from: '192.0.2.51', form: fd('three.pdf') });
  assert.ok(other.status !== 400, 'another address has its own budget');
});

test('a sign-out is kept on disk, so a restart does not bring the session back', async () => {
  const token = await adminToken();
  assert.equal((await req('GET', '/api/admin/verify', { token })).status, 200);
  assert.equal((await req('POST', '/api/admin/logout', { token })).status, 200);
  assert.equal((await req('GET', '/api/admin/verify', { token })).status, 401);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'revoked-tokens.json'), 'utf8'));
  assert.ok(saved.length >= 1 && saved.every(([h, until]) => typeof h === 'string' && until > Date.now()));
});

test('small hardening: one-line subjects, odd product ids, made-up countries, broken JSON', async () => {
  const { oneLine } = await import('../lib/site-basics.js');
  assert.equal(oneLine('Re: price\r\nBcc: x@example.com', 200), 'Re: price Bcc: x@example.com');

  const admin = await adminToken();
  await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Agri Ids', email: 'agri.ids@example.com', role: 'agri', password: 'member-password-12' } } });
  const agri = (await (await req('POST', '/api/team/login', { body: { email: 'agri.ids@example.com', password: 'member-password-12' } })).json()).token;
  for (const id of [{ x: 1 }, '../escape', 'a b']) {
    const r = await req('POST', '/api/products', { token: agri, body: { product: { id, name: 'Odd Id Beans', category: 'Pulses', description: 'Test beans.' } } });
    assert.equal(r.status, 200, JSON.stringify(id));
  }
  const ids = (await (await req('GET', '/api/products')).json()).map((p) => p.id);
  assert.ok(ids.includes('odd-id-beans') && !ids.some((i) => typeof i !== 'string' || /[./ ]/.test(i)), 'the id is made from the name');

  await fetch(base + '/api/track', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'CF-IPCountry': 'FR' }, body: JSON.stringify({ path: '/' }) });
  const mgr = (await (await req('POST', '/api/team/login', { body: { email: 'act.manager@example.com', password: 'member-password-12' } })).json()).token;
  assert.doesNotMatch(await (await req('GET', '/api/analytics?days=7', { token: mgr })).text(), /"FR"/, 'no country without a CDN in front');

  const errLog = path.join(tmp, 'logs', 'error.log');
  const before = fs.existsSync(errLog) ? fs.statSync(errLog).size : 0;
  const bad = await fetch(base + '/api/track', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /not valid JSON/);
  assert.equal(fs.existsSync(errLog) ? fs.statSync(errLog).size : 0, before, 'not written to the error log');
});

test('the staff screens get a narrower content policy than the public pages', async () => {
  const csp = async (p) => (await fetch(base + p, { headers: { 'User-Agent': UA } })).headers.get('content-security-policy') || '';
  const directive = (policy, name) => (policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '');
  for (const p of ['/admin/', '/team/', '/team/manager/']) {
    const policy = await csp(p);
    assert.ok(policy, p);
    assert.doesNotMatch(policy, /googletagmanager/, `${p}: no tag host`);
    for (const d of ['img-src', 'connect-src']) assert.doesNotMatch(directive(policy, d), /(^|\s)https:(\s|$)/, `${p} ${d}: no "any https site"`);
  }
  const pub = await csp('/');
  assert.match(pub, /googletagmanager/, 'public pages keep the optional Google tag');
  assert.match(directive(pub, 'img-src'), /(^|\s)https:(\s|$)/);
});
