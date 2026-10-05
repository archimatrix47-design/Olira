// The agriculture enquiry's own fields: volume (MT), destination port, Incoterm
// and shipment window. Validated by the server, stored on the lead, read by the
// inbox, the lead score and the CSV; older enquiries keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanAgriTerms, INCOTERMS } from '../lib/enquiry.js';
import { detailsOf, scoreOf, termChips } from '../src/scripts/admin/leads.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-enquiry-'));
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
const send = (body) => fetch(`${base}/api/inquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hana', email: 'hana@importer.example', website: '', ...body }) });
const stored = () => JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8'));

test('terms are read and checked (self-check of the reader)', () => {
  assert.deepEqual(cleanAgriTerms({ volumeMt: '500', port: '  Rotterdam ', incoterm: 'CIF', window: 'March 2027' }).terms, { volumeMt: 500, port: 'Rotterdam', incoterm: 'CIF', window: 'March 2027' });
  assert.deepEqual(cleanAgriTerms({ volumeMt: 2.5 }).terms, { volumeMt: 2.5 });
  assert.deepEqual(cleanAgriTerms({}).terms, {}, 'every field is optional');
  for (const v of ['0', '-5', '1e3', '100001', 'lots', '1,000']) assert.equal(cleanAgriTerms({ volumeMt: v }).field, 'volumeMt', `volume ${v} is refused`);
  assert.equal(cleanAgriTerms({ incoterm: 'DDP' }).field, 'incoterm', 'only the listed Incoterms');
  assert.ok(INCOTERMS.includes('FOB Djibouti'));
  assert.equal(cleanAgriTerms({ port: { $gt: '' } }).field, 'port');
});

test('an agriculture enquiry stores its terms; a named product can stand in for the message', async () => {
  const r = await send({ product: 'Humera sesame', line: 'agri', message: '', volumeMt: '500', port: 'Rotterdam', incoterm: 'CIF', window: 'March 2027' });
  assert.equal(r.status, 200, await r.clone().text());
  const lead = stored()[0];
  assert.equal(lead.product, 'Humera sesame');
  assert.equal(lead.line, 'agri');
  assert.deepEqual([lead.volumeMt, lead.port, lead.incoterm, lead.window], [500, 'Rotterdam', 'CIF', 'March 2027']);
  assert.equal(lead.message, '');
});

test('without a named product the message is still required', async () => {
  for (const product of ['Agricultural products', 'Other', 'Several products', '']) {
    const r = await send({ product, line: 'agri', message: '', volumeMt: '20' });
    assert.equal(r.status, 400, `product "${product}" with no message`);
  }
  assert.equal((await send({ product: 'Other', line: 'agri', message: 'Niger seed, 40 MT, conventional.' })).status, 200);
  // packaging keeps its required message
  assert.equal((await send({ product: 'Packaging', line: 'pack', message: '' })).status, 400);
});

test('bad terms are refused with the field to fix, and packaging ignores them', async () => {
  const bad = await send({ product: 'Pulses', line: 'agri', message: 'Red kidney beans', incoterm: 'DDP' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'Choose an Incoterm from the list.', code: 'invalid_field', field: 'incoterm' });
  const vol = await send({ product: 'Pulses', line: 'agri', message: 'Red kidney beans', volumeMt: '-3' });
  assert.equal(vol.status, 400);
  assert.equal((await vol.json()).field, 'volumeMt');
  assert.equal((await send({ product: 'Packaging', line: 'pack', message: 'Quantity: 20000\n\nFlat handle bags', volumeMt: '9', incoterm: 'CIF' })).status, 200);
  const pack = stored()[0];
  assert.equal(pack.line, 'pack');
  assert.equal(pack.volumeMt, undefined, 'packaging leads carry no agriculture terms');
  assert.equal(pack.incoterm, undefined);
});

test('the inbox, the score and the CSV read new and old enquiries alike', () => {
  const now = { product: 'Humera sesame', volumeMt: 500, port: 'Rotterdam', incoterm: 'CIF', window: 'March 2027', message: '', email: 'b@importer.nl', company: 'Importer BV', phone: '+31 20 123 4567' };
  const d = detailsOf(now);
  assert.deepEqual([d.volume, d.port, d.incoterm, d.window], ['500 MT', 'Rotterdam', 'CIF', 'March 2027']);
  assert.deepEqual(termChips(now), ['500 MT', 'CIF Rotterdam', 'March 2027']);
  assert.deepEqual(termChips({ ...now, incoterm: 'FOB Djibouti' }), ['500 MT', 'FOB Djibouti', 'March 2027'], 'FOB Djibouti names its own port');
  const sc = scoreOf(now);
  assert.equal(sc.score, 100, 'company, business email, phone code, product, volume, port, terms');
  assert.ok(sc.checks.some((c) => c.ok && c.label === 'Terms given (CIF, March 2027)'));
  // an enquiry from before the fields: the port and quantity were written into the message
  const old = { product: 'Agricultural products', message: 'Destination port: Jeddah\nQuantity: 40 MT\n\nSesame please', email: 'x@gmail.com' };
  assert.deepEqual([detailsOf(old).port, detailsOf(old).volume, detailsOf(old).incoterm], ['Jeddah', '40 MT', null]);
  assert.ok(scoreOf(old).checks.some((c) => !c.ok && c.label === 'Short message'));
});
