// BOX packaging-catalogue, its rules: what a packaging product may be. Families,
// sizes, minimums, prices and the checks on a quote bundle. No files, no routes and no
// image tools, so the server, the page build and the spreadsheet import can all share
// exactly the same rules.
import { boxStyle, boxBoard } from './box-styles.js';

export const IMAGE_RE = /^\/(uploads\/packaging|images\/packaging\/products)\/[\w.-]+\.(webp|png|jpg)$/;
// An uploaded product image on a transparent background (a mockup export) is kept
// transparent and named with this marker, so the site can stand it on its own
// background like the shipped cut-outs. The name is made here, never by the client.
const CUTOUT_RE = /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$/;
export const isCutoutPath = (image) => typeof image === 'string' && CUTOUT_RE.test(image);
export const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

// The catalogue's families. Fixed here so the page, the admin and the team tools
// group products the same way; a product's family is one of these ids.
export const FAMILIES = [
  { id: 'bags', label: 'Paper bags', short: 'Paper bags' },
  { id: 'food', label: 'Bakery and food boxes', short: 'Food boxes' },
  { id: 'medical', label: 'Medical packets', short: 'Medical packets' },
  { id: 'foil', label: 'Aluminium foil bags', short: 'Foil bags' },
];
export const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

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

export const MAX_PRICE = 10_000_000;
/** A price in ETB per 1,000 units: null when blank, NaN when not a positive amount. */
export function pricePer1000(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : NaN;
}
/** Working days from artwork approval to ready: null when blank, NaN when not 1 to 365. */
export function leadDays(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : NaN;
}
const ok = (n) => (Number.isNaN(n) ? null : n);
/** A size measurement in centimetres (a decimal comma is read as a point), or null when it is not one. */
export function dimOf(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 10) / 10 : null;
}

export function cleanSizes(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const label = clean(s.label, 40);
    if (!label) continue;
    let id = clean(s.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, '') || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `s${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    out.push({ id, label, w: dimOf(s.w), d: dimOf(s.d), h: dimOf(s.h), holds: clean(s.holds, 60), minOrder: units(s.minOrder), pricePer1000: ok(pricePer1000(s.pricePer1000)) });
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
    // the product's own price is for products without sizes, or sizes without one
    pricePer1000: ok(pricePer1000(p.pricePer1000)),
    leadTimeDays: ok(leadDays(p.leadTimeDays)),
    // the studio's 3D view (lib/box-styles.js): a folding style, or null for none
    shape3d: boxStyle(p.shape3d),
    board3d: boxBoard(p.board3d),
  };
}

/** The price per 1,000 for a product in a size (the size's own price wins), or null. */
export function priceFor(p, sizeId) {
  const s = sizeId ? p.sizes.find((x) => x.id === sizeId) : null;
  return (s && s.pricePer1000) || p.pricePer1000 || null;
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
