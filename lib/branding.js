// BOX branding: the logo and tagline every page shows, saved by the admin.
import fs from 'fs';
import path from 'path';
import { memoryUpload, processAndSaveImage } from './image-upload.js';

export function registerBranding(app, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, adminAuth }) {
  const brandingPath = path.join(dataDir, 'branding.json');

  // a logo saved by /api/upload/logo: /uploads/logo-<time>.<ext>
  const LOGO_RE = /^\/uploads\/logo-\d+\.(webp|png|jpe?g|svg)$/;

  app.get('/api/branding', (req, res) => {
    res.json(readJsonFile(brandingPath, { logo: null, tagline: '' }));
  });

  app.post('/api/branding', adminAuth, (req, res) => {
    const { logo, tagline } = req.body;
    const current = readJsonFile(brandingPath, { logo: null, tagline: '' });
    // every page puts the logo in its header: only a file uploaded through
    // /api/upload/logo (or none) may be saved, never a link or another path
    if (logo !== undefined && logo !== null && logo !== '') {
      const ok = typeof logo === 'string' && LOGO_RE.test(logo) && fs.existsSync(path.join(uploadsDir, path.basename(logo)));
      if (!ok) return res.status(400).json({ error: 'Upload the logo again.' });
    }
    const next = {
      logo: logo !== undefined ? (logo || null) : current.logo,
      tagline: tagline !== undefined ? String(tagline).slice(0, 500) : current.tagline
    };
    if (!writeJsonFile(brandingPath, next)) {
      return res.status(500).json({ error: 'Failed to save branding' });
    }
    audit('branding_saved', req, { logo: !!next.logo });
    res.json({ success: true, data: next });
  });

  // POST /api/upload/logo (admin) — resize to 600px WebP, no thumb (logos are small)
  app.post('/api/upload/logo', adminAuth, (req, res) => {
    memoryUpload.single('logo')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      try {
        const baseName = `logo-${Date.now()}`;
        const { fullPath } = await processAndSaveImage(
          req.file.buffer,
          req.file.mimetype,
          uploadsDir,
          baseName,
          { maxWidth: 600, makeThumb: false, quality: 90 }
        );
        const publicPath = `/uploads/${fullPath}`;
        // Persist new logo path in branding.json so all pages can read it
        const branding = readJsonFile(brandingPath, { logo: null, tagline: '' });
        branding.logo = publicPath;
        writeJsonFile(brandingPath, branding);
        audit('branding_saved', req, { logo: true });
        res.json({ success: true, path: publicPath, originalSize: req.file.size });
      } catch (error) {
        console.error('Logo processing error:', error);
        res.status(500).json({ error: 'Failed to process logo' });
      }
    });
  });
}
