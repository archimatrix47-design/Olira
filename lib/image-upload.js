// BOX image-upload: an uploaded picture made safe and small. Everything, SVG included,
// is redrawn as WebP, so a file can never carry a script. A library box: the agriculture
// catalogue and the logo import it.
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';

// Use memory storage so we can pipe through sharp before writing to disk
export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB raw upload cap (will be compressed)
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, SVG, or GIF images are allowed'));
  }
});

/**
 * Process an uploaded image buffer:
 *   - Everything (including SVG) is rasterized + resized + converted to WebP.
 *     SVGs are rasterized rather than stored verbatim to remove any embedded
 *     scripting (stored-XSS protection).
 *   - Optionally writes a thumbnail at 480px wide.
 *
 * Returns { fullPath, thumbPath } as public-relative URLs.
 */
export async function processAndSaveImage(buffer, mimeType, outputDir, baseName, options = {}) {
  const { maxWidth = 1200, thumbWidth = 480, makeThumb = true, quality = 82 } = options;

  // SECURITY: never store an uploaded SVG verbatim. An SVG can embed
  // <script>/on* handlers, and when opened directly at its /uploads URL it
  // executes in our origin (the page CSP doesn't govern a directly-viewed
  // SVG) — a stored-XSS vector. Rasterizing through sharp discards all
  // scripting and yields a safe WebP. `density` keeps small vector logos crisp.
  // (Falls through to the raster path below with the same output as any image.)

  // Raster (and rasterized SVG): resize + convert to WebP. Higher density on
  // SVG input so vector logos rasterize crisply rather than blurry.
  const isSvg = mimeType === 'image/svg+xml';
  const sharpOpts = isSvg ? { density: 300 } : {};
  const fullName = `${baseName}.webp`;
  const fullOut = path.join(outputDir, fullName);
  await sharp(buffer, sharpOpts)
    .rotate() // honor EXIF orientation
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toFile(fullOut);

  let thumbName = fullName;
  if (makeThumb) {
    thumbName = `${baseName}-thumb.webp`;
    await sharp(buffer, sharpOpts)
      .rotate()
      .resize({ width: thumbWidth, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(path.join(outputDir, thumbName));
  }

  return { fullPath: fullName, thumbPath: thumbName };
}
