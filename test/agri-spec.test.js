// An agricultural product's specification: known fields only, kept short, saved
// by the agriculture team, and never lost when a form leaves it out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanSpec, specRowsOf, SPEC_FIELDS } from '../lib/agri-spec.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-spec-'));
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
async function member(role, email) {
  const admin = (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
  await req('POST', '/api/admin/team', { token: admin, body: { member: { name: `${role} s`, email, role, password: 'member-password-12' } } });
  return (await (await req('POST', '/api/team/login', { body: { email, password: 'member-password-12' } })).json()).token;
}

test('only the known fields, one short line each (self-check)', () => {
  const s = cleanSpec({ moisture: ' 6%  max ', oil: '50% min\nshort', bogus: 'x', grade: '', packing: 'a'.repeat(300), documents: 42 });
  assert.deepEqual(Object.keys(s).sort(), ['moisture', 'oil', 'packing']);
  assert.equal(s.moisture, '6% max');
  assert.equal(s.oil, '50% min short', 'line breaks become spaces');
  assert.equal(s.packing.length, 120);
  assert.deepEqual(specRowsOf({ packing: 'PP bags', moisture: '6% max' }), [['Moisture', '6% max'], ['Packing', 'PP bags']], 'rows follow the list order');
  assert.ok(SPEC_FIELDS.length >= 10);
});

test('the agriculture team saves a specification; a save without one keeps it', async () => {
  const agri = await member('agri', 'agri.spec@example.com'), pack = await member('pack', 'pack.spec@example.com');
  const base = { id: 'spec-test-sesame', name: 'Spec Test Sesame', category: 'Sesame', description: 'A test product for the specification.' };
  assert.equal((await req('POST', '/api/products', { token: pack, body: { product: { ...base, spec: { moisture: '6% max' } } } })).status, 403, 'not the packaging team');
  const r = await (await req('POST', '/api/products', { token: agri, body: { product: { ...base, spec: { moisture: '6% max', oil: '50% min', hack: '<script>' } } } })).json();
  assert.deepEqual(r.product.spec, { moisture: '6% max', oil: '50% min' });
  const again = await (await req('POST', '/api/products', { token: agri, body: { product: { ...base, description: 'Changed description.' } } })).json();
  assert.deepEqual(again.product.spec, { moisture: '6% max', oil: '50% min' }, 'kept when the form leaves it out');
  const cleared = await (await req('POST', '/api/products', { token: agri, body: { product: { ...base, spec: {} } } })).json();
  assert.deepEqual(cleared.product.spec, {}, 'cleared when sent empty');
  const pub = (await (await req('GET', '/api/products')).json()).find((p) => p.id === 'spec-test-sesame');
  assert.deepEqual(pub.spec, {});
});
