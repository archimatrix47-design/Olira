// The live print: the visitor types their brand once, and it is printed on every
// product on the page by the same engine as the mockup studio. Each product is a
// transparent cut-out with its print area measured on it; a <canvas data-print>
// lies exactly over the cut-out, and the brand is warped into that area in
// perspective and multiplied into the paper, so it never lands on food, a lid or
// an edge. The result is then trimmed to the product's own outline.
//
// The brand is kept in this browser (localStorage), so it follows the visitor
// from the catalogue into the studio. A canvas with data-brand="olira" (the home
// page's products) shows Olira's own logo instead, whatever is typed.
import { prepare, render, defaultDesign, INKS } from './mockup/engine.js';

const KEY = 'olira-brand';
const MAX = 18;
const FALLBACK = 'Your brand';
const WIDTH = 640; // canvas pixels: sharp at the sizes the products are shown
const inputs = [...document.querySelectorAll('input[data-brand-input]')];
let brand = '';
try { brand = (localStorage.getItem(KEY) || '').slice(0, MAX); } catch (e) { brand = ''; }
const text = () => (brand.trim() || FALLBACK).slice(0, MAX);

const canvases = () => [...document.querySelectorAll('canvas[data-print]')];
const own = (c) => c.dataset.brand === 'olira';
// what a canvas should show: Olira's own print, or the visitor's brand
const wanted = (c) => (own(c) ? 'olira' : text());

// Olira's logo: the one uploaded in the admin (Logo), else the shipped one
let logo = null;
function oliraLogo() {
  logo ||= fetch('/api/branding').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((b) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { if (img.src.endsWith('/logo.png')) resolve(null); else img.src = '/logo.png'; };
      img.src = b?.logo || '/logo.png';
    }));
  return logo;
}

function productOf(c) {
  try {
    const safeTop = Number(c.dataset.safeTop);
    return { image: c.dataset.cutout, quad: JSON.parse(c.dataset.quad), safeTop: Number.isFinite(safeTop) ? safeTop : 0.04 };
  } catch (e) { return null; }
}

const drawn = new WeakMap();
async function paint(c) {
  const p = productOf(c);
  if (!p?.image || !Array.isArray(p.quad) || p.quad.length !== 4) return;
  const want = wanted(c);
  drawn.set(c, want);
  try {
    const [B, mark] = await Promise.all([prepare(p, { dark: false, width: WIDTH }), own(c) ? oliraLogo() : null]);
    if (drawn.get(c) !== want) return; // typed again while the photo loaded
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const ink = INKS[c.dataset.ink] ? c.dataset.ink : 'teal';
    const design = own(c)
      // Olira's own: the logo alone, in its colours (it already spells the name)
      ? { ...defaultDesign(), ink: 'teal', logo: mark, text1: '', text2: '', placeholder: false }
      : { ...defaultDesign(), ink, text1: want.toUpperCase(), text2: '', placeholder: false };
    render(ctx, B, design);
    // the print is multiplied onto the photo; where the photo is transparent that
    // would leave ink in the air, so keep only what lies on the product itself
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(B.photo, 0, 0);
    ctx.restore();
    c.classList.add('is-printed');
  } catch (e) {
    drawn.delete(c);
    c.classList.add('is-failed'); // the plain cut-out underneath still shows
  }
}

// only what is on screen (or about to be) is printed; the rest waits until it scrolls in
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && drawn.get(e.target) !== wanted(e.target)) paint(e.target);
}, { rootMargin: '300px 0px' }) : null;
const watch = () => canvases().forEach((c) => { if (io) io.observe(c); else paint(c); });

const near = (c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.bottom > -300 && r.top < innerHeight + 300; };

function echo() {
  document.querySelectorAll('[data-brand-echo]').forEach((n) => { n.textContent = text(); });
  document.querySelectorAll('[data-brand-left]').forEach((n) => { n.textContent = String(MAX - brand.length); });
}

// the studio's main text starts from the brand, until the visitor edits it there
const studioText = document.getElementById('text1');
let studioOwn = false;
studioText?.addEventListener('input', (e) => { if (e.isTrusted) studioOwn = true; });
function toStudio() {
  if (!studioText || studioOwn || !brand.trim()) return;
  studioText.value = text().toUpperCase();
  studioText.dispatchEvent(new Event('input', { bubbles: true }));
}

let frame = 0;
function setBrand(value, from) {
  brand = String(value || '').slice(0, MAX);
  try { localStorage.setItem(KEY, brand); } catch (e) { /* private window: this page only */ }
  for (const i of inputs) if (i !== from) i.value = brand;
  echo();
  toStudio();
  cancelAnimationFrame(frame);
  // Olira's own prints do not change with what is typed
  frame = requestAnimationFrame(() => canvases().filter((c) => !own(c)).forEach((c) => { if (near(c)) paint(c); else drawn.delete(c); }));
  document.dispatchEvent(new CustomEvent('brand:change', { detail: { brand: text() } }));
}

for (const i of inputs) {
  i.value = brand;
  i.addEventListener('input', () => setBrand(i.value, i));
}
echo();
// the engine sets type in Hanken Grotesk: wait for it, or the first print uses a fallback face
(document.fonts?.load('700 40px "Hanken Grotesk"') || Promise.resolve()).catch(() => {}).then(() => { watch(); toStudio(); });
document.addEventListener('catalogue:rendered', watch);

export const liveBrand = { get: text, set: setBrand };
