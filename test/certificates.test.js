// Certifications with proof: what the website shows depends on the document
// behind each certification, its validity, and who may change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { certStatus, cleanCertification, sniffCertificate, EXPIRY_WARNING_DAYS, reminderStage, dueReminders, createReminderCheck } from '../lib/certificates.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-certs-'));
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
const req = (method, p, { token, body, form } = {}) => fetch(base + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
const adminToken = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
const day = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

test('status follows the proof and the dates (self-check of the rules)', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  assert.equal(certStatus({ name: 'A' }, now), 'no-proof');
  assert.equal(certStatus({ file: '/uploads/certificates/a-1.pdf' }, now), 'valid');
  assert.equal(certStatus({ file: '/uploads/certificates/a-1.pdf', validUntil: iso(now + (EXPIRY_WARNING_DAYS - 1) * day) }, now), 'expiring');
  assert.equal(certStatus({ file: '/uploads/certificates/a-1.pdf', validUntil: iso(now + (EXPIRY_WARNING_DAYS + 5) * day) }, now), 'valid');
  assert.equal(certStatus({ file: '/uploads/certificates/a-1.pdf', validUntil: '2026-09-29' }, now), 'expired');
  assert.equal(certStatus({ validUntil: '2026-09-29' }, now), 'expired', 'expired wins over missing proof: it must come off the site');
});

