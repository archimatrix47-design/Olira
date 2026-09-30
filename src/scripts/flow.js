// The product carousel shared by the agriculture range and the packaging
// catalogue: an endless cover-flow ring of cards, and the front card grows into
// its detail panel. One card builder (cardHTML) is used both at build time
// (ProductFlow.astro) and here in the browser, so the two can never differ.
//
// mountFlow(root, opts) works inside one .flow-wrap and finds its parts by class,
// so a page can hold more than one. opts:
//   products   the list the ring starts with (as rendered)
//   onDetail   (product, panel) => fills the page-specific part of the detail
//   onOpen     (product) => called when a detail opens (analytics)
// Returns { set(list, keepId), current(), open(), close() }.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OPEN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

/** Signed shortest distance of card i from the front one, around the ring. */
export function ringOffset(i, active, n) {
  let o = (((i - active) % n) + n) % n;
  if (o > n / 2) o -= n;
  return o;
}

/**
 * One card. p: { id, name, sub, image, cat?, print? } where print is
 * { cutout, quad, safeTop } when the brand is printed on it live.
 */
export function cardHTML(p, i, active, n, { eager = false } = {}) {
  const o = ringOffset(i, active, n), a = Math.abs(o);
  const media = p.image
    ? `<img src="${esc(p.image)}" alt="" width="800" height="1000" draggable="false" decoding="async" loading="${a <= 1 || eager ? 'eager' : 'lazy'}">`
      + (p.print ? `<canvas class="flow-print" data-print data-cutout="${esc(p.print.cutout)}" data-quad="${esc(JSON.stringify(p.print.quad))}" data-safe-top="${Number(p.print.safeTop ?? 0.04)}" data-ink="teal" width="960" height="1200" aria-hidden="true"></canvas>` : '')
    : `<span class="flow-ph">${esc(p.sub || p.name)}</span>`;
  return `<li><button type="button" class="flow-card${o === 0 ? ' is-front' : ''}${a >= 3 ? ' is-far' : ''}${p.cutout ? ' is-cutout' : ''}" style="--a:${a};--s:${Math.sign(o)};z-index:${20 - a}" aria-label="${esc(p.name)}" tabindex="${o === 0 ? 0 : -1}"${a >= 3 ? ' aria-hidden="true"' : ''} data-id="${esc(p.id)}" data-cat="${esc((p.cat || '').toLowerCase())}">${media}<span class="flow-tag">${esc(p.name)}<span>${esc(p.sub || '')}</span></span><span class="flow-open" aria-hidden="true">${OPEN_ICON}View details</span></button></li>`;
}

