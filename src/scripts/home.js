// Home page.
//  - The agriculture door's product tiles (sesame, pulses, spices, coffee) open
//    that product in the range. Opening one is counted once per page view, for
//    the admin's Traffic page ("opened a product line from the first screen").
//  - The packaging door's products follow the live catalogue (lineup.js).
import { $, $$, getJSON, track } from './common.js';
import { marquee } from './marquee.js';
import './lineup.js';

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
