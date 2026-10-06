// Small copies of catalogue photos: only catalogue photos, only the set widths,
// made once and kept until the photo changes; anything else is a 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { thumbUrl, thumbSet, thumbSrcset } from '../lib/thumb-url.js';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-thumbs-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
const { app } = await import('../server.js');

let server, base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server?.close());

test('thumbnail addresses only for catalogue photos at the set widths (self-check)', () => {
  assert.equal(thumbUrl('/products/photos/coffee.webp', 120), '/thumb/120/products/photos/coffee.webp');
  assert.equal(thumbUrl('/uploads/packaging/bag-light-1.webp', 480), '/thumb/480/uploads/packaging/bag-light-1.webp');
  assert.equal(thumbUrl('/logo.png', 120), '/logo.png', 'not a catalogue photo: unchanged');
  assert.equal(thumbUrl('/products/photos/coffee.webp', 130), '/products/photos/coffee.webp', 'not a set width: unchanged');
  assert.equal(thumbUrl(null, 120), null);
  assert.equal(thumbSet('/products/photos/coffee.webp', 56), '/thumb/120/products/photos/coffee.webp 1x, /thumb/120/products/photos/coffee.webp 2x');
  assert.equal(thumbSrcset('/products/photos/coffee.webp'), '/thumb/240/products/photos/coffee.webp 240w, /thumb/480/products/photos/coffee.webp 480w, /thumb/640/products/photos/coffee.webp 640w, /products/photos/coffee.webp 800w');
  assert.equal(thumbSrcset('/logo.png'), null, 'not a catalogue photo: no srcset');
  assert.equal(thumbSet('/logo.png', 56), null);
});

test('a catalogue photo comes back as a small WebP, made once and kept', async () => {
  const r = await fetch(`${base}/thumb/120/products/photos/coffee.webp`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.equal(meta.width, 120);
  assert.ok(buf.length < fs.statSync(path.join(process.cwd(), 'public/products/photos/coffee.webp')).size / 5, 'much smaller than the photo');
  const cached = path.join(tmp, 'thumbs', '120', 'products__photos__coffee.webp.webp');
  assert.ok(fs.existsSync(cached), 'kept in DATA_DIR/thumbs');
  const t = fs.statSync(cached).mtimeMs;
  assert.equal((await fetch(`${base}/thumb/120/products/photos/coffee.webp`)).status, 200);
  assert.equal(fs.statSync(cached).mtimeMs, t, 'not made again');
});

test('anything else is a 404', async () => {
  for (const p of [
    '/thumb/130/products/photos/coffee.webp',     // not a set width
    '/thumb/120/products/photos/missing.webp',    // no such photo
    '/thumb/120/logo.png',                         // not a catalogue folder
    '/thumb/120/products/photos/..%2F..%2Fserver.js',
    '/thumb/120/uploads/packaging/..%2F..%2Fteam.json',
    '/thumb/99999/products/photos/coffee.webp',
  ]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
    assert.notEqual(r.headers.get('content-type'), 'image/webp', p);
  }
});
