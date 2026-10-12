// The product grid shared by the agriculture range and the packaging catalogue:
// every product in view at once, each card opening into its details window. One
// card builder (cardHTML) is used at build time (ProductGrid.astro) and here in
// the browser, so the two can never differ.
//
// mountGrid(root, opts) works inside one .pgrid-wrap and finds its parts by
// class, so a page can hold more than one. opts:
//   products   the list as rendered
//   onDetail   (product, dialog) => fills the page's own part of the details
//   onOpen     (product) => called when a details window opens (analytics)
// Returns { set(list), show(id), pick(test), current(), open(id), close(), list }.
import { thumbSrcset } from '../../lib/thumb-url.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OPEN_ICON = '<svg class="pg-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

/** How wide a card's photo is drawn: two columns on a phone, three on a tablet, four from 1024 px. */
export const CARD_SIZES = '(max-width: 699px) 46vw, (max-width: 1023px) 31vw, 280px';
/** Cards in the first row on a wide screen: their photos load at once, the rest when scrolled to. */
export const EAGER = 4;
/** How wide the details window draws its photo: the full width on a phone, its left column elsewhere. */
export const DETAIL_SIZES = '(max-width: 760px) calc(100vw - 24px), 450px';

/** What a card shows: a change to any of it means the card is rebuilt, otherwise it is kept (and its print). */
export const itemKey = (p) => JSON.stringify([p.id, p.name, p.sub || '', p.image || '', p.cutout ? 1 : 0, p.print || null, p.note || '']);

/**
 * One card. p: { id, name, sub, image, cat?, cutout?, note?, print? } where print is
 * { cutout, quad, safeTop } when the brand is printed on it live, and note is the
 * line a card without a photo shows instead (its sizes). `lazy`: the photo waits for
 * the browser; `eager`: it loads at once.
 */