export function mountFlow(root, { products = [], onDetail, onOpen } = {}) {
  const q = (s) => root.querySelector(s), qa = (s, el = root) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flow = q('.flow'), track = q('.flow-track'), dots = q('.flow-dots');
  const detail = q('.flow-detail'), box = q('.detail-box');
  let list = products;
  let cards = qa('.flow-card', track);
  let N = cards.length;
  let active = Math.max(0, cards.findIndex((c) => c.classList.contains('is-front')));
  let prevOffset = new Array(N).fill(null);
  let dragged = false;

  function layout() {
    if (!N) { q('.flow-cap h3').textContent = ''; q('.flow-cap p').textContent = ''; return; }
    cards.forEach((c, i) => {
      const o = ringOffset(i, active, N), a = Math.abs(o);
      // a card crossing from one end of the ring to the other jumps, not slides
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
    const p = list[active];
    q('.flow-cap h3').textContent = p.name;
    q('.flow-cap p').textContent = p.sub || '';
    qa('button', dots).forEach((d, i) => d.setAttribute('aria-current', String(i === active)));
  }
  const go = (i) => { if (!N) return; active = ((i % N) + N) % N; layout(); };
  const bind = () => {
    cards.forEach((c, i) => c.addEventListener('click', () => { if (dragged) return; if (i === active) open(); else go(i); }));
    qa('button', dots).forEach((d, i) => d.addEventListener('click', () => go(i)));
  };

  /** Replace the ring's products (a filter, or live data), keeping the front one if it is still there. */
  function set(next, keepId = list[active]?.id) {
    list = next; N = next.length;
    const k = next.findIndex((p) => p.id === keepId);
    // otherwise the first product with a photo comes to the front, not a placeholder
    active = k >= 0 ? k : Math.max(0, next.findIndex((p) => p.image));
    prevOffset = new Array(N).fill(null);
    track.innerHTML = next.map((p, i) => cardHTML(p, i, active, N)).join('');
    dots.replaceChildren(...next.map((p) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', p.name); return b; }));
    cards = qa('.flow-card', track);
    cards.forEach((c) => c.classList.add('no-anim'));
    bind(); layout();
    requestAnimationFrame(() => cards.forEach((c) => c.classList.remove('no-anim')));
    root.dispatchEvent(new CustomEvent('flow:rendered', { bubbles: true }));
  }

  q('.flow-open-btn').addEventListener('click', () => open());
  q('.flow-prev').addEventListener('click', () => go(active - 1));
  q('.flow-next').addEventListener('click', () => go(active + 1));
  flow.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  let startX = null;
  flow.addEventListener('pointerdown', (e) => { startX = e.clientX; dragged = false; });
  addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX; startX = null;
    if (Math.abs(dx) > 40) { dragged = true; go(active + (dx < 0 ? 1 : -1)); setTimeout(() => { dragged = false; }, 0); }
  });

  // First visit: once the ring has been on screen a moment without being touched,
  // the front card's "View details" pulses twice so it reads as clickable.
  let touched = false;
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => flow.addEventListener(ev, () => { touched = true; }, { once: true, passive: true }));
  if (!reduce && 'IntersectionObserver' in window) {
    let seen = false;
    try { seen = sessionStorage.getItem('olira-flow-hint') === '1'; } catch (e) {}
    if (!seen) {
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        io.disconnect();
        setTimeout(() => {
          if (touched) return;
          flow.classList.add('is-nudge');
          try { sessionStorage.setItem('olira-flow-hint', '1'); } catch (e) {}
          setTimeout(() => flow.classList.remove('is-nudge'), 2600);
        }, 1400);
      }, { threshold: 0.6 });
      io.observe(flow);
    }
  }

  /* ---------- the front card grows into its detail ---------- */
  function open() {
    const p = list[active];
    if (!p) return;
    const img = q('.detail-media img');
    if (p.image) { img.src = p.image; img.alt = p.name; img.hidden = false; } else img.hidden = true;
    q('.det-cat').textContent = p.sub || '';
    q('.det-name').textContent = p.name;
    q('.detail-desc').textContent = p.description || '';
    onDetail?.(p, detail);
    onOpen?.(p);
    const from = cards[active].getBoundingClientRect();
    detail.hidden = false;
    const to = box.getBoundingClientRect();
    if (!reduce) {
      box.classList.add('is-growing');
      box.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.6 },
        { transform: 'none', opacity: 1 },
      ], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' }).finished.then(() => box.classList.remove('is-growing'));
    }
    q('.detail-close').focus({ preventScroll: true });
  }
  function close() {
    if (detail.hidden) return;
    const done = () => { detail.hidden = true; cards[active]?.focus({ preventScroll: true }); };
    if (reduce || !cards[active]) return done();
    const to = cards[active].getBoundingClientRect(), from = box.getBoundingClientRect();
    box.classList.add('is-growing');
    // exits run faster than entrances, back to the card they came from
    box.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0.6 },
    ], { duration: 280, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(() => { box.classList.remove('is-growing'); done(); });
  }
  q('.detail-close').addEventListener('click', close);
  detail.addEventListener('click', (e) => { if (e.target === detail) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  bind(); layout();
  /** Bring a product to the front of the ring, if it is in it. */
  const show = (id) => { const i = list.findIndex((p) => p.id === id); if (i >= 0) go(i); return i >= 0; };
  return { set, show, current: () => list[active], open, close, get list() { return list; } };
}
