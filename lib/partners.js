// Partner logos: the organisations Olira has worked with (FAO, the World Bank and
// others), shown on the home page under the two businesses. Both marketing teams
// (agriculture and packaging) and the administrator look after them.
//
// Logos are uploaded through the server and always saved as a WebP image: an SVG
// is rasterised, so no script inside one can ever reach the site. The team uploads
// the organisations' own logo files, with their permission; none ship with the site.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';

const LOGO_RE = /^\/uploads\/partners\/[a-z0-9-]+\.webp$/;
const MAX_PARTNERS = 40;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const cleanUrl = (v) => { const s = clean(v, 300); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ''; };

export function registerPartners(app, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, logError, resolveUser }) {
  const storePath = path.join(dataDir, 'partners.json');
  const dir = path.join(uploadsDir, 'partners');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileFor = (logo) => (LOGO_RE.test(logo || '') ? path.join(dir, path.basename(logo)) : null);
  const read = () => { const l = readJsonFile(storePath, []); return Array.isArray(l) ? l : []; };
  const shape = (p) => ({ id: p.id, name: p.name, logo: p.logo, url: p.url || '', width: p.width || null, height: p.height || null });
  const valid = (p) => p && p.id && p.name && LOGO_RE.test(p.logo || '');

  // public: the logos on the home page, in their order
  app.get('/api/partners', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(read().filter(valid).map(shape));
  });

  // the marketing teams of both lines, and the administrator
  const marketing = (req, res, next) => {
    const r = resolveUser(req);
    if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!['admin', 'agri', 'pack'].includes(r.user.role)) return res.status(403).json({ error: 'Partner logos are looked after by the marketing teams.' });
    req.teamUser = r.user;
    next();
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 },
    fileFilter: (req, file, cb) => (['image/png', 'image/webp', 'image/jpeg', 'image/svg+xml'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Use a PNG, SVG, WebP or JPG logo.'))),
  }).single('logo');

  // POST /api/team/partners/logo  (logo, name) -> { path, width, height }
  app.post('/api/team/partners/logo', marketing, (req, res) => upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The logo can be up to 5 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a logo file.' });
    try {
      const svg = req.file.mimetype === 'image/svg+xml';
      // an SVG is drawn to pixels here: the file saved and served is never SVG
      const input = sharp(req.file.buffer, { failOn: 'error', ...(svg ? { density: 300 } : {}) });
      const base = `${(clean(req.body?.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partner')}-${Date.now()}`;
      const file = path.join(dir, `${base}.webp`);
      const info = await input.rotate().trim({ threshold: 10 })
        .resize({ width: 960, height: 240, fit: 'inside', withoutEnlargement: !svg })
        .webp({ quality: 92, alphaQuality: 100, effort: 5 }).toFile(file);
      audit('partner_logo_uploaded', req, { file: path.basename(file), by: req.teamUser.id });
      res.json({ success: true, path: `/uploads/partners/${base}.webp`, width: info.width, height: info.height });
    } catch (e) {
      logError('partner_logo_failed', e);
      res.status(400).json({ error: 'The logo could not be read. Try a PNG or SVG.' });
    }
  }));

  // POST /api/team/partners  { partners: [{ id?, name, logo, url }] }: the whole list, in order
  app.post('/api/team/partners', marketing, (req, res) => {
    const incoming = Array.isArray(req.body?.partners) ? req.body.partners : null;
    if (!incoming) return res.status(400).json({ error: 'Send the list of partners.' });
    if (incoming.length > MAX_PARTNERS) return res.status(400).json({ error: `Up to ${MAX_PARTNERS} logos.` });
    const before = read();
    const next = [];
    for (const [i, raw] of incoming.entries()) {
      const name = clean(raw?.name, 80);
      if (!name) return res.status(400).json({ error: `Logo ${i + 1} needs the organisation's name.`, index: i });
      const logo = typeof raw?.logo === 'string' ? raw.logo : '';
      if (!LOGO_RE.test(logo) || !fs.existsSync(fileFor(logo))) return res.status(400).json({ error: `Upload the logo for ${name} again.`, index: i });
      const url = typeof raw?.url === 'string' && raw.url.trim() ? cleanUrl(raw.url) : '';
      if (raw?.url && raw.url.trim() && !url) return res.status(400).json({ error: `The link for ${name} must be a full address starting with https://`, index: i });
      const old = before.find((p) => p.id === raw?.id);
      next.push({ id: old ? old.id : `pt_${crypto.randomBytes(5).toString('hex')}`, name, logo, url, width: Number(raw?.width) || old?.width || null, height: Number(raw?.height) || old?.height || null, updatedAt: new Date().toISOString() });
    }
    if (!writeJsonFile(storePath, next)) return res.status(500).json({ error: 'The logos could not be saved.' });
    // logo files nothing uses any more are removed
    for (const p of before) if (!next.some((n) => n.logo === p.logo)) { try { fs.rmSync(fileFor(p.logo), { force: true }); } catch (e) { logError('partner_logo_remove_failed', e); } }
    audit('partners_saved', req, { by: req.teamUser.id, count: next.length });
    res.json({ success: true, partners: next.map(shape) });
  });
}
