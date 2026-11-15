// The packaging catalogue for the page's scripts (catalogue, packing list, studio).
// It starts from the products built into the page, then asks the API once for
// anything the admin or the packaging team changed since (a new photo, a new
// minimum order), so all three always agree without a rebuild.
let products = [];
try { products = JSON.parse(document.getElementById('packagingData')?.textContent || '[]'); } catch (e) { products = []; }

const listeners = new Set();
export const getProducts = () => products;
export const byId = (id) => products.find((p) => p.id === id);
/** Call fn(products) whenever the live list differs from what the page was built with. */
export function onProducts(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const key = (arr) => JSON.stringify(arr.map((p) => [p.id, p.name, p.family, p.description, p.handle, p.image, p.imageDark, p.quad, p.safeTop, p.sizes, p.minOrder, p.printColours, p.pricePer1000, p.leadTimeDays, p.shape3d, p.board3d]));
const tell = () => listeners.forEach((fn) => { try { fn(products); } catch (e) { /* one page part failing leaves the others */ } });
// 3D shows only while the packaging team and the manager both have it switched on (box
// packaging-3d). The switches are asked directly: if they say off, the 3D shapes are dropped
// at once, whatever this page was built with and whatever a cached catalogue still says.
let view3d = null; // null until the switches answer
const gated = (list) => (view3d === false ? list.map((p) => (p.shape3d ? { ...p, shape3d: null } : p)) : list);
fetch('/api/packaging-3d', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
  if (typeof s?.on !== 'boolean') return;
  view3d = s.on;
  if (!view3d && products.some((p) => p.shape3d)) { products = gated(products); tell(); }
}).catch(() => {});
fetch('/api/packaging-products').then((r) => (r.ok ? r.json() : null)).then((list) => {
  if (!Array.isArray(list)) return;
  list = gated(list);
  if (key(list) === key(products)) return;
  products = list;
  tell();
}).catch(() => {});

export const fmt = (n) => Number(n).toLocaleString('en-US');

/** The minimum order for a product in a size (the size's own minimum wins), or null. */
export function minimumFor(p, sizeId) {
  const s = sizeId && Array.isArray(p?.sizes) ? p.sizes.find((x) => x.id === sizeId) : null;
  return (s && s.minOrder) || p?.minOrder || null;
}

/** Whole units from what a visitor typed ("12,000", "12 000"), or null. */
export function units(v) {
  const n = Number(String(v ?? '').replace(/[\s,]/g, ''));
  return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
}
