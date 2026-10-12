import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { precompressDir, pickEncoding, servePrecompressed, MIN_BYTES } from '../lib/precompressed.js';

// The built site's compressed copies (fresh-eyes review FR-S4): written once at build
// time, sent to browsers that accept them, with the right type, never from outside
// dist, and never when the page was rewritten after its copy was made.

function site() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-pre-'));
  const page = '<!doctype html><title>x</title>' + 'Olira packaging '.repeat(400);
  fs.mkdirSync(path.join(dir, 'packaging'));
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  fs.writeFileSync(path.join(dir, 'packaging', 'index.html'), page);
  fs.mkdirSync(path.join(dir, '_astro'));
  fs.writeFileSync(path.join(dir, '_astro', 'app.js'), 'console.log("olira");\n'.repeat(300));
  fs.writeFileSync(path.join(dir, 'tiny.css'), 'a{}');
  fs.writeFileSync(path.join(dir, 'photo.webp'), Buffer.alloc(4000, 7));
  return { dir, page };
}

function serve(dir) {
  const app = express();
  app.use(servePrecompressed(dir));
  app.use(express.static(dir));
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
function get(server, url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('the browser\'s choice: Brotli first, then gzip, and q=0 refuses', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding('*'), 'br');
});

test('the build writes copies of text files only, and only when they are worth it', () => {
  const { dir } = site();
  const r = precompressDir(dir);
  assert.equal(r.files, 3, 'two pages and one script');
  for (const f of ['index.html', 'packaging/index.html', '_astro/app.js']) {
    assert.ok(fs.existsSync(path.join(dir, `${f}.br`)) && fs.existsSync(path.join(dir, `${f}.gz`)), f);
  }
  assert.equal(fs.existsSync(path.join(dir, 'tiny.css.br')), false, `under ${MIN_BYTES} bytes`);
  assert.equal(fs.existsSync(path.join(dir, 'photo.webp.br')), false, 'images are compressed already');
  assert.ok(r.br < r.before / 3, `a third or less (${r.br} of ${r.before})`);
});

test('a page is sent compressed, with its own type, and decodes to the page', async () => {
  const { dir, page } = site();
  precompressDir(dir);
  const s = await serve(dir);
  try {
    const br = await get(s, '/packaging/', { 'accept-encoding': 'gzip, br' });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(br.headers['content-type'], /^text\/html/);
    assert.match(br.headers.vary, /Accept-Encoding/);
    assert.equal(br.headers['cache-control'], 'public, max-age=0', 'checked every time, as express.static would send it');
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), page);
    const gz = await get(s, '/_astro/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.match(gz.headers['content-type'], /javascript/);
    const plain = await get(s, '/', {});
    assert.equal(plain.headers['content-encoding'], undefined, 'no Accept-Encoding: the file itself');
    assert.equal(plain.body.toString(), page);
    const again = await get(s, '/packaging/', { 'accept-encoding': 'br', 'if-none-match': br.headers.etag });
    assert.equal(again.status, 304, 'a browser that has it is told so');
  } finally { s.close(); }
});

test('nothing outside dist, and a page rewritten after the build is sent as it is now', async () => {
  const { dir, page } = site();
  precompressDir(dir);
  // a page and its copy beside dist, not in it: only the path check stands in the way
  const outside = path.join(path.dirname(dir), `olira-outside-${path.basename(dir)}.html`);
  fs.writeFileSync(outside, 'KEEP-OUT-CONTENT');
  fs.writeFileSync(`${outside}.br`, zlib.brotliCompressSync(Buffer.from('KEEP-OUT-CONTENT')));
  const s = await serve(dir);
  try {
    const out = await get(s, `/..%2F${path.basename(outside)}`, { 'accept-encoding': 'br' });
    assert.notEqual(out.headers['content-encoding'], 'br');
    assert.doesNotMatch(out.body.toString(), /KEEP-OUT-CONTENT/);
    const later = Date.now() / 1000 + 60;
    fs.writeFileSync(path.join(dir, 'index.html'), 'rewritten ' + page);
    fs.utimesSync(path.join(dir, 'index.html'), later, later);
    const now = await get(s, '/', { 'accept-encoding': 'br' });
    assert.equal(now.headers['content-encoding'], undefined, 'the stale copy is not sent');
    assert.match(now.body.toString(), /^rewritten /);
  } finally { s.close(); }
});
