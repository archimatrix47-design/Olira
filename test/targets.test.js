// Monthly targets: only the manager sets them, each team reads its own line, and
// progress is counted from the enquiries for the current month.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTargets } from '../lib/targets.js';
import { progress, monthOf } from '../src/scripts/team/targets-progress.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-targets-'));
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
const req = (method, p, { token, body } = {}) => fetch(base + p, { method, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const admin = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(role, email) {
  await req('POST', '/api/admin/team', { token: await admin(), body: { member: { name: `${role} t`, email, role, password: 'member-password-12' } } });
  return (await (await req('POST', '/api/team/login', { body: { email, password: 'member-password-12' } })).json()).token;
}

test('targets are whole numbers or blank (self-check)', () => {
  const ok = cleanTargets({ agri: { enquiries: '30', quotes: 12, wonValue: '250,000', currency: 'USD' }, pack: { enquiries: '' } });
  assert.deepEqual(ok.targets.agri, { enquiries: 30, quotes: 12, wonValue: 250000, currency: 'USD' });
  assert.deepEqual(ok.targets.pack, { enquiries: null, quotes: null, wonValue: null, currency: 'ETB' }, 'blank is no target; packaging defaults to birr');
  for (const bad of ['-1', '2.5', 'lots']) assert.ok(cleanTargets({ agri: { enquiries: bad } }).error, bad);
});

test('the manager sets the targets; each team reads its own line; nobody else', async () => {
  const mgr = await member('manager', 'mgr.tg@example.com'), agri = await member('agri', 'agri.tg@example.com'), pack = await member('pack', 'pack.tg@example.com');
  const body = { targets: { agri: { enquiries: 30, quotes: 12, wonValue: 250000, currency: 'USD' }, pack: { enquiries: 40, quotes: 20, wonValue: 900000, currency: 'ETB' } } };
  assert.equal((await req('POST', '/api/team/targets', { body })).status, 401);
  assert.equal((await req('POST', '/api/team/targets', { token: agri, body })).status, 403, 'a team cannot set them');
  assert.equal((await req('POST', '/api/team/targets', { token: await admin(), body })).status, 403, 'nor the admin');
  assert.equal((await req('POST', '/api/team/targets', { token: mgr, body: { targets: { agri: { enquiries: 'lots' } } } })).status, 400);
  assert.equal((await req('POST', '/api/team/targets', { token: mgr, body })).status, 200);
  const a = await (await req('GET', '/api/team/targets', { token: agri })).json();
  assert.deepEqual(Object.keys(a.targets), ['agri'], 'the agriculture team sees its own line only');
  assert.equal(a.targets.agri.enquiries, 30);
  const k = await (await req('GET', '/api/team/targets', { token: pack })).json();
  assert.deepEqual(Object.keys(k.targets), ['pack']);
  const m = await (await req('GET', '/api/team/targets', { token: mgr })).json();
  assert.deepEqual(Object.keys(m.targets).sort(), ['agri', 'pack']);
});

test('progress counts this month: enquiries, quotes sent, value won in the currency', () => {
  const now = new Date(2026, 9, 16, 12).getTime(); // 16 October, about half way
  const oct = (d) => new Date(2026, 9, d, 10).toISOString(), sep = new Date(2026, 8, 28, 10).toISOString();
  const leads = [
    { line: 'agri', createdAt: oct(2), status: 'won', quote: { currency: 'USD', total: 92500 }, history: [{ status: 'won', at: oct(10) }], activity: [{ type: 'quote', at: oct(5) }] },
    { line: 'agri', createdAt: oct(8), status: 'quoted', activity: [{ type: 'quote', at: oct(9) }, { type: 'quote', at: oct(12) }] },
    { line: 'agri', createdAt: sep, status: 'won', quote: { currency: 'EUR', total: 10000 }, history: [{ status: 'won', at: oct(3) }], activity: [{ type: 'quote', at: sep }] },
    { line: 'agri', createdAt: oct(20), status: 'new' }, // after "now"
    { line: 'pack', createdAt: oct(3), status: 'new' },
  ];
  const p = progress(leads, { enquiries: 6, quotes: 4, wonValue: 100000, currency: 'USD' }, 'agri', now);
  assert.equal(p.enquiries.done, 2, 'two agriculture enquiries arrived this month by now');
  assert.equal(p.quotes.done, 3, 'three quotes sent this month (September\'s does not count)');
  assert.equal(p.wonValue.done, 92500);
  assert.equal(p.wonValue.won, 2);
  assert.equal(p.wonValue.otherCurrency, 1, 'a win in euros is counted apart, not added at the wrong rate');
  const half = monthOf(now).elapsed;
  assert.ok(half > 0.45 && half < 0.55);
  assert.equal(p.enquiries.onPace, false, '2 of 6 by mid month is behind');
  assert.equal(p.quotes.onPace, true, '3 of 4 by mid month is on pace');
  assert.equal(progress(leads, {}, 'agri', now).enquiries.target, null, 'no target set');
});
