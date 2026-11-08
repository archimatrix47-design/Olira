// A packaging product's facts, with no files or browser needed, so the build, the
// browser and the tests share them: whether the studio can preview it, its price
// and the rows a buyer checks, which of price, minimum and lead time are still to
// come, and its card in the product grid (product-grid.js). catalogue-panel.js
// re-exports all of it beside the cut-outs, which need the shipped cutouts.json.

import { has3d } from './box-styles.js';

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * A photo with the corners of its print area: the studio's photo mockup, and the
 * live print on cards. The one copy of this rule (engine.js, live-print.js and the
 * staff screens import it), so they can never disagree about a product.
 */
export const hasPhotoMockup = (p) => !!(p && p.image && Array.isArray(p.quad) && p.quad.length === 4);
/** In the studio: a photo mockup, or a measured box the studio shows in 3D. */
export const inStudio = (p) => hasPhotoMockup(p) || has3d(p);
/** The studio's products in its order: photographed ones first, then boxes shown only in 3D. */
export const studioOrder = (list) => [...list.filter(hasPhotoMockup), ...list.filter((p) => !hasPhotoMockup(p) && has3d(p))];
/** An uploaded image on a transparent background (the server names it "-cutout-"). */
export const isCutoutImage = (image) => /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$/.test(image || '');


/** An amount in Ethiopian birr, as the catalogue writes it: "ETB 1,250.50". */
export const etb = (n) => `ETB ${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
/** The price per 1,000 for a product in a size (the size's own price wins), or null. */
export function priceFor(p, sizeId) {
  const s = sizeId && Array.isArray(p?.sizes) ? p.sizes.find((x) => x.id === sizeId) : null;
  return (s && s.pricePer1000) || p?.pricePer1000 || null;
}
/** The lowest price per 1,000 the packaging team has set, and whether others are higher. */
export function priceFrom(p) {
  const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
  const prices = (sizes.length ? sizes.map((s) => priceFor(p, s.id)) : [p?.pricePer1000]).filter((n) => Number(n) > 0);
  if (!prices.length) return null;
  return { price: Math.min(...prices), varies: new Set(prices).size > 1, partial: sizes.length > 0 && prices.length < sizes.length };
}

/** The facts a buyer checks, as [label, value] rows: sizes, minimum order, print, price, lead time. */
export function specRows(p, flexoMax = 4) {
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const minimums = [p.minOrder, ...sizes.map((s) => s.minOrder)].filter((n) => Number.isInteger(n) && n > 0);
  const lowest = minimums.length ? Math.min(...minimums) : null;
  const colours = Number.isInteger(p.printColours) ? p.printColours : flexoMax;
  const from = priceFrom(p);
  const fits = sizes.filter((s) => s.holds).map((s) => `${s.label}: ${s.holds}`);
  return [
    ['Sizes', sizes.length ? sizes.map((s) => s.label).join(', ') : 'Made to your size'],
    ['Minimum order', lowest ? `${minimums.length > 1 && new Set(minimums).size > 1 ? 'From ' : ''}${fmt(lowest)}` : 'Confirmed with your quote'],
    ['Print', colours === 0 ? 'Plain, unprinted' : `Flexographic, up to ${colours} colour${colours === 1 ? '' : 's'}`],
    ['Price', from ? `${from.varies || from.partial ? 'From ' : ''}${etb(from.price)} per 1,000` : 'Price in your quote'],
    ['Ready in', Number.isInteger(p.leadTimeDays) && p.leadTimeDays > 0 ? `${p.leadTimeDays} working day${p.leadTimeDays === 1 ? '' : 's'}` : 'Confirmed with your quote'],
    // what each size holds, only as the team measured it; last, so the first five rows keep their places
    ...(fits.length ? [['What fits', fits.join('; ')]] : []),
  ];
}

/** The facts a buyer weighs before asking, by key, and their labels in specRows. */
export const QUOTE_FACTS = { price: 'Price', minimum: 'Minimum order', ready: 'Ready in' };
const QUOTE_NAMES = { price: 'price', minimum: 'minimum order', ready: 'lead time' };

/** Which of price, minimum order and lead time the packaging team has not set yet. */
export function pendingFacts(p) {
  const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
  const out = [];
  if (!priceFrom(p)) out.push('price');
  if (![p?.minOrder, ...sizes.map((s) => s.minOrder)].some((n) => Number.isInteger(n) && n > 0)) out.push('minimum');
  if (!(Number.isInteger(p?.leadTimeDays) && p.leadTimeDays > 0)) out.push('ready');
  return out;
}

/** The facts still to come, as words: "Price, minimum order and lead time" (or '' when none). */
export function pendingList(keys) {
  const names = keys.map((k) => QUOTE_NAMES[k]).filter(Boolean);
  if (!names.length) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return list[0].toUpperCase() + list.slice(1);
}

/** One line in place of the facts still to come: "Price and lead time are confirmed in your quote." */
export const pendingLine = (keys) => {
  const list = pendingList(keys);
  return list ? `${list} ${keys.length === 1 ? 'is' : 'are'} confirmed in your quote.` : '';
};

/** specRows without the facts still to come, and the line that names them instead. */
export function knownRows(p, flexoMax = 4) {
  const pending = pendingFacts(p);
  const skip = new Set(pending.map((k) => QUOTE_FACTS[k]));
  return { rows: specRows(p, flexoMax).filter(([k]) => !skip.has(k)), pending, line: pendingLine(pending) };
}

/** A packaging product as a grid card (product-grid.js), printed live when it has a print area. */
export const flowItem = (p, families = {}) => ({
  id: p.id, name: p.name, sub: families[p.family] || '', cat: p.family || 'bags', image: p.image || null,
  description: p.description || '', family: p.family || 'bags',
  cutout: !!(p.image && (p.cutout || isCutoutImage(p.image))), // shown whole on the stage colour, not cropped
  print: hasPhotoMockup(p) ? { cutout: p.image, quad: p.quad, safeTop: p.safeTop } : null,
  // a card without a photo shows its sizes instead, and says when the studio shows it as a 3D box
  note: p.image ? '' : (Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map((s) => s.label).join(', ') : 'Made to your size'),
  in3d: !p.image && has3d(p),
});

/** Products with a photo first, in the team's order, then the rest: the grid opens on photos. */
export const photoFirst = (list) => [...list.filter((p) => p.image), ...list.filter((p) => !p.image)];
