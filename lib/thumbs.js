// Small copies of catalogue photos for places that show them small: the studio's
// bag picker (56 px), related products on a product page, the teams' lists.
//
//   GET /thumb/<width>/<path of the photo>   width: 120, 240 or 480
//
// Only photos in the catalogue folders are resized (shipped ones and ones the
// teams uploaded), only at these widths, and each is made once with sharp and
// kept in DATA_DIR/thumbs until the photo changes. Anything else is a 404.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { THUMB_WIDTHS, PHOTO_RE } from './thumb-url.js';

export { THUMB_WIDTHS, thumbUrl } from './thumb-url.js';

export function registerThumbs(app, { dataDir, uploadsDir, publicDirs, logError }) {
  const cacheDir = path.join(dataDir, 'thumbs');
  const source = (rel) => {
    if (rel.startsWith('uploads/')) {
      const p = path.join(uploadsDir, rel.slice('uploads/'.length));
      return p.startsWith(uploadsDir + path.sep) && fs.existsSync(p) ? p : null;
    }
    for (const d of publicDirs) {
      const p = path.join(d, rel);
      if (p.startsWith(d + path.sep) && fs.existsSync(p)) return p;
    }
    return null;
  };
  const making = new Map(); // one resize per thumbnail at a time

  app.get(/^\/thumb\/(\d+)\/(.+)$/, async (req, res, next) => {
    const width = Number(req.params[0]), rel = req.params[1];
    if (!THUMB_WIDTHS.includes(width) || !PHOTO_RE.test(rel) || rel.includes('..')) return next();
    const src = source(rel);
    if (!src) return next();
    const out = path.join(cacheDir, String(width), `${rel.replace(/[\\/]/g, '__')}.webp`);
    try {
      const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;
      if (!fresh) {
        if (!making.has(out)) {
          making.set(out, (async () => {
            fs.mkdirSync(path.dirname(out), { recursive: true });
            const tmp = `${out}.${process.pid}.tmp`;
            await sharp(src).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78, alphaQuality: 90 }).toFile(tmp);
            fs.renameSync(tmp, out);
          })().finally(() => making.delete(out)));
        }
        await making.get(out);
      }
      res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=2592000', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(out).pipe(res);
    } catch (e) {
      logError('thumbnail_failed', e, { rel, width });
      res.redirect(302, `/${rel}`); // the full photo still shows
    }
  });
}
