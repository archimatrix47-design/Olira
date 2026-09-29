// Home page.
//  - The agriculture door's product tiles (sesame, pulses, spices, coffee) open
//    that product in the range. Opening one is counted once per page view, for
//    the admin's Traffic page ("opened a product line from the first screen").
//  - The packaging door's products follow the live catalogue: when the packaging
//    team replaces a product's image in their workspace, the lineup shows the new
//    one without a rebuild. A product needs a cut-out (a transparent image) to
//    stand in the lineup; one without is left out until it has one.
import { $, $$, getJSON, track } from './common.js';
import { cutoutOf, standHTML } from './catalogue-panel.js';
import { marquee } from './marquee.js';

// Partner logos: the list the marketing teams keep, moving right to left.
// Built into the page, then refreshed from the live list, so a logo added in a
// workspace shows without a rebuild. Text and addresses are set as properties,
// never as markup.
const partnersBox = $('[data-partners]');
if (partnersBox) {
  const m = marquee($('[data-marquee]', partnersBox));
  getJSON('/api/partners').then((list) => {
    if (!Array.isArray(list)) return;
    const set = $('.marquee-set:not([aria-hidden])', partnersBox);
    const current = $$('li', set).map((li) => li.querySelector('img')?.getAttribute('src')).join('|');
    if (current === list.map((p) => p.logo).join('|') && set.children.length === list.length) return;
    set.replaceChildren(...list.map((p) => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = p.logo; img.alt = p.name; img.width = p.width || 160; img.height = p.height || 40; img.decoding = 'async';
      if (p.url) { const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.append(img); li.append(a); } else li.append(img);
      return li;
    }));
    partnersBox.hidden = list.length === 0;
    m.relayout();
  });
}

let counted = false;
for (const a of $$('.produce-tile')) {
  a.addEventListener('click', () => {
    if (counted) return;
    counted = true;
    track({ event: 'home_product' });
  });
}

const lineup = $('[data-lineup]');
if (lineup) {
  getJSON('/api/packaging-products').then((live) => {
    if (!Array.isArray(live)) return;
    const items = $$('.item', lineup);
    let changed = false;
    for (const el of items) {
      const p = live.find((x) => x.id === el.dataset.id);
      const c = p && cutoutOf(p);
      const now = el.querySelector('.cutimg')?.getAttribute('src');
      if (!c) { el.remove(); changed = true; continue; }
      if (c.cutout === now && JSON.stringify(c.quad) === el.querySelector('canvas')?.dataset.quad) continue;
      el.innerHTML = standHTML(c, p.name);
      el.dataset.ratio = String(c.width / c.height);
      changed = true;
    }
    if (!changed) return;
    // each product's share of the row again, from its true height and its image's proportions
    const kept = $$('.item', lineup);
    const units = kept.map((el) => Number(el.dataset.h || 80) * (Number(el.dataset.ratio) || ratioOf(el)));
    const total = units.reduce((a, b) => a + b, 0) || 1;
    const room = 100 - 4 * (kept.length - 1);
    kept.forEach((el, i) => el.style.setProperty('--w', (units[i] / total * room).toFixed(2)));
    document.dispatchEvent(new CustomEvent('catalogue:rendered')); // the live print paints the new images
  });
}

function ratioOf(el) {
  const img = el.querySelector('.cutimg');
  return img ? Number(img.getAttribute('width')) / Number(img.getAttribute('height')) || 0.7 : 0.7;
}
