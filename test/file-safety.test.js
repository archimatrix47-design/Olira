// Files from outside made safe to keep (lib/file-safety.js) and text cleaned at the door
// (cleanDeep in lib/site-basics.js). White-hat round, 23 Nov 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { stripImageMetadata, pdfActiveContent, SHARP_SAFE } from '../lib/file-safety.js';
import { cleanDeep } from '../lib/site-basics.js';

const picture = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#186078' } });
const pixels = (buf) => sharp(buf).raw().toBuffer();

test('JPEG, PNG and WebP lose their metadata and hidden tails, and keep every pixel', async () => {
  const cases = [
    ['jpg', Buffer.concat([await picture().jpeg().withExif({ IFD0: { Artist: 'Secret Person' } }).toBuffer(), Buffer.from('PK\u0003\u0004hidden payload')])],
    ['png', Buffer.concat([await picture().png().withExif({ IFD0: { Artist: 'Secret Person' } }).toBuffer(), Buffer.from('hidden payload')])],
    ['webp', await picture().webp().withExif({ IFD0: { Artist: 'Secret Person' } }).toBuffer()],
  ];
  for (const [ext, buf] of cases) {
    assert.ok(buf.includes('Secret Person'), `${ext}: the sample carries metadata`);
    const out = stripImageMetadata(buf, ext);
    assert.ok(!out.includes('Secret Person'), `${ext}: metadata gone`);
    assert.ok(!out.includes('hidden payload'), `${ext}: nothing after the image's end`);
    assert.ok((await pixels(out)).equals(await pixels(buf)), `${ext}: the same pixels`);
    assert.equal((await sharp(out).metadata()).exif, undefined);
  }
  // other kinds, and damaged files, are kept as sent
  const pdf = Buffer.from('%PDF-1.7\n%%EOF');
  assert.equal(stripImageMetadata(pdf, 'pdf'), pdf);
  const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
  assert.equal(stripImageMetadata(broken, 'jpg'), broken);
});

test('a PDF that could run something is found, however it is written; a plain one passes', () => {
  const pdf = (body) => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog ${body} >>\nendobj\n%%EOF\n`, 'latin1');
  assert.equal(pdfActiveContent(pdf('/Pages 2 0 R /PageMode /UseNone')), null);
  assert.equal(pdfActiveContent(pdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>')), 'JavaScript');
  assert.equal(pdfActiveContent(pdf('/OpenAction << /S /J#61vaScript >>')), 'JavaScript', 'a #xx-escaped name');
  assert.equal(pdfActiveContent(pdf('/OpenAction << /S /Launch /F (cmd.exe) >>')), 'Launch');
  assert.equal(pdfActiveContent(pdf('/Names << /EmbeddedFiles 3 0 R >>')), 'EmbeddedFiles');
  const z = zlib.deflateSync(Buffer.from('<< /S /JavaScript /JS (x) >>'));
  const hidden = Buffer.concat([Buffer.from(`%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);
  assert.equal(pdfActiveContent(hidden), 'JavaScript', 'inside a compressed object stream');
});

test('a small file claiming an enormous picture is refused before it is decoded', async () => {
  const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(bomb.length < 2_000_000, 'small on disk');
  await assert.rejects(() => sharp(bomb, SHARP_SAFE).resize(10).toBuffer(), /pixel limit/i);
});

test('text is cleaned at the door: control and direction marks out, prototype keys dropped, passwords untouched', () => {
  const body = JSON.parse('{"name":"Ab\\u202eebe\\u0000\\u0007 Sample","message":"line 1\\r\\nline 2\\ttab","__proto__":{"admin":true},"nested":{"constructor":{"x":1},"title":"Cafe\\u0301"},"newPassword":"keep\\u0007this\\r\\n","list":["a\\u2066b"]}');
  const out = cleanDeep(body);
  assert.equal(out.name, 'Abebe Sample');
  assert.equal(out.message, 'line 1\nline 2\ttab', 'line ends normalised, tabs kept');
  assert.equal(out.nested.title, 'Café', 'one Unicode form');
  assert.ok(!Object.hasOwn(out, '__proto__') && !Object.hasOwn(out.nested, 'constructor'));
  assert.equal(({}).admin, undefined, 'nothing reached the shared prototype');
  assert.equal(out.newPassword, 'keep\u0007this\r\n', 'a password is compared exactly as typed');
  assert.deepEqual(out.list, ['ab']);
});
