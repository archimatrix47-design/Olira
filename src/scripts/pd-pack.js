// A packaging product's own page: "Add to packing list", and the product in 3D.
//
// The packing list's drawer lives on the packaging page; here the product is
// added to the same list in this browser (packing-list.js reads it there), the
// header's count follows, and a link opens the drawer.
//
// The 3D package is box packaging-3d's viewer, built from the product's
// measurements and printed with the brand the visitor typed anywhere on the site,
// or their own logo or artwork. It shows only while the packaging team and the
// manager both have 3D switched on: the page asks the live switches first, so a
// switch turned off takes 3D off this page without a rebuild. A product with a
// photo gets a "See it in 3D" button; one without shows the package in the photo's
// place, once the panel is on screen and the browser is idle.
import { track } from './common.js';
import { has3d } from '../../lib/box-styles.js';

const KEY = 'olira-packing-list'; // packing-list.js

/* ---------- add to the packing list ---------- */
const addBtn = document.querySelector('[data-pd-add]');
const listLink = document.querySelector('.pd-list');
const read = () => { try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
function count(n) {
  const a = document.querySelector('[data-pl-link]'), c = a?.querySelector('.count');
  if (!c) return;
  c.textContent = String(n);
  c.toggleAttribute('data-zero', !n);
  if (n) a.hidden = false;
  a.setAttribute('aria-label', `Packing list, ${n} ${n === 1 ? 'product' : 'products'}`);
}
function inList(on) {
  if (!addBtn) return;
  addBtn.hidden = on;
  if (listLink) listLink.hidden = !on;
}
if (addBtn) {
  const id = addBtn.dataset.pdAdd;
  inList(read().some((l) => l?.productId === id));
  const status = document.createElement('p');
  status.className = 'sr-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  addBtn.after(status);
  addBtn.addEventListener('click', () => {
    const lines = read();
    if (!lines.some((l) => l?.productId === id)) {
      const min = Number(addBtn.dataset.min) || '';
      lines.push({ productId: id, sizeId: addBtn.dataset.size || '', qty: min, colours: '' });
      try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { location.href = '/packaging/?list=open#catalogue-title'; return; }
      track({ event: 'bundle_add' }); // the total, as from the catalogue
      track({ event: 'bundle_add_page' }); // and where it came from
    }
    count(lines.length);
    inList(true);
    status.textContent = `${addBtn.dataset.name} added to the packing list. ${lines.length} ${lines.length === 1 ? 'product' : 'products'} in the list.`;
    listLink?.focus();
  });
}

/* ---------- the product in 3D ---------- */
const media = document.querySelector('.pd-media[data-box3d]');
if (media) {
  let product = null;
  try { product = JSON.parse(media.dataset.box3d); } catch (e) { product = null; }
  if (product && has3d(product)) {
    // the switches as they are now; the build's own reading if the server cannot be reached
    fetch('/api/packaging-3d', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((live) => (typeof live?.on === 'boolean' ? live.on : product.live === true))
      .then(async (on) => {
        if (!on) return;
        const { mountViewer } = await import('./package-3d/viewer.js');
        const viewer = mountViewer({ media, panelHost: media.parentElement?.querySelector('.pd-copy .acts'), product, photo: !!product.photo, quoteHref: document.querySelector('.pd-copy .acts a.fill')?.getAttribute('href') || null, track });
        if (product.photo) return;
        const idle = (cb) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300));
        if ('IntersectionObserver' in window) {
          const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); idle(viewer.start); } });
          io.observe(media);
        } else idle(viewer.start);
      });
  }
}
