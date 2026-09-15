// Packaging products: the bags Olira Packaging sells, managed in the admin like
// the agriculture products. A product with a photo and the four corners of its
// printable panel can also be used in the mockup studio (packaging page) and in
// the packaging team's workspace.
//
// Photos are product shots on a plain white background. A dark theme photo is
// optional and must be the same shot on a black background, so the print
// corners fit both; the upload checks that.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';

const IMAGE_RE = /^\/(uploads\/packaging|images\/packaging\/products)\/[\w.-]+\.(webp|png|jpg)$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

// the corners must make a convex, reasonably large quad
export function validQuad(q) {
  if (!Array.isArray(q) || q.length !== 4) return false;
  if (!q.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  let area = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
  return Math.abs(area) / 2 >= 0.02;
}

/** Brightness of the photo's outer edge: is the background plain white, plain black, or neither? */
export async function backgroundOf(buffer) {
  const { data, info } = await sharp(buffer).resize({ width: 200, height: 200, fit: 'inside' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const band = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 6 || y < 6 || x >= w - 6 || y >= h - 6) band.push(data[y * w + x]);
  band.sort((a, b) => a - b);
  const median = band[Math.floor(band.length / 2)];
  const p10 = band[Math.floor(band.length * 0.1)], p90 = band[Math.floor(band.length * 0.9)];
  const tone = median >= 200 && p10 >= 170 ? 'light' : median <= 60 && p90 <= 90 ? 'dark' : 'mixed';
  return { tone, median, spread: p90 - p10 };
}

/**
 * How alike two photos are in shape: edge strength on a 64 x 64 grid, compared
 * with a correlation. The same shot on white and on black scores high because
 * the product's outline and folds are in the same places.
 */
export async function sameShotScore(a, b) {
  const edges = async (buf) => {
    const { data } = await sharp(buf).resize(64, 64, { fit: 'fill' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    const out = new Float32Array(62 * 62);
    for (let y = 1; y < 63; y++) for (let x = 1; x < 63; x++) {
      const p = (xx, yy) => data[yy * 64 + xx];
      const gx = p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x - 1, y) - p(x - 1, y + 1);
      const gy = p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x, y - 1) - p(x + 1, y - 1);
      out[(y - 1) * 62 + (x - 1)] = Math.hypot(gx, gy);
    }
    return out;
  };
  const [ea, eb] = await Promise.all([edges(a), edges(b)]);
  const n = ea.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += ea[i]; mb += eb[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ea[i] - ma, y = eb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function registerPackaging(app, ctx) {
  const { dataDir, uploadsDir, publicDirs, readJsonFile, writeJsonFile, audit, logError, adminAuth, resolveUser } = ctx;
  const storePath = path.join(dataDir, 'packaging-products.json');
  const imagesDir = path.join(uploadsDir, 'packaging');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const read = () => { const l = readJsonFile(storePath, []); return Array.isArray(l) ? l : []; };
  const inStudio = (p) => !!(p.image && validQuad(p.quad));
  const publicShape = (p) => ({
    id: p.id, name: p.name, handle: p.handle || '', description: p.description || '', moq: p.moq || '', specs: p.specs || [],
    image: p.image || null, imageDark: p.imageDark || null, width: p.width, height: p.height,
    quad: inStudio(p) ? p.quad : null, safeTop: p.safeTop ?? 0.1,
  });
  const fileFor = (image) => {
    if (image.startsWith('/uploads/packaging/')) { const p = path.join(imagesDir, path.basename(image)); return fs.existsSync(p) ? p : null; }
    for (const d of publicDirs) { const p = path.join(d, image.replace(/^\//, '')); if (fs.existsSync(p)) return p; }
    return null;
  };

  // public: products for the packaging page. ?scope=team for the packaging team, ?scope=all for the administrator
  app.get('/api/packaging-products', (req, res) => {
    const list = read();
    const scope = req.query.scope;
    if (scope === 'team' || scope === 'all') {
      const r = resolveUser(req);
      if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
      if (scope === 'all') {
        if (r.user.role !== 'admin') return res.status(403).json({ error: 'Only the administrator can see every product.' });
        return res.json(list);
      }
      if (!['admin', 'pack'].includes(r.user.role)) return res.status(403).json({ error: 'Packaging products are for the packaging team.' });
      return res.json(list.filter((p) => p.team !== false).map(publicShape));
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json(list.filter((p) => p.site !== false).map(publicShape));
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 6 },
    fileFilter: (req, file, cb) => (['image/png', 'image/webp', 'image/jpeg'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Use a JPG, PNG or WebP photo.'))),
  }).single('image');

  // POST /api/admin/packaging-products/image
  //   image, variant ('light' | 'dark'), and for a dark photo: light (path of the white photo)
  app.post('/api/admin/packaging-products/image', adminAuth, (req, res) => upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The photo can be up to 15 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a photo.' });
    const variant = req.body?.variant === 'dark' ? 'dark' : 'light';
    try {
      const meta = await sharp(req.file.buffer, { failOn: 'error' }).rotate().metadata();
      const bg = await backgroundOf(await sharp(req.file.buffer).rotate().toBuffer());
      let warning = null;
      if (variant === 'light' && bg.tone !== 'light') {
        warning = 'The background does not look plain white. The studio looks best with the bag photographed on white paper or a white wall in even light.';
      }
      if (variant === 'dark') {
        const light = typeof req.body?.light === 'string' && IMAGE_RE.test(req.body.light) ? fileFor(req.body.light) : null;
        if (!light) return res.status(400).json({ error: 'Add the white background photo first.' });
        const lm = await sharp(light).metadata();
        const w = meta.orientation >= 5 ? meta.height : meta.width, hgt = meta.orientation >= 5 ? meta.width : meta.height;
        if (Math.abs(w / hgt - lm.width / lm.height) > 0.01) {
          return res.status(422).json({ code: 'not_same_shot', error: 'The dark photo has a different shape from the white one. It must be the same shot, cropped the same way, so the print lines up.' });
        }
        if (bg.tone !== 'dark') {
          return res.status(422).json({ code: 'not_dark', error: 'The background of this photo is not plain black. Leave the dark photo out and the white one is used in dark mode too.' });
        }
        const score = await sameShotScore(await sharp(req.file.buffer).rotate().toBuffer(), light);
        if (score < 0.6) {
          return res.status(422).json({ code: 'not_same_shot', error: 'This does not look like the same shot as the white photo. Use the identical photo on a black background, or leave it out.', score });
        }
      }
      const base = `${(clean(req.body?.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bag')}-${variant}-${Date.now()}`;
      const file = path.join(imagesDir, `${base}.webp`);
      const info = await sharp(req.file.buffer).rotate().resize({ width: 1400, height: 2000, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: variant === 'dark' ? '#000000' : '#ffffff' })
        .webp({ quality: 88, effort: 5 }).toFile(file);
      audit('packaging_image_uploaded', req, { file: path.basename(file), variant });
      res.json({ success: true, path: `/uploads/packaging/${base}.webp`, width: info.width, height: info.height, background: bg.tone, warning });
    } catch (e) {
      logError('packaging_image_failed', e);
      res.status(400).json({ error: 'The photo could not be read. Try a JPG or PNG.' });
    }
  }));

  app.post('/api/admin/packaging-products', adminAuth, (req, res) => {
    const b = req.body?.product || {};
    const name = clean(b.name, 120);
    if (!name) return res.status(400).json({ error: 'Give the product a name, for example "Twisted handle bags".' });
    const description = clean(b.description, 1000);
    if (!description) return res.status(400).json({ error: 'Add a short description for the packaging page.' });
    const image = typeof b.image === 'string' && b.image ? b.image : null;
    const imageDark = typeof b.imageDark === 'string' && b.imageDark ? b.imageDark : null;
    if (image && (!IMAGE_RE.test(image) || !fileFor(image))) return res.status(400).json({ error: 'Upload the photo again.' });
    if (imageDark && (!image || !IMAGE_RE.test(imageDark) || !fileFor(imageDark))) return res.status(400).json({ error: 'Upload the dark photo again, after the white one.' });
    const quad = b.quad == null ? null : b.quad;
    if (quad && !validQuad(quad)) return res.status(400).json({ error: 'Place the four corners on the printable panel. They must form a four-sided shape that is not twisted.' });
    const specs = (Array.isArray(b.specs) ? b.specs : []).map((s) => clean(s, 200)).filter(Boolean).slice(0, 12);
    const safeTop = Number(b.safeTop);
    const list = read();
    const now = new Date().toISOString();
    let p = b.id ? list.find((x) => x.id === b.id) : null;
    if (b.id && !p) return res.status(404).json({ error: 'Product not found.' });
    if (!p) { p = { id: `pk_${crypto.randomBytes(5).toString('hex')}`, createdAt: now }; list.push(p); }
    const old = [p.image, p.imageDark];
    Object.assign(p, {
      name, handle: clean(b.handle, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''), description, moq: clean(b.moq, 60), specs,
      image, imageDark: image ? imageDark : null,
      width: image ? Math.max(1, Math.round(Number(b.width) || p.width || 1000)) : null,
      height: image ? Math.max(1, Math.round(Number(b.height) || p.height || 1400)) : null,
      quad: image && quad ? quad.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]) : null,
      safeTop: Number.isFinite(safeTop) ? Math.min(0.4, Math.max(0, safeTop)) : 0.1,
      site: b.site !== false, team: b.team !== false, updatedAt: now,
    });
    if (!writeJsonFile(storePath, list)) return res.status(500).json({ error: 'The product could not be saved.' });
    old.forEach((img) => removeImageIfUnused(img, list));
    audit('packaging_product_saved', req, { id: p.id });
    res.json({ success: true, product: p });
  });

  app.post('/api/admin/packaging-products/order', adminAuth, (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return res.status(400).json({ error: 'Body must be { ids: [string, ...] }' });
    const list = read(), byId = new Map(list.map((p) => [p.id, p])), seen = new Set(), ordered = [];
    for (const id of ids) if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
    for (const p of list) if (!seen.has(p.id)) ordered.push(p);
    if (!writeJsonFile(storePath, ordered)) return res.status(500).json({ error: 'The order could not be saved.' });
    res.json({ success: true, ids: ordered.map((p) => p.id) });
  });

  app.delete('/api/admin/packaging-products/:id', adminAuth, (req, res) => {
    const list = read(), p = list.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    const next = list.filter((x) => x.id !== p.id);
    if (!writeJsonFile(storePath, next)) return res.status(500).json({ error: 'The product could not be deleted.' });
    [p.image, p.imageDark].forEach((img) => removeImageIfUnused(img, next));
    audit('packaging_product_deleted', req, { id: p.id });
    res.json({ success: true });
  });

  // uploaded photos only; the photos shipped with the site stay
  function removeImageIfUnused(image, list) {
    if (!image || !image.startsWith('/uploads/packaging/') || list.some((x) => x.image === image || x.imageDark === image)) return;
    try { fs.rmSync(path.join(imagesDir, path.basename(image)), { force: true }); } catch (e) { logError('packaging_image_remove_failed', e); }
  }
}
