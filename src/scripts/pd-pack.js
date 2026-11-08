// A packaging product's own page: "Add to packing list", and for a box with no
// photo yet, the box itself in 3D in the photo's place.
//
// The packing list's drawer lives on the packaging page; here the product is
// added to the same list in this browser (packing-list.js reads it there), the
// header's count follows, and a link opens the drawer.
//
// The 3D box is the studio's own scene (studio-3d-scene.js), built from the
// product's measurements (lib/box-styles.js boxOf) and printed with the brand the
// visitor typed anywhere on the site. three.js is fetched only on a page with no
// photo, once the panel is on screen and the browser is idle.
import { track } from './common.js';
import { boxOf } from '../../lib/box-styles.js';

const KEY = 'olira-packing-list'; // packing-list.js
const BRAND = 'olira-brand'; // live-print.js

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

/* ---------- the 3D box in place of a missing photo ---------- */
const media = document.querySelector('.pd-media[data-box3d]');
if (media) {
  let product = null;
  try { product = JSON.parse(media.dataset.box3d); } catch (e) { product = null; }
  const box = product && boxOf(product);
  if (box) {
    const start = async () => {
      media.classList.add('is-loading-3d');
      try {
        const { createScene } = await import('./studio-3d-scene.js');
        let brand = '';
        try { brand = (localStorage.getItem(BRAND) || '').trim(); } catch (e) { brand = ''; }
        const scene = createScene(media);
        scene.show({ ...box, sizes: true }, { state: { text1: brand ? brand.toUpperCase() : 'YOUR BRAND', text2: brand ? '' : 'yourbrand.com', ink: 'teal' } });
        media.classList.add('has-3d');
        track({ event: 'view_3d' });
        // the lid, and what this picture is
        const bar = document.createElement('div');
        bar.className = 'pd-3d-bar';
        const lid = document.createElement('button');
        lid.type = 'button'; lid.className = 'btn btn-secondary btn-sm'; lid.textContent = 'Open the lid'; lid.setAttribute('aria-pressed', 'false');
        let open = false;
        lid.addEventListener('click', () => { open = !open; scene.lid(open); lid.textContent = open ? 'Close the lid' : 'Open the lid'; lid.setAttribute('aria-pressed', String(open)); if (open) track({ event: 'lid_3d' }); });
        bar.append(lid);
        media.append(bar);
        const note = document.createElement('p');
        note.className = 'note pd-3d-note';
        note.textContent = `A 3D preview of the ${box.sizeLabel.toLowerCase()} size until the photo is ready. Drag to turn it. The final box follows the press's cutting die.`;
        // in the text column under the buttons: beside the panel, the page's grid has no place for it
        const acts = media.parentElement?.querySelector('.pd-copy .acts');
        if (acts) acts.after(note); else media.append(note);
      } catch (e) {
        // no WebGL here: the product's name stays in the panel, as before
      } finally {
        media.classList.remove('is-loading-3d');
      }
    };
    const idle = (cb) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); idle(start); } });
      io.observe(media);
    } else idle(start);
  }
}
