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
// An uploaded product image on a transparent background (a mockup export) is kept
// transparent and named with this marker, so the site can stand it on its own
// background like the shipped cut-outs. The name is made here, never by the client.
const CUTOUT_RE = /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$/;
export const isCutoutPath = (image) => typeof image === 'string' && CUTOUT_RE.test(image);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

// The catalogue's families. Fixed here so the page, the admin and the team tools
// group products the same way; a product's family is one of these ids.
export const FAMILIES = [
  { id: 'bags', label: 'Paper bags', short: 'Paper bags' },
  { id: 'food', label: 'Bakery and food boxes', short: 'Food boxes' },
  { id: 'medical', label: 'Medical packets', short: 'Medical packets' },
  { id: 'foil', label: 'Aluminium foil bags', short: 'Foil bags' },
];
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

// The studio's original three bag sizes, used for bags saved before sizes were per product.
export const LEGACY_SIZES = [
  { id: 'small', label: 'Small', w: 18, d: 8, h: 22 },
  { id: 'medium', label: 'Medium', w: 25, d: 11, h: 32 },
  { id: 'large', label: 'Large', w: 32, d: 12, h: 42 },
];
export const MAX_QTY = 10_000_000;
const MAX_SIZES = 12;

/** A whole number of units, or null when blank or not a positive number. */
export function units(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
  return Number.isInteger(n) && n > 0 && n <= MAX_QTY ? n : null;
}

