// Certifications with proof: what the website shows depends on the document
// behind each certification, its validity, and who may change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { certStatus, cleanCertification, sniffCertificate, EXPIRY_WARNING_DAYS } from '../lib/certificates.js';

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
