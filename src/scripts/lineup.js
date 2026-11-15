// The packaging lineup (PackLineup.astro) follows the live catalogue: when the
// packaging team replaces a product's image in their workspace, the lineup shows
// the new one without a rebuild. A product needs a cut-out (a transparent image)
// to stand in the lineup; one without is left out until it has one. Used on the
// home page and on the packaging page's first screen.
import { $$, getJSON } from './common.js';
import { cutoutOf, standHTML } from './catalogue-panel.js';

for (const lineup of $$('[data-lineup]')) {
  const brand = lineup.dataset.brand || '';
  getJSON('/api/packaging-products').then((live) => {
    if (!Array.isArray(live)) return;
    let changed = false;
    for (const el of $$('.item', lineup)) {
      const p = live.find((x) => x.id === el.dataset.id);
      const c = p && cutoutOf(p);
      const now = el.querySelector('.cutimg')?.getAttribute('src');
      if (!c) { el.remove(); changed = true; continue; }
      if (c.cutout === now && JSON.stringify(c.quad) === el.querySelector('canvas')?.dataset.quad) continue;
      el.innerHTML = standHTML(c, p.name, { brand });
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
