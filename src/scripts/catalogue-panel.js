// A packaging product's pieces, shared by the build (packaging.astro, index.astro)
// and the browser (catalogue.js): whether the studio can preview it, its
// transparent cut-out on the home page, the facts in its details panel, and its
// card in the shared product carousel (flow.js).
import CUTOUTS from '../data/cutouts.json';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');

export const inStudio = (p) => !!(p.image && Array.isArray(p.quad) && p.quad.length === 4);
/** An uploaded image on a transparent background (the server names it "-cutout-"). */
export const isCutoutImage = (image) => /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$/.test(image || '');

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
 * it and live-print.js paints the visitor's brand into that area; without
 * JavaScript, or until then, the plain cut-out shows.
 */
export function standHTML(c, name, { eager = false, ink = 'teal' } = {}) {
  const w = Math.round(640 * c.width / c.height);
  const img = `<img class="cutimg" src="${esc(c.cutout)}" alt="" width="${c.width}" height="${c.height}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  const canvas = Array.isArray(c.quad) ? `<canvas data-print data-cutout="${esc(c.cutout)}" data-quad="${esc(JSON.stringify(c.quad))}" data-safe-top="${Number(c.safeTop ?? 0.04)}" data-ink="${esc(ink)}" width="${w}" height="640" role="img" aria-label="${esc(name)}, printed with your brand"></canvas>` : '';
  return `<span class="stand${c.width / c.height > 0.92 ? ' wide' : ''}" style="aspect-ratio:${c.width}/${c.height}">${img}${canvas}</span>`;
}


/** The facts a buyer checks, as [label, value] rows: sizes, minimum order, print. */
export function specRows(p, flexoMax = 4) {
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const minimums = [p.minOrder, ...sizes.map((s) => s.minOrder)].filter((n) => Number.isInteger(n) && n > 0);
  const lowest = minimums.length ? Math.min(...minimums) : null;
  const colours = Number.isInteger(p.printColours) ? p.printColours : flexoMax;
  return [
    ['Sizes', sizes.length ? sizes.map((s) => s.label).join(', ') : 'Made to your size'],
    ['Minimum order', lowest ? `${minimums.length > 1 && new Set(minimums).size > 1 ? 'From ' : ''}${fmt(lowest)}` : 'Confirmed with your quote'],
    ['Print', colours === 0 ? 'Plain, unprinted' : `Flexographic, up to ${colours} colour${colours === 1 ? '' : 's'}`],
  ];
}

/** A packaging product as a carousel card (flow.js), printed live when it has a print area. */
export const flowItem = (p, families = {}) => ({
  id: p.id, name: p.name, sub: families[p.family] || '', cat: p.family || 'bags', image: p.image || null,
  description: p.description || '', family: p.family || 'bags',
  cutout: !!(p.image && (p.cutout || isCutoutImage(p.image))), // shown whole on the stage colour, not cropped
  print: p.image && Array.isArray(p.quad) && p.quad.length === 4 ? { cutout: p.image, quad: p.quad, safeTop: p.safeTop } : null,
});