export function cardHTML(p, { eager = false, lazy = false } = {}) {
  const set = p.image && thumbSrcset(p.image);
  const media = p.image
    ? `<img src="${esc(p.image)}"${set ? ` srcset="${esc(set)}" sizes="${CARD_SIZES}"` : ''} alt="" width="800" height="1000" draggable="false" decoding="async" loading="${eager && !lazy ? 'eager' : 'lazy'}">`
      + (p.print ? `<canvas class="flow-print" data-print data-cutout="${esc(p.print.cutout)}" data-quad="${esc(JSON.stringify(p.print.quad))}" data-safe-top="${Number(p.print.safeTop ?? 0.04)}" data-ink="teal" width="640" height="800" aria-hidden="true"></canvas>` : '')
    : `<span class="pg-ph" aria-hidden="true"><b>${esc(p.name)}</b>${p.note ? `<small>${esc(p.note)}</small>` : ''}</span>`;
  return `<li data-id="${esc(p.id)}" data-key="${esc(itemKey(p))}"><button type="button" class="pg-card${p.cutout ? ' is-cutout' : ''}${p.image ? '' : ' no-photo'}" data-id="${esc(p.id)}" data-cat="${esc((p.cat || '').toLowerCase())}" aria-haspopup="dialog"><span class="pg-media">${media}</span><span class="pg-cap"><span class="pg-name">${esc(p.name)}</span>${p.sub ? `<span class="pg-sub">${esc(p.sub)}</span>` : ''}${OPEN_ICON}</span></button></li>`;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountGrid(root, { products = [], onDetail, onOpen } = {}) {
  const q = (s) => root.querySelector(s);
  const grid = q('.pgrid'), detail = q('.flow-detail'), box = q('.detail-box');
  const lazy = root.hasAttribute('data-lazy');
  let list = products;
  let picked = null; // the product whose details were opened last
  let from = null;   // the card they were opened from, where they return to

  const cards = () => [...grid.querySelectorAll('.pg-card')];
  const cardOf = (id) => cards().find((c) => c.dataset.id === id) || null;
  const toLi = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.pg-card');
    if (c && grid.contains(c)) open(c.dataset.id, c);
  });

  /**
   * Show another list (a filter, or products changed since the build). Cards still
   * in it are kept, with their photos and prints, and glide to their new places;
   * new ones fade in. Without motion the grid simply changes.
   */
  function set(next) {
    const before = new Map([...grid.children].map((li) => [li.dataset.id, li.getBoundingClientRect()]));
    const kept = new Map([...grid.children].map((li) => [li.dataset.id, li]));
    const items = next.map((p, i) => {
      const old = kept.get(p.id);
      return old && old.dataset.key === itemKey(p) ? old : toLi(cardHTML(p, { lazy, eager: i < EAGER }));
    });
    grid.replaceChildren(...items);
    list = next;
    if (!reduced()) {
      for (const li of items) {
        const was = before.get(li.dataset.id);
        if (!was) { li.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 80, easing: 'cubic-bezier(0,0,.2,1)', fill: 'backwards' }); continue; }
        const now = li.getBoundingClientRect();
        const dx = was.left - now.left, dy = was.top - now.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)' });
      }
    }
    root.dispatchEvent(new CustomEvent('flow:rendered', { bubbles: true }));
  }

  /* ---------- a card grows into its details window ---------- */
  const rect = (el) => el.getBoundingClientRect();

  /**
   * The details photo. A browser keeps showing an image's old picture until a new
   * file has loaded, so changing src on one element showed the last product for a
   * moment. Each opening gets a fresh element that starts from the card's own photo,
   * already loaded, and only then asks for a sharper copy for the larger window.
   */
  function showPhoto(p, card) {
    const media = q('.detail-media');
    const old = media.querySelector('img');
    const img = old.cloneNode(false);
    img.removeAttribute('srcset'); img.removeAttribute('sizes');
    // the card's photo is already loaded and decoded: drawn onto a canvas it shows at
    // once, under the window's own image, and steps aside when that image has loaded
    let quick = media.querySelector('canvas.det-quick');
    if (!quick) { quick = document.createElement('canvas'); quick.className = 'det-quick'; quick.setAttribute('aria-hidden', 'true'); media.prepend(quick); }
    quick.hidden = true;
    if (p.image) {
      const seen = card?.querySelector('.pg-media img');
      const ready = seen?.complete && seen.naturalWidth > 0;
      if (ready) {
        quick.width = seen.naturalWidth; quick.height = seen.naturalHeight;
        quick.getContext('2d').drawImage(seen, 0, 0);
        quick.hidden = false;
      }
      img.addEventListener('load', () => { quick.hidden = true; }, { once: true });
      img.src = (ready && seen.currentSrc) || p.image;
      img.alt = p.name; img.hidden = false;
      const set = thumbSrcset(p.image);
      if (set) {
        const sharpen = () => { img.sizes = DETAIL_SIZES; img.srcset = set; };
        if (img.complete) sharpen(); else img.addEventListener('load', sharpen, { once: true });
      }
      if (img.complete && img.naturalWidth) quick.hidden = true;
    } else { img.removeAttribute('src'); img.alt = ''; img.hidden = true; }
    old.replaceWith(img);
  }
  function open(id, card = cardOf(id)) {
    const p = list.find((x) => x.id === id);
    if (!p) return;
    picked = p; from = card;
    showPhoto(p, card);
    q('.detail-media').classList.toggle('no-photo', !p.image);
    q('.det-cat').textContent = p.sub || '';
    q('.det-name').textContent = p.name;
    q('.detail-desc').textContent = p.description || '';
    onDetail?.(p, detail);
    onOpen?.(p);
    if (typeof detail.showModal === 'function') { if (!detail.open) detail.showModal(); } else detail.setAttribute('open', '');
    q('.detail-close').focus({ preventScroll: true });
    if (reduced() || !card) return;
    const a = rect(card), b = rect(box);
    box.classList.add('is-growing');
    box.animate([
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: 0.6 },
      { transform: 'none', opacity: 1 },
    ], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' }).finished.finally(() => box.classList.remove('is-growing'));
  }
  function close() {
    if (!detail.open) return;
    const back = from?.isConnected ? from : null;
    const done = () => { detail.close?.(); detail.removeAttribute('open'); back?.focus({ preventScroll: true }); };
    if (reduced() || !back) return done();
    const a = rect(back), b = rect(box);
    box.classList.add('is-growing');
    // exits run faster than entrances, back to the card they came from
    box.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: 0.6 },
    ], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }).finished.finally(() => { box.classList.remove('is-growing'); done(); });
  }
  q('.detail-close').addEventListener('click', close);
  // Escape: close the same way as the button (the browser would close it at once)
  detail.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // a click on the shade around the window
  detail.addEventListener('click', (e) => { if (e.target === detail) close(); });

  /** Point at the cards that pass test (a product line from the home page): a ring that fades. */
  function pick(test) {
    const hit = cards().filter((c) => test(c.dataset));
    hit.forEach((c) => c.classList.add('is-picked'));
    if (hit.length) setTimeout(() => hit.forEach((c) => c.classList.remove('is-picked')), 2400);
    return hit;
  }
  /** Scroll one product's card into view and point at it; false when it is not in the grid. */
  function show(id) {
    const c = cardOf(id);
    if (!c) return false;
    c.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    pick((d) => d.id === id);
    return true;
  }

  return { set, show, pick, open, close, current: () => picked || list[0] || null, get list() { return list; } };
}