test('records are validated: dates, register link, and only files the server stored', () => {
  assert.ok(cleanCertification({ name: '' }).error);
  assert.ok(cleanCertification({ name: 'ISO 22000', validUntil: '2027-13-40' }).error);
  assert.ok(cleanCertification({ name: 'ISO 22000', validFrom: '2027-01-01', validUntil: '2026-01-01' }).error);
  assert.ok(cleanCertification({ name: 'ISO 22000', verifyUrl: 'javascript:alert(1)' }).error);
  assert.ok(cleanCertification({ name: 'ISO 22000', verifyUrl: 'http://example.org' }).error, 'register links must be https');
  assert.ok(cleanCertification({ name: 'ISO 22000', file: '/uploads/certificates/../../server.js' }).error);
  assert.ok(cleanCertification({ name: 'ISO 22000', file: 'https://evil.example/x.pdf' }).error);
  const ok = cleanCertification({ name: 'ISO 22000:2018', issuer: 'Bureau Example', number: 'FS 123', validFrom: '2025-01-01', validUntil: '2028-01-01', verifyUrl: 'https://example.org/verify?id=FS123', file: '/uploads/certificates/iso-22000-1.pdf' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.cert.fileType, 'pdf');
  assert.equal(ok.cert.id, 'iso-22000-2018');
});

test('files are recognised by their bytes, not their names (self-check)', async () => {
  assert.equal(sniffCertificate(Buffer.from('%PDF-1.7\n1 0 obj')), 'pdf');
  assert.equal(sniffCertificate(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()), 'image');
  assert.equal(sniffCertificate(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniffCertificate(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00')), null);
});

test('the admin uploads a certificate and its details; the public list says what to show', async () => {
  const admin = await adminToken();
  const pdf = Buffer.from('%PDF-1.4\n% test certificate\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');
  const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'iso.pdf'); fd.append('name', 'ISO 22000');
  assert.equal((await req('POST', '/api/certifications/file', { form: fd })).status, 401, 'signed out: refused');
  const up = await (await req('POST', '/api/certifications/file', { token: admin, form: fd })).json();
  assert.match(up.path, /^\/uploads\/certificates\/iso-22000-\d+\.pdf$/);
  // the stored file is public proof, served as a PDF
  const served = await fetch(base + up.path);
  assert.equal(served.status, 200);
  const fake = new FormData(); fake.append('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'application/pdf' }), 'cert.pdf');
  assert.equal((await req('POST', '/api/certifications/file', { token: admin, form: fake })).status, 400, 'a file that is not a PDF or image is refused');
  // an SVG is an image the converter would accept, but it can carry scripts: only PDF, JPG, PNG and WebP
  const svg = new FormData(); svg.append('file', new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')], { type: 'image/svg+xml' }), 'cert.svg');
  assert.equal((await req('POST', '/api/certifications/file', { token: admin, form: svg })).status, 400, 'an SVG is refused');

  const later = iso(Date.now() + 400 * day), soon = iso(Date.now() + 20 * day);
  const save = (c) => req('POST', '/api/certifications', { token: admin, body: { certification: c } });
  assert.equal((await save({ name: 'Test ISO 22000', issuer: 'Bureau Example', number: 'FS 123', validUntil: later, file: up.path, verifyUrl: 'https://example.org/verify' })).status, 200);
  assert.equal((await save({ name: 'Test GMP', validUntil: soon, file: up.path })).status, 200);
  assert.equal((await save({ name: 'Test organic' })).status, 200);
  assert.equal((await save({ name: 'Test old licence', validUntil: '2020-01-01' })).status, 200);
  const list = await (await fetch(base + '/api/certifications')).json();
  const by = Object.fromEntries(list.filter((c) => c.name.startsWith('Test ')).map((c) => [c.name, c.status]));
  assert.deepEqual(by, { 'Test ISO 22000': 'valid', 'Test GMP': 'expiring', 'Test organic': 'no-proof', 'Test old licence': 'expired' });

  // a team account cannot change them
  const m = await (await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Mgr', email: 'mgr.cert@example.com', role: 'manager', password: 'manager-password-1' } } })).json();
  const t = (await (await req('POST', '/api/team/login', { body: { email: 'mgr.cert@example.com', password: 'manager-password-1' } })).json()).token;
  assert.ok(m.success && t);
  assert.equal((await req('POST', '/api/certifications', { token: t, body: { certification: { name: 'Fake' } } })).status, 403);

  // replacing the proof removes the old file once nothing uses it; deleting removes the record and its file
  const iso1 = list.find((c) => c.name === 'Test ISO 22000');
  assert.equal((await req('DELETE', `/api/certifications/${iso1.id}`, { token: admin })).status, 200);
  assert.equal((await fetch(base + up.path)).status, 200, 'still used by GMP, so the file stays');
  const gmp = list.find((c) => c.name === 'Test GMP');
  assert.equal((await req('DELETE', `/api/certifications/${gmp.id}`, { token: admin })).status, 200);
  assert.equal((await fetch(base + up.path)).status, 404, 'no longer used: the file is gone');
});

/* ---------------- reminders by email (fixed clock) ---------------- */
const at = (d) => Date.parse(`${d}T09:00:00Z`);

test('reminder stages: 60, 30 and 7 days before, then the day it expires (self-check)', () => {
  const c = { id: 'x', name: 'X', validUntil: '2027-03-31' };
  assert.equal(reminderStage(c, at('2027-01-01')), null, '89 days left: nothing yet');
  assert.equal(reminderStage(c, at('2027-01-31')), 'd60');
  assert.equal(reminderStage(c, at('2027-03-01')), 'd60', '31 days left');
  assert.equal(reminderStage(c, at('2027-03-02')), 'd30');
  assert.equal(reminderStage(c, at('2027-03-24')), 'd30', '8 days left');
  assert.equal(reminderStage(c, at('2027-03-25')), 'd7');
  assert.equal(reminderStage(c, at('2027-03-31')), 'd7', 'still valid on its last day');
  assert.equal(reminderStage(c, at('2027-04-01')), 'expired');
  assert.equal(reminderStage({ id: 'y', name: 'Y' }, at('2027-04-01')), null, 'no expiry date: no reminders');
  // added late: only the most urgent stage, not every one it passed
  assert.deepEqual(dueReminders([c], {}, at('2027-03-28')).map((r) => r.stage), ['d7']);
  // a renewal (new expiry date) starts again
  assert.deepEqual(dueReminders([{ ...c, validUntil: '2028-03-31' }], { x: { validUntil: '2027-03-31', stage: 'expired' } }, at('2028-02-01')).map((r) => r.stage), ['d60']);
});

test('each reminder is emailed once to the inbox and the managers; a failed send is tried again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-remind-'));
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const wj = (f, v) => { fs.writeFileSync(f, JSON.stringify(v)); return true; };
  wj(path.join(dir, 'certifications.json'), [
    { id: 'iso', name: 'ISO 22000', issuer: 'Bureau <Example>', number: 'FS 1', validUntil: '2027-03-31', file: '/uploads/certificates/iso-1.pdf' },
    { id: 'org', name: 'Organic', validUntil: null },
  ]);
  const mails = [];
  let fail = false;
  const send = async (to, subject, html, extra) => { if (fail) throw new Error('smtp down'); mails.push({ to, subject, html, text: extra.text }); };
  const check = createReminderCheck({ dataDir: dir, readJsonFile: rj, writeJsonFile: wj, send, recipients: () => ['info@olira.example', 'Boss@Olira.example', 'boss@olira.example', '', null], siteUrl: () => 'https://olira.example' });

  assert.deepEqual((await check(at('2027-01-01'))).sent, [], 'nothing due yet');
  assert.deepEqual((await check(at('2027-01-31'))).sent, [{ id: 'iso', stage: 'd60' }]);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'info@olira.example, boss@olira.example', 'the inbox and each manager, once each');
  assert.equal(mails[0].subject, 'ISO 22000 expires in 60 days');
  assert.match(mails[0].html, /Bureau &lt;Example&gt;/, 'saved text is escaped in the email');
  assert.match(mails[0].html, /https:\/\/olira\.example\/admin\/#certifications/);
  assert.deepEqual((await check(at('2027-02-01'))).sent, [], 'not sent twice');
  assert.deepEqual((await check(at('2027-02-15'))).sent, [], 'still not twice');

  fail = true;
  const before = mails.length;
  assert.deepEqual((await check(at('2027-03-02'))).sent, [], 'the 30-day send failed');
  assert.equal(mails.length, before);
  fail = false;
  assert.deepEqual((await check(at('2027-03-03'))).sent, [{ id: 'iso', stage: 'd30' }], 'and is tried again');
  assert.deepEqual((await check(at('2027-03-25'))).sent, [{ id: 'iso', stage: 'd7' }]);
  assert.deepEqual((await check(at('2027-04-01'))).sent, [{ id: 'iso', stage: 'expired' }], 'the last notice, on the day it comes off');
  assert.equal(mails.at(-1).subject, 'ISO 22000 has expired and is off the website');
  assert.deepEqual((await check(at('2027-05-01'))).sent, [], 'and nothing after');
  assert.equal(mails.length, 4);

  // no one to tell: nothing is recorded, so it goes when there is
  wj(path.join(dir, 'certifications.json'), [{ id: 'gmp', name: 'GMP', validUntil: '2027-06-10' }]);
  const silent = createReminderCheck({ dataDir: dir, readJsonFile: rj, writeJsonFile: wj, send, recipients: () => [], siteUrl: () => 'https://olira.example' });
  assert.equal((await silent(at('2027-06-05'))).skipped, 'no recipients');
  assert.deepEqual((await check(at('2027-06-05'))).sent, [{ id: 'gmp', stage: 'd7' }]);
  assert.equal(rj(path.join(dir, 'certificate-reminders.json'), {}).iso, undefined, 'a removed certificate is forgotten');
});

/* ---------------- certificates attached to a team's reply ---------------- */
test('a team can attach only certificates with a file that have not expired', async () => {
  const { certificateAttachment } = await import('../lib/certificates.js');
  assert.equal(certificateAttachment({ name: 'X' }, process.env.UPLOADS_DIR), null, 'no file: nothing to send');
  assert.equal(certificateAttachment({ name: 'X', file: '/uploads/certificates/../../team.json' }, process.env.UPLOADS_DIR), null);

  const admin = await adminToken();
  const pdf = Buffer.from('%PDF-1.4\n% reply test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');
  const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'iso.pdf'); fd.append('name', 'Reply ISO');
  const up = await (await req('POST', '/api/certifications/file', { token: admin, form: fd })).json();
  const save = async (c) => (await (await req('POST', '/api/certifications', { token: admin, body: { certification: c } })).json()).certification;
  const good = await save({ name: 'Reply ISO 22000', issuer: 'Bureau Example', validUntil: iso(Date.now() + 300 * day), file: up.path });
  const old = await save({ name: 'Reply old GMP', validUntil: '2020-01-01', file: up.path });
  const a = certificateAttachment(good, process.env.UPLOADS_DIR);
  assert.equal(a.filename, 'Reply ISO 22000 certificate.pdf');
  assert.equal(a.contentType, 'application/pdf');
  assert.equal(certificateAttachment(old, process.env.UPLOADS_DIR), null, 'expired: off the website, so not sent either');

  // an enquiry and an agriculture team member to answer it
  await req('POST', '/api/admin/team', { token: admin, body: { member: { name: 'Agri Reply', email: 'agri.reply@example.com', role: 'agri', password: 'agri-password-12' } } });
  const team = (await (await req('POST', '/api/team/login', { body: { email: 'agri.reply@example.com', password: 'agri-password-12' } })).json()).token;
  assert.equal((await req('POST', '/api/inquiry', { body: { name: 'Buyer', email: 'buyer.cert@example.com', product: 'Sesame', line: 'agri', message: 'Please send your ISO certificate.', website: '' } })).status, 200);
  const lead = (await (await req('GET', '/api/team/inquiries', { token: team })).json()).inquiries.find((l) => l.email === 'buyer.cert@example.com');
  const reply = (certificates) => req('POST', `/api/team/inquiries/${lead.id}/reply`, { token: team, body: { subject: 'Our certificate', body: 'Please find our certificate attached.', certificates } });
  assert.equal((await reply(['no-such-certificate'])).status, 400);
  assert.equal((await reply([old.id])).status, 400, 'an expired certificate is refused at send time');
  // a valid one passes every check; this test server has no mail account, so it stops there
  const ok = await reply([good.id]);
  assert.equal(ok.status, 503);
  assert.equal((await ok.json()).code, 'no_smtp');
});
