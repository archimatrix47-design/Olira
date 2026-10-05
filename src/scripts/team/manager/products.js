// Manager's products: which products draw interest and enquiries, and how
// complete each one is on the website. The marketing teams edit the catalogues;
// this is where the manager sees what to ask them for.
import { $, h, toast } from '../../admin/api.js';
import * as store from '../../admin/store.js';
import { sparkline, deltaChip, empty } from '../../admin/charts.js';
import { int, decimal, delta, NO_DATA } from '../../admin/format.js';
import { inPeriod } from '../../admin/leads.js';
import { agriCompleteness, packCompleteness } from '../../admin/completeness.js';
import { priceFrom, etb } from '../../catalogue-panel.js';

const view = () => $('[data-view="products"]');

export async function show() {
  const sel = view().querySelector('[data-period]');
  store.periodSelect(sel, () => load());
  sel.value = String(store.getDays());
  await load();
}

async function load() {
  view().setAttribute('aria-busy', 'true');
  try {
    const [a, prods, bags, inbox] = await Promise.all([store.analytics(), store.products().catch(() => []), store.packaging().catch(() => []), store.inquiries()]);
    renderAgri(a, prods || []);
    renderPack(bags || [], inPeriod(inbox?.inquiries || [], store.getDays()));
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { view().removeAttribute('aria-busy'); }
}

// Content completeness, out of 100: the same checklist the teams see on their lists.
const contentScore = agriCompleteness;
const meter = (score, missing) => {
  const bar = h('i'); const fill = h('b'); fill.style.width = `${score}%`; bar.append(fill);
  return h('span', { class: 'v-meter', title: missing.length ? `Add ${missing.join(', ')}` : 'Complete' }, bar, `${score}`,
    h('span', { class: 'sr-only' }, missing.length ? ` out of 100. Missing ${missing.join(', ')}` : ' out of 100, complete'));
};

function renderAgri(a, items) {
  const box = $('#prPerformance');
  const stats = new Map((a.products || []).map((x) => [x.name, x]));
  const rows = items.map((p) => ({ p, s: stats.get(p.name) || { clicks: 0, inquiries: 0, prevClicks: 0, daily: [] }, c: contentScore(p) }))
    .sort((x, y) => y.s.clicks - x.s.clicks || y.s.inquiries - x.s.inquiries);
  if (!rows.length) { box.replaceChildren(empty('The agriculture team has not added products yet.')); return; }
  const table = h('table', { class: 'a-table a-perf' },
    h('caption', { class: 'sr-only' }, 'Agriculture product performance'),
    h('thead', {}, h('tr', {}, ['Product', 'Details opened', 'Enquiries', 'Enquiries per 100 opens', 'Trend', 'Content'].map((t, i) => h('th', { scope: 'col', class: i && i < 4 ? 'num' : '' }, t)))),
    h('tbody', {}, rows.map(({ p, s, c }) => {
      const flags = [];
      if (s.clicks >= 10 && !s.inquiries) flags.push(h('span', { class: 'flag' }, 'Interest, no enquiries'));
      if (!p.image) flags.push(h('span', { class: 'flag' }, 'No photo'));
      if (!s.clicks) flags.push(h('span', { class: 'flag info' }, 'Not opened'));
      return h('tr', {},
        h('th', { scope: 'row' }, p.name, ...flags),
        h('td', { class: 'num' }, int(s.clicks), deltaChip(delta(s.clicks, s.prevClicks), true)),
        h('td', { class: 'num' }, int(s.inquiries)),
        h('td', { class: 'num' }, s.clicks ? decimal((s.inquiries / s.clicks) * 100) : NO_DATA),
        h('td', {}, s.daily?.some(Boolean) ? sparkline(s.daily, { width: 110, height: 28, label: `${p.name} opened per day` }) : h('span', { class: 'a-note' }, 'No opens')),
        h('td', {}, meter(c.score, c.missing)));
    })));
  const incomplete = rows.filter((r) => r.c.missing.length);
  box.replaceChildren(h('div', { class: 'a-scroll' }, table),
    h('p', { class: 'v-note' }, incomplete.length
      ? `To ask the agriculture team for: ${incomplete.slice(0, 3).map((r) => `${r.p.name} needs ${r.c.missing.join(', ')}`).join('. ')}.`
      : 'Every product has a photo, a full description, purity, minimum order and key points.'));
}

// A packaging product is designable in the studio once it has a photo and its print corners.
const inStudio = (p) => !!(p.image && Array.isArray(p.quad) && p.quad.length === 4);

function renderPack(bags, leads) {
  const box = $('#pkPerformance');
  if (!bags.length) { box.replaceChildren(empty('The packaging team has not added products yet.')); return; }
  const asked = new Map(), qty = new Map(), designed = new Map();
  for (const l of leads) {
    for (const b of l.bundle || []) {
      asked.set(b.productId, (asked.get(b.productId) || 0) + 1);
      qty.set(b.productId, (qty.get(b.productId) || 0) + (Number(b.qty) || 0));
    }
    if (l.design?.template) designed.set(l.design.template, (designed.get(l.design.template) || 0) + 1);
  }
  const rows = bags.map((p) => ({ p, asked: asked.get(p.id) || 0, qty: qty.get(p.id) || 0, designed: designed.get(p.id) || 0 }))
    .sort((x, y) => (y.asked + y.designed) - (x.asked + x.designed) || x.p.name.localeCompare(y.p.name));
  const yes = (ok) => (ok ? 'Yes' : h('span', { class: 'flag' }, 'Missing'));
  const table = h('table', { class: 'a-table a-perf' },
    h('caption', { class: 'sr-only' }, 'Packaging product demand and readiness'),
    h('thead', {}, h('tr', {}, ['Product', 'In packing lists', 'Units asked for', 'Studio designs', 'Photo', 'In the studio', 'Minimum order', 'Price per 1,000', 'Ready in', 'Content'].map((t, i) => h('th', { scope: 'col', class: i && i < 4 ? 'num' : '' }, t)))),
    h('tbody', {}, rows.map(({ p, asked: n, qty: q, designed: d }) => {
      const c = packCompleteness(p), from = priceFrom(p);
      return h('tr', {},
        h('th', { scope: 'row' }, p.name),
        h('td', { class: 'num' }, int(n)),
        h('td', { class: 'num' }, int(q)),
        h('td', { class: 'num' }, int(d)),
        h('td', {}, yes(!!p.image)),
        h('td', {}, inStudio(p) ? 'Yes' : h('span', { class: 'flag info' }, p.image ? 'Needs print corners' : 'Needs a photo')),
        h('td', {}, p.minOrder ? `${int(p.minOrder)} units` : (p.sizes || []).some((z) => z.minOrder) ? 'Per size' : h('span', { class: 'a-note' }, 'Agreed per quote')),
        h('td', {}, from ? `${from.varies || from.partial ? 'From ' : ''}${etb(from.price)}` : h('span', { class: 'flag' }, 'No price')),
        h('td', {}, p.leadTimeDays ? `${p.leadTimeDays} working days` : h('span', { class: 'a-note' }, 'Per quote')),
        h('td', {}, meter(c.score, c.missing)));
    })));
  const gaps = rows.filter((r) => !r.p.image).map((r) => r.p.name);
  const unpriced = rows.filter((r) => !priceFrom(r.p)).map((r) => r.p.name);
  const list = (names) => `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
  const asks = [gaps.length ? `photos of ${list(gaps)}` : null, unpriced.length ? `prices for ${list(unpriced)}` : null].filter(Boolean);
  box.replaceChildren(h('div', { class: 'a-scroll' }, table),
    h('p', { class: 'v-note' }, asks.length ? `To ask the packaging team for: ${asks.join('; ')}.` : 'Every packaging product on the website has a photo and a price.'));
}
