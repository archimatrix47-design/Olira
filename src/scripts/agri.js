// Agriculture page: an endless cover-flow stack. Cards wrap around both ends,
// and the front card grows into its detail view.
//
// The cards are rendered at build time from data/products.json, already laid
// out (site.css positions each card from --a and --s). This script takes over
// from there, and re-renders the stack if the admin has changed the products
// since the build.
import { $, $$, h, reduce, prefill, getJSON, track } from './common.js';

const flow = $('#flow'), track_ = $('#flowTrack'), dots = $('#flowDots');
let PRODUCTS = JSON.parse($('#productsData').textContent || '[]');
let cards = $$('.flow-card', track_);
let N = cards.length;
let active = Math.max(0, cards.findIndex((c) => c.classList.contains('is-front')));
let prevOffset = new Array(N).fill(null);
let dragged = false;

const wrap = (i) => ((i % N) + N) % N;
// signed shortest distance around the ring, so the stack never ends
function ringOffset(i) {
  let o = wrap(i - active);
  if (o > N / 2) o -= N;
  return o;
}

function layout() {
  if (!N) return;
  cards.forEach((c, i) => {
    const o = ringOffset(i), a = Math.abs(o);
    // a card crossing from one end of the ring to the other jumps instead of
    // sliding through the middle of the stack
    const jumped = prevOffset[i] !== null && Math.abs(prevOffset[i] - o) > 1;
    if (jumped) c.classList.add('no-anim');
    c.style.setProperty('--a', String(a));
    c.style.setProperty('--s', String(Math.sign(o)));
    c.style.zIndex = String(20 - a);
    c.tabIndex = o === 0 ? 0 : -1;
    c.classList.toggle('is-front', o === 0);
    c.classList.toggle('is-far', a >= 3);
    if (a >= 3) c.setAttribute('aria-hidden', 'true'); else c.removeAttribute('aria-hidden');
    if (jumped) { void c.offsetWidth; c.classList.remove('no-anim'); }
    prevOffset[i] = o;
  });
  const p = PRODUCTS[active];
  $('#capName').textContent = p.name;
  $('#capSub').textContent = p.category || '';
  $$('button', dots).forEach((d, i) => d.setAttribute('aria-current', String(i === active)));
}
function go(i) { active = wrap(i); layout(); }

function bindCard(c, i) {
  c.addEventListener('click', () => { if (dragged) return; if (i === active) openDetail(); else go(i); });
}
function bindDot(d, i) { d.addEventListener('click', () => go(i)); }
cards.forEach(bindCard);
$$('button', dots).forEach(bindDot);

// rebuild with the same markup as agriculture.astro (text only, never HTML)
function rebuild(list) {
  PRODUCTS = list; N = list.length; active = Math.min(active, N - 1); prevOffset = new Array(N).fill(null);
  track_.replaceChildren(...list.map((p, i) => {
    const b = h('button', { type: 'button', class: 'flow-card no-anim', 'aria-label': p.name, 'data-id': p.id, 'data-cat': (p.category || '').toLowerCase() });
    if (p.image) b.append(h('img', { src: p.image, alt: '', width: '800', height: '600', draggable: 'false', decoding: 'async' }));
    else b.append(h('span', { class: 'flow-ph' }, p.category || p.name));
    const tag = h('span', { class: 'flow-tag' }, p.name); tag.append(h('span', {}, p.category || '')); b.append(tag);
    return h('li').appendChild(b).parentNode;
  }));
  dots.replaceChildren(...list.map((p) => h('button', { type: 'button', 'aria-label': p.name })));
  cards = $$('.flow-card', track_);
  cards.forEach(bindCard);
  $$('button', dots).forEach(bindDot);
  layout();
  requestAnimationFrame(() => cards.forEach((c) => c.classList.remove('no-anim')));
}

$('#flowPrev').addEventListener('click', () => go(active - 1));
$('#flowNext').addEventListener('click', () => go(active + 1));
flow.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); }
});
let startX = null;
flow.addEventListener('pointerdown', (e) => { startX = e.clientX; dragged = false; });
addEventListener('pointerup', (e) => {
  if (startX == null) return;
  const dx = e.clientX - startX; startX = null;
  if (Math.abs(dx) > 40) { dragged = true; go(active + (dx < 0 ? 1 : -1)); setTimeout(() => { dragged = false; }, 0); }
});
layout();

getJSON('/api/products').then((live) => {
  if (!Array.isArray(live) || !live.length) return;
  if (JSON.stringify(live) === JSON.stringify(PRODUCTS)) return; // unchanged since the build
  const id = PRODUCTS[active]?.id;
  const keep = live.findIndex((p) => p.id === id);
  active = keep >= 0 ? keep : 0;
  rebuild(live);
});

/* ---------- expand the front card into its detail ---------- */
const detail = $('#flowDetail'), box = $('#detailBox');
function openDetail() {
  const p = PRODUCTS[active];
  const img = $('#detImg');
  if (p.image) { img.src = p.image; img.alt = p.name; img.hidden = false; } else img.hidden = true;
  $('#detCat').textContent = p.category || '';
  $('#detName').textContent = p.name;
  $('#detDesc').textContent = p.description || '';
  const dl = $('#detSpec'); dl.replaceChildren();
  for (const [k, v] of [['Purity', p.purity], ['Min. order', p.moq]]) if (v) dl.append(h('dt', {}, k), h('dd', {}, v));
  dl.hidden = !dl.children.length;
  $('#detSpecs').replaceChildren(...(p.specs || []).map((s) => h('li', {}, s)));
  track({ event: 'product', product: p.name });
  const from = cards[active].getBoundingClientRect();
  detail.hidden = false;
  const to = box.getBoundingClientRect();
  if (!reduce) {
    box.classList.add('is-growing');
    box.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { transform: 'none' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => box.classList.remove('is-growing'));
  }
  $('#detClose').focus({ preventScroll: true });
}
function closeDetail() {
  if (detail.hidden) return;
  const done = () => { detail.hidden = true; cards[active].focus({ preventScroll: true }); };
  if (reduce) return done();
  const to = cards[active].getBoundingClientRect(), from = box.getBoundingClientRect();
  box.classList.add('is-growing');
  box.animate([
    { transform: 'none' },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` },
  ], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(() => { box.classList.remove('is-growing'); done(); });
}
$('#detClose').addEventListener('click', closeDetail);
detail.addEventListener('click', (e) => { if (e.target === detail) closeDetail(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
$('#detAsk').addEventListener('click', () => {
  const p = PRODUCTS[active];
  closeDetail();
  const form = $('#inquiry'); if (form) form.dataset.product = p.name;
  prefill(`Interested in ${p.name}. Volume and shipment window: `);
});

// certifications are admin-managed too
const certList = $('#certList');
if (certList) {
  getJSON('/api/certifications').then((list) => {
    if (!Array.isArray(list)) return;
    certList.replaceChildren(...list.map((c) => { const li = h('li'); li.append(h('b', {}, c.name), c.description || ''); return li; }));
    $('#certs').hidden = list.length === 0;
  });
}
