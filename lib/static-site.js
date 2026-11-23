// BOX static-site: the built pages and uploads, how long browsers keep them, the 404
// page, and the last-resort error handler. Plugged in last: Express runs in order, so
// every API route must already be registered when these are.
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { servePrecompressed } from './precompressed.js';

export function registerStaticSite(app, { uploadsDir, distPath, logError }) {
  // Cache control middleware for static assets
  app.use((req, res, next) => {
    // Set cache headers based on file type
    if (req.url.match(/\.(js|css|woff|woff2|ttf|otf|eot)$/i) || req.url.startsWith('/_astro/')) {
      // Versioned assets (hashed filenames, everything the build puts in /_astro/) can be cached long-term
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (req.url.match(/\.(jpg|jpeg|png|gif|svg|webp|avif|ico)$/i)) {
      // Images can be cached for a month
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (req.url.match(/\.(html|json)$/i)) {
      // HTML and JSON files should have shorter cache or no cache
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
    next();
  });

  // Serve uploaded files (logos, product images) — these live outside dist/
  // because they're created at runtime, not build time. Uses uploadsDir so a
  // persistent UPLOADS_DIR is served correctly.
  // Only pictures and certificate PDFs are ever stored here, so only those are served; and a file
  // opened on its own (not shown in a page) is inert: no scripts, no forms, no plugins. PDFs keep
  // the browser's viewer (a sandbox would block it) and are checked for scripts on upload.
  const UPLOAD_TYPES = /\.(webp|png|jpe?g|gif|avif|svg|pdf)$/i;
  app.use('/uploads', (req, res, next) => {
    if (!UPLOAD_TYPES.test(req.path)) return res.status(404).send('Not found');
    if (!/\.pdf$/i.test(req.path)) res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    next();
  }, express.static(uploadsDir, { dotfiles: 'deny', index: false }));

  // the build's compressed copies first (lib/precompressed.js), then the files themselves
  app.use(servePrecompressed(distPath));
  app.use(express.static(distPath));

  // Fallback for unmatched routes. express.static above already served every
  // real page (/, /admin/, etc.), so anything reaching here is genuinely not
  // found: serve the custom 404 page with a real 404 status (not a soft-404
  // that returns the homepage with 200 and hurts SEO).
  app.get('*', (req, res) => {
    const notFoundPath = path.join(distPath, '404.html');
    if (fs.existsSync(notFoundPath)) {
      return res.status(404).sendFile(notFoundPath);
    }
    res.status(404).send('Not found');
  });

  // F1: global error handler — MUST be last. Any error thrown or passed to
  // next(err) anywhere lands here instead of leaking a generic HTML 500 with no
  // server-side record (which is exactly how the CORS bug hid for hours). Logs the
  // full error with a short correlation id that's also returned to the client, so
  // a user-reported failure can be matched to a log line. Never leaks internals.
  app.use((err, req, res, next) => {
    // a body that is not JSON, or too big, is the sender's mistake: a plain answer, and no log line
    // (anyone can send these, so logging each one would let them fill the error log)
    if (!res.headersSent && err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request was not valid JSON.' });
    if (!res.headersSent && err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
    const id = crypto.randomBytes(5).toString('hex');
    logError('unhandled_request_error', err, { id, method: req.method, path: req.path });
    if (res.headersSent) return next(err);
    res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500)
      .json({ error: 'Internal server error', id });
  });
}
