// scripts/convert-to-webp.mjs
// Walks the public/ tree, finds .png/.jpg/.jpeg files that don't yet have a
// WebP companion, and writes one alongside via sharp.
// Runs as a one-shot CLI script AND is also imported by server.js on startup
// so any image dropped into public/ gets a WebP twin without manual work.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const RASTER_RE = /\.(png|jpg|jpeg)$/i;
const SKIP_DIRS = new Set(['uploads']); // already-converted by upload pipeline

export async function convertTreeToWebp(rootDir, opts = {}) {
  const { quality = 82, log = () => {} } = opts;
  const stats = { converted: 0, skipped: 0, failed: 0 };

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!RASTER_RE.test(entry.name)) continue;

      const webpPath = full.replace(RASTER_RE, '.webp');
      try {
        await fs.access(webpPath);
        stats.skipped++; // already exists
        continue;
      } catch { /* doesn't exist — convert */ }

      try {
        await sharp(full).webp({ quality }).toFile(webpPath);
        stats.converted++;
        log(`converted ${path.relative(rootDir, full)} → ${path.basename(webpPath)}`);
      } catch (err) {
        stats.failed++;
        log(`failed ${path.relative(rootDir, full)}: ${err.message}`);
      }
    }
  }

  await walk(rootDir);
  return stats;
}

// CLI entry point: `node scripts/convert-to-webp.mjs [dir]`
const isCli = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isCli) {
  const root = path.resolve(process.argv[2] || 'public');
  console.log(`🌿 Converting raster images in ${root}/ to WebP...`);
  const stats = await convertTreeToWebp(root, { log: (m) => console.log('  ' + m) });
  console.log(`✅ converted=${stats.converted}  skipped=${stats.skipped}  failed=${stats.failed}`);
}
