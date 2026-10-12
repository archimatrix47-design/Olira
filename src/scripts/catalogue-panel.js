// A packaging product's pieces, shared by the build (packaging.astro, index.astro)
// and the browser (catalogue.js): whether the studio can preview it, its
// transparent cut-out on the home page, the facts in its details panel, and its
// card in the shared product grid (product-grid.js).
// The pure facts live in catalogue-facts.js and are re-exported here.
import CUTOUTS from '../data/cutouts.json';
import { isCutoutImage } from './catalogue-facts.js';

export * from './catalogue-facts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The product's transparent cut-out: an uploaded transparent image is its own
 * cut-out, with the print corners placed on it; a shipped photo has a matching
 * cut-out in cutouts.json. A photo on a white background has none and is shown as
 * a photo.
 */
export const cutoutOf = (p) => {
  if (p?.image && (p.cutout || isCutoutImage(p.image))) {
    return { image: p.image, cutout: p.image, width: p.width || 1000, height: p.height || 1400, quad: Array.isArray(p.quad) && p.quad.length === 4 ? p.quad : null, safeTop: p.safeTop };
  }
  const c = CUTOUTS[p?.id];
  return c && c.image === p.image ? { ...c, safeTop: p.safeTop } : null;
};

/**
 * A cut-out standing on the kraft. With a print area, a canvas sits exactly over
 * it and live-print.js paints the visitor's brand into that area (or, with
 * brand 'olira', Olira's own logo); without JavaScript, or until then,
 * the plain cut-out shows.
 */
export function standHTML(c, name, { eager = false, ink = 'teal', brand = '' } = {}) {
  const w = Math.round(640 * c.width / c.height);
  const img = `<img class="cutimg" src="${esc(c.cutout)}" alt="" width="${c.width}" height="${c.height}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  const canvas = Array.isArray(c.quad) ? `<canvas data-print data-cutout="${esc(c.cutout)}" data-quad="${esc(JSON.stringify(c.quad))}" data-safe-top="${Number(c.safeTop ?? 0.04)}" data-ink="${esc(ink)}"${brand === 'olira' ? ' data-brand="olira"' : ''} width="${w}" height="640" role="img" aria-label="${esc(name)}, printed with ${brand === 'olira' ? 'the Olira logo' : 'your brand'}"></canvas>` : '';
  return `<span class="stand${c.width / c.height > 0.92 ? ' wide' : ''}" style="aspect-ratio:${c.width}/${c.height}">${img}${canvas}</span>`;
}