function cleanSizes(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const label = clean(s.label, 40);
    if (!label) continue;
    let id = clean(s.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, '') || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `s${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    const dim = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 10) / 10 : null; };
    out.push({ id, label, w: dim(s.w), d: dim(s.d), h: dim(s.h), minOrder: units(s.minOrder) });
    if (out.length >= MAX_SIZES) break;
  }
  return out;
}

/**
 * A stored product with every newer field filled in. Records saved before
 * families, sizes and minimum orders existed are read as bags with the studio's
 * three sizes, so live data keeps working without a migration step.
 */
export function normalise(p) {
  const family = FAMILY_IDS.has(p.family) ? p.family : 'bags';
  let sizes = cleanSizes(p.sizes);
  if (!sizes.length && family === 'bags' && !Array.isArray(p.sizes)) sizes = LEGACY_SIZES.map((s) => ({ ...s, minOrder: null }));
  // blank means "no limit set" (the page's default applies); Number(null) would read it as 0, plain
  const blank = p.printColours === null || p.printColours === undefined || p.printColours === '';
  const colours = blank ? NaN : Number(p.printColours);
  return {
    ...p, family, sizes,
    minOrder: units(p.minOrder) ?? units((String(p.moq || '').match(/[\d][\d,\s]*/) || [])[0]),
    printColours: Number.isInteger(colours) && colours >= 0 && colours <= 8 ? colours : null,
  };
}

/** The minimum a buyer may order of this product in this size (the size's own minimum wins). */
export function minimumFor(p, sizeId) {
  const s = sizeId ? p.sizes.find((x) => x.id === sizeId) : null;
  return (s && s.minOrder) || p.minOrder || null;
}

/**
 * Check a quote bundle against the catalogue. Returns { items } with each line
 * resolved to the product's current name and size, or { error } naming the
 * first line that is not allowed. Only products shown on the site can be bundled.
 */
export function checkBundle(raw, catalogue) {
  if (!Array.isArray(raw)) return { error: 'The bundle could not be read. Add the products again.' };
  if (raw.length > 20) return { error: 'A bundle can hold up to 20 lines. Send the rest in a second request.' };
  const byId = new Map(catalogue.filter((p) => p.site !== false).map((p) => [p.id, p]));
  const items = [], seen = new Set();
  for (const r of raw) {
    const p = r && byId.get(r.productId);
    if (!p) return { error: 'A product in your bundle is no longer offered. Remove it and send again.' };
    const size = r.sizeId ? p.sizes.find((s) => s.id === r.sizeId) : null;
    if (r.sizeId && !size) return { error: `The size chosen for ${p.name} is no longer offered. Choose another size.` };
    if (!r.sizeId && p.sizes.length) return { error: `Choose a size for ${p.name}.` };
    const key = `${p.id}/${size?.id || ''}`;
    if (seen.has(key)) return { error: `${p.name}${size ? `, ${size.label}` : ''} is in the bundle twice. Keep one line with the total.` };
    seen.add(key);
    const qty = units(r.qty);
    if (!qty) return { error: `Enter a quantity for ${p.name}.` };
    const min = minimumFor(p, size?.id);
    if (min && qty < min) return { error: `The minimum order for ${p.name}${size ? `, ${size.label}` : ''} is ${min.toLocaleString('en-US')}.`, code: 'below_minimum', productId: p.id, min };
    const colours = r.colours === null || r.colours === undefined || r.colours === '' ? NaN : Number(r.colours);
    items.push({
      productId: p.id, name: p.name, family: p.family,
      sizeId: size?.id || '', size: size ? size.label : '', dims: size && size.w && size.h ? [size.w, size.d, size.h].filter(Boolean).join(' x ') + ' cm' : '',
      qty, minOrder: min,
      colours: Number.isInteger(colours) && colours >= 0 && colours <= 8 && (p.printColours == null || colours <= p.printColours) ? colours : null,
    });
  }
  if (!items.length) return { error: 'The bundle is empty.' };
  return { items };
}

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

/**
 * Is this image a cut-out, a product with no background? True when it has an
 * alpha channel and actually uses it: some pixel is clearly see-through. That
 * holds for a mockup export with transparent margins and for one cropped tight
 * to a rectangular product (only its antialiased edge is see-through); a PNG
 * saved with an alpha channel but fully opaque is a photo.
 */
export async function isTransparentCutout(input) {
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha) return false;
  const { channels } = await sharp(input).ensureAlpha().stats();
  return channels[3].min < 128;
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

// Products that shipped in the first packaging-products.json. A live data folder
// seeded from it already had its chance at these, so they are never re-added.
const FIRST_SEED = ['pk_flat', 'pk_wide', 'pk_twisted'];

/**
 * Add catalogue products that are new in the repo's data file to the live one.
 * Boot only copies whole files that are missing, so without this a live site
 * would never see products added to the catalogue later. Each id is offered
 * once (remembered in packaging-seeded.json), so a product the admin deleted
 * stays deleted. Never changes a product that is already there.
 */
export function mergeSeedCatalogue(dataDir, repoDataDir, { readJsonFile, writeJsonFile, logError }) {
  const livePath = path.join(dataDir, 'packaging-products.json');
  const repoPath = path.join(repoDataDir, 'packaging-products.json');
  const markPath = path.join(dataDir, 'packaging-seeded.json');
  if (path.resolve(livePath) === path.resolve(repoPath) || !fs.existsSync(livePath) || !fs.existsSync(repoPath)) return [];
  try {
    const live = readJsonFile(livePath, []), repo = readJsonFile(repoPath, []);
    if (!Array.isArray(live) || !Array.isArray(repo)) return [];
    const mark = readJsonFile(markPath, null);
    const offered = new Set(Array.isArray(mark?.ids) ? mark.ids : FIRST_SEED);
    const photosOffered = new Set(Array.isArray(mark?.photos) ? mark.photos : []);
    const have = new Set(live.map((p) => p?.id));
    const added = repo.filter((p) => p?.id && !have.has(p.id) && !offered.has(p.id));
    // A photo added to a repo product later reaches a live product that has none,
    // or that still shows one of the stock photos shipped with the site (an older
    // version of it). Only the photo and its print corners are copied, and each
    // photo is offered once: if the admin removes it afterwards it is not put
    // back. A photo the admin uploaded (/uploads/...) is never replaced.
    const repoById = new Map(repo.map((p) => [p?.id, p]));
    const photoFilled = [];
    const shipped = (img) => typeof img === 'string' && img.startsWith('/images/packaging/products/');
    for (const p of live) {
      const r = repoById.get(p?.id);
      if (!r?.image || p.image === r.image || photosOffered.has(`${p.id}:${r.image}`)) continue;
      if (p.image && !shipped(p.image)) continue;
      Object.assign(p, { image: r.image, imageDark: r.imageDark || null, width: r.width, height: r.height, quad: r.quad || null, safeTop: r.safeTop ?? p.safeTop ?? 0.1 });
      photoFilled.push(p.id);
    }
    // A print area corrected in the repo (the photo unchanged) reaches a live product
    // that still has the corners it was shipped with (listed in the repo as quadWas).
    // Corners the team has moved since are theirs, and are kept.
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4
      && a.every((pt, i) => Math.abs(pt[0] - b[i][0]) < 1e-4 && Math.abs(pt[1] - b[i][1]) < 1e-4);
    const cornersFixed = [];
    for (const p of live) {
      const r = repoById.get(p?.id);
      if (!r?.quad || !Array.isArray(r.quadWas) || !p?.image || p.image !== r.image) continue;
      if (same(p.quad, r.quad) || !r.quadWas.some((q) => same(q, p.quad))) continue;
      p.quad = r.quad;
      cornersFixed.push(p.id);
    }
    // A shipped photo withdrawn from the repo (the repo product has none, and lists the
    // old one in imageWas) is removed from a live product still showing it, so the
    // product waits for a proper photo. A photo the team uploaded is never touched.
    const photoRemoved = [];
    for (const p of live) {
      const r = repoById.get(p?.id);
      if (!r || r.image || !Array.isArray(r.imageWas) || !p?.image || !r.imageWas.includes(p.image)) continue;
      Object.assign(p, { image: null, imageDark: null, width: null, height: null, quad: null });
      delete p.cutout;
      photoRemoved.push(p.id);
    }
    if ((added.length || photoFilled.length || cornersFixed.length || photoRemoved.length) && !writeJsonFile(livePath, [...live, ...added])) return [];
    repo.forEach((p) => { if (p?.id) offered.add(p.id); if (p?.id && p.image) photosOffered.add(`${p.id}:${p.image}`); });
    writeJsonFile(markPath, { ids: [...offered], photos: [...photosOffered], updatedAt: new Date().toISOString() });
    return [...added.map((p) => p.id), ...photoFilled.map((id) => `${id} (photo)`), ...cornersFixed.map((id) => `${id} (print area)`), ...photoRemoved.map((id) => `${id} (photo removed)`)];
  } catch (e) {
    logError?.('packaging_seed_merge_failed', e);
    return [];
  }
}

export function registerPackaging(app, ctx) {
  const { dataDir, uploadsDir, publicDirs, readJsonFile, writeJsonFile, audit, logError, adminAuth, resolveUser } = ctx;
  const storePath = path.join(dataDir, 'packaging-products.json');
  const imagesDir = path.join(uploadsDir, 'packaging');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  // stored records as saved; readAll() adds the newer fields for anything that reads them
  const read = () => { const l = readJsonFile(storePath, []); return Array.isArray(l) ? l : []; };
  const readAll = () => read().filter((p) => p && p.id && p.name).map(normalise);
  const inStudio = (p) => !!(p.image && validQuad(p.quad));
  const publicShape = (p) => ({
    id: p.id, name: p.name, handle: p.handle || '', family: p.family, description: p.description || '', moq: p.moq || '', specs: p.specs || [],
    sizes: p.sizes, minOrder: p.minOrder, printColours: p.printColours,
    image: p.image || null, imageDark: p.imageDark || null, width: p.width, height: p.height,
    quad: inStudio(p) ? p.quad : null, safeTop: p.safeTop ?? 0.1,
    cutout: isCutoutPath(p.image),
  });
  const fileFor = (image) => {
    if (image.startsWith('/uploads/packaging/')) { const p = path.join(imagesDir, path.basename(image)); return fs.existsSync(p) ? p : null; }
    for (const d of publicDirs) { const p = path.join(d, image.replace(/^\//, '')); if (fs.existsSync(p)) return p; }
    return null;
  };

  // public: products for the packaging page. ?scope=team for the packaging team, ?scope=all for the administrator
  app.get('/api/packaging-products', (req, res) => {
    const list = readAll();
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

  // The packaging team (marketing) looks after product photos too; the administrator can do everything.
  const packTeam = (req, res, next) => {
    const r = resolveUser(req);
    if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!['admin', 'pack'].includes(r.user.role)) return res.status(403).json({ error: 'Product photos are looked after by the packaging team.' });
    req.teamUser = r.user;
    next();
  };

  // POST /api/admin/packaging-products/image  (and /api/team/..., the same upload)
  //   image, variant ('light' | 'dark'), and for a dark photo: light (path of the white photo)
  // A product on a transparent background (a mockup export) is kept transparent,
  // trimmed to the product, and works in light and dark mode without a dark photo.
  const imageUpload = (req, res) => upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The photo can be up to 15 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a photo.' });
    const variant = req.body?.variant === 'dark' ? 'dark' : 'light';
    try {
      const meta = await sharp(req.file.buffer, { failOn: 'error' }).rotate().metadata();
      if (await isTransparentCutout(req.file.buffer)) {
        if (variant === 'dark') return res.status(422).json({ code: 'cutout_no_dark', error: 'A transparent image works in light and dark mode as it is. No dark photo is needed.' });
        const base = `${(clean(req.body?.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product')}-cutout-${Date.now()}`;
        const file = path.join(imagesDir, `${base}.webp`);
        const info = await sharp(req.file.buffer).rotate().trim({ threshold: 10 })
          .resize({ width: 1400, height: 2000, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90, alphaQuality: 100, effort: 5 }).toFile(file);
        audit('packaging_image_uploaded', req, { file: path.basename(file), variant: 'cutout' });
        return res.json({ success: true, path: `/uploads/packaging/${base}.webp`, width: info.width, height: info.height, background: 'transparent', cutout: true, warning: null });
      }
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
      res.json({ success: true, path: `/uploads/packaging/${base}.webp`, width: info.width, height: info.height, background: bg.tone, cutout: false, warning });
    } catch (e) {
      logError('packaging_image_failed', e);
      res.status(400).json({ error: 'The photo could not be read. Try a JPG or PNG.' });
    }
  });
  app.post('/api/admin/packaging-products/image', adminAuth, imageUpload);
  app.post('/api/team/packaging-products/image', packTeam, imageUpload);

  // The packaging team replaces a product's photo and places its print corners.
  // Only the photo, its size and print area change; name, sizes and minimums stay.
  //   POST /api/team/packaging-products/:id/photo  { image, width, height, quad, safeTop }
  app.post('/api/team/packaging-products/:id/photo', packTeam, (req, res) => {
    const b = req.body || {};
    const image = typeof b.image === 'string' && b.image ? b.image : null;
    if (!image || !IMAGE_RE.test(image) || !fileFor(image)) return res.status(400).json({ error: 'Upload the photo again.' });
    const quad = b.quad == null ? null : b.quad;
    if (quad && !validQuad(quad)) return res.status(400).json({ error: 'Place the four corners on the printable panel. They must form a four-sided shape that is not twisted.' });
    const list = read(), p = list.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    const safeTop = Number(b.safeTop);
    const old = [p.image, p.imageDark];
    const changed = p.image !== image;
    Object.assign(p, {
      image,
      imageDark: changed ? null : p.imageDark || null, // a dark photo belongs to the old shot
      width: Math.max(1, Math.round(Number(b.width) || p.width || 1000)),
      height: Math.max(1, Math.round(Number(b.height) || p.height || 1400)),
      quad: quad ? quad.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]) : null,
      safeTop: Number.isFinite(safeTop) ? Math.min(0.4, Math.max(0, safeTop)) : (p.safeTop ?? 0.1),
      cutout: isCutoutPath(image),
      updatedAt: new Date().toISOString(),
    });
    if (!writeJsonFile(storePath, list)) return res.status(500).json({ error: 'The photo could not be saved.' });
    old.forEach((img) => removeImageIfUnused(img, list));
    audit('packaging_photo_set', req, { id: p.id, by: req.teamUser.id, cutout: p.cutout });
    res.json({ success: true, product: publicShape(normalise(p)) });
  });

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
    if (b.family !== undefined && !FAMILY_IDS.has(b.family)) return res.status(400).json({ error: 'Choose which group the product belongs to.' });
    if (b.minOrder !== undefined && b.minOrder !== null && b.minOrder !== '' && !units(b.minOrder)) return res.status(400).json({ error: `The minimum order must be a whole number of units, up to ${MAX_QTY.toLocaleString('en-US')}.` });
    const sizes = b.sizes === undefined ? undefined : cleanSizes(b.sizes);
    const colours = b.printColours === undefined || b.printColours === null || b.printColours === '' ? null : Number(b.printColours);
    if (colours !== null && !(Number.isInteger(colours) && colours >= 0 && colours <= 8)) return res.status(400).json({ error: 'Print colours must be a number from 0 (plain) to 8.' });
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
      cutout: isCutoutPath(image),
      site: b.site !== false, team: b.team !== false, updatedAt: now,
    });
    // newer fields are only replaced when the admin form sent them
    if (b.family !== undefined) p.family = b.family;
    else if (!p.family) p.family = 'bags';
    if (sizes !== undefined) p.sizes = sizes;
    if (b.minOrder !== undefined) p.minOrder = units(b.minOrder);
    if (b.printColours !== undefined) p.printColours = colours;
    if (!writeJsonFile(storePath, list)) return res.status(500).json({ error: 'The product could not be saved.' });
    old.forEach((img) => removeImageIfUnused(img, list));
    audit('packaging_product_saved', req, { id: p.id });
    res.json({ success: true, product: p });
  });

  // The packaging team (and the administrator) set minimum orders: for the
  // product, and optionally per size. Nothing else about the product changes.
  //   POST /api/team/packaging-products/:id/minimums  { minOrder, sizes: { [sizeId]: minOrder } }
  app.post('/api/team/packaging-products/:id/minimums', (req, res) => {
    const r = resolveUser(req);
    if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!['admin', 'pack'].includes(r.user.role)) return res.status(403).json({ error: 'Minimum orders are set by the packaging team.' });
    const b = req.body || {};
    const bad = (v) => v !== null && v !== undefined && v !== '' && !units(v);
    if (bad(b.minOrder)) return res.status(400).json({ error: `The minimum order must be a whole number of units, up to ${MAX_QTY.toLocaleString('en-US')}.` });
    const perSize = b.sizes && typeof b.sizes === 'object' && !Array.isArray(b.sizes) ? b.sizes : {};
    if (Object.values(perSize).some(bad)) return res.status(400).json({ error: 'Each size minimum must be a whole number of units, or left blank to use the product minimum.' });
    const list = read(), p = list.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    const cur = normalise(p);
    if (!p.family) p.family = cur.family;
    p.minOrder = b.minOrder === undefined ? cur.minOrder : units(b.minOrder);
    p.sizes = cur.sizes.map((s) => (Object.prototype.hasOwnProperty.call(perSize, s.id) ? { ...s, minOrder: units(perSize[s.id]) } : s));
    p.updatedAt = new Date().toISOString();
    if (!writeJsonFile(storePath, list)) return res.status(500).json({ error: 'The minimum could not be saved.' });
    audit('packaging_minimum_set', req, { id: p.id, by: r.user.id, minOrder: p.minOrder });
    res.json({ success: true, product: publicShape(normalise(p)) });
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

  return { catalogue: readAll };
}
