// BOX image-upload (part): files from outside made safe to keep. Pictures the site shows are
// redrawn as WebP elsewhere (image-upload.js); these helpers are for what must be kept as
// sent (a buyer's print artwork, a certificate PDF):
//   - a ceiling on decoded pixels for every image the server opens (a small file can claim
//     to be enormous and take all the memory: a "pixel bomb");
//   - camera, GPS, author and text metadata taken out of JPEG, PNG and WebP files without
//     touching a single pixel, and anything hidden after the image's end dropped;
//   - PDFs (and Illustrator files, which are PDFs) checked for scripts, launch actions and
//     attached files, which a PDF reader on a staff computer could run.
// White-hat round, 23 Nov 2026.
import zlib from 'node:zlib';

/** For every sharp() on an uploaded file: about 50 megapixels, far above any photo or logo here. */
export const MAX_INPUT_PIXELS = 50_000_000;
export const SHARP_SAFE = Object.freeze({ limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

/** JPEG: drops APP1 (EXIF, XMP), APP13 (Photoshop, IPTC) and comments; everything else is kept
 *  byte for byte (colour profile APP2, Adobe APP14, the image data). Ends at the image's end. */
export function stripJpegMetadata(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return buf;                 // not the layout we expect: keep the file as sent
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }          // fill byte
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); return Buffer.concat(out); }
    if (marker === 0xda) {                           // start of scan: the image data, up to the last end marker
      const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
      out.push(buf.subarray(i, end > i ? end + 2 : buf.length));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > buf.length) return buf;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    if (!(marker === 0xe1 || marker === 0xed || marker === 0xfe)) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return buf;
}

/** PNG: drops text, EXIF and time chunks (tEXt, zTXt, iTXt, eXIf, tIME) and anything after IEND. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
export function stripPngMetadata(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
  const out = [PNG_SIG];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > buf.length) return buf;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    if (type === 'IEND') return Buffer.concat(out);
    i = end;
  }
  return buf;
}

/** WebP: drops the EXIF and XMP chunks (and clears their flags) and anything after the RIFF end. */
export function stripWebpMetadata(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') return buf;
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const parts = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const id = buf.subarray(i, i + 4).toString('latin1'), size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > riffEnd) return buf;
    if (id !== 'EXIF' && id !== 'XMP ') parts.push(Buffer.from(buf.subarray(i, Math.min(end, riffEnd))));
    i = end;
  }
  const vp8x = parts.find((p) => p.subarray(0, 4).toString('latin1') === 'VP8X');
  if (vp8x) vp8x[8] &= ~0x0c; // the "has EXIF" and "has XMP" flags
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** The file with its metadata taken out, for the kinds sniffFile() names; others as they are. */
export function stripImageMetadata(buf, ext) {
  try {
    if (ext === 'jpg') return stripJpegMetadata(buf);
    if (ext === 'png') return stripPngMetadata(buf);
    if (ext === 'webp') return stripWebpMetadata(buf);
  } catch { /* a damaged file: keep it as sent rather than lose the buyer's artwork */ }
  return buf;
}

// PDF actions that run or open something: scripts, launching programs, attached files, Flash,
// XML forms, submitting or importing data, opening other documents.
const ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData|GoToR|GoToE)(?![A-Za-z0-9])/;
// names may be written with #xx escapes (/J#61vaScript is /JavaScript)
const unescapeNames = (s) => s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** The first active-content name found in a PDF (also inside compressed object streams), or null. */
export function pdfActiveContent(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  const text = buf.toString('latin1');
  let m = ACTIVE.exec(unescapeNames(text));
  if (m) return m[1];
  const STREAM = /stream\r?\n/g;
  let s, n = 0, inflated = 0;
  while ((s = STREAM.exec(text)) && n++ < 5000 && inflated < 200 * 1024 * 1024) {
    const start = s.index + s[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const out = zlib.inflateSync(buf.subarray(start, end), { maxOutputLength: 32 * 1024 * 1024 });
      inflated += out.length;
      m = ACTIVE.exec(unescapeNames(out.toString('latin1')));
      if (m) return m[1];
    } catch { /* not a deflated stream (images are mostly not), or damaged */ }
    STREAM.lastIndex = end + 9;
  }
  return null;
}
