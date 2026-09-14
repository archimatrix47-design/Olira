// Overview: first-party analytics from /api/analytics.
import { $, h, api, nf, toast } from './api.js';

const PAGE_NAMES = { '/': 'Home', '/agriculture/': 'Agriculture', '/packaging/': 'Packaging', '/404.html': 'Page not found' };
const DEVICE_NAMES = { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' };

let bound = false;
export async function show() {
  if (!bound) { bound = true; $('#range').addEventListener('change', load); }
  load();
}

async function load() {
  const days = $('#range').value;
  try {
    const [a, inbox] = await Promise.all([api(`/api/analytics?days=${days}`), api('/api/admin/inquiries').catch(() => null)]);
    render(a);
    const n = inbox?.counts?.new || 0;
    $('#newCallout').hidden = n === 0;
    $('#newCalloutText').textContent = `${n} new ${n === 1 ? 'enquiry is' : 'enquiries are'} waiting for a reply.`;
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  }
}

function render(a) {
  const t = a.totals || {};
  $('#kViews').textContent = nf.format(t.views || 0);
  $('#kVisitors').textContent = nf.format(t.uniques || 0);
  $('#kEnquiries').textContent = nf.format(t.inquiries || 0);
  $('#kRate').textContent = t.views ? (Math.round((t.inquiries / t.views) * 1000) / 10).toLocaleString() : '0';
  chart(a.series || [], a.range);
  bars($('#topPages'), (a.topPages || []).map((p) => ({ name: PAGE_NAMES[p.name] || p.name, count: p.count })), 'No page views yet.');
  bars($('#topRefs'), (a.topReferrers || []).map((r) => ({ name: r.name === 'direct' ? 'Typed in or bookmarked' : r.name, count: r.count })), 'No visits yet.');
  bars($('#devices'), Object.entries(a.devices || {}).map(([k, v]) => ({ name: DEVICE_NAMES[k] || k, count: v })).filter((d) => d.count > 0), 'No visits yet.');
  interest(a.products || []);
}

function bars(el, items, empty) {
  if (!items.length) { el.replaceChildren(h('p', { class: 'a-note' }, empty)); return; }
  const max = Math.max(...items.map((i) => i.count), 1);
  el.replaceChildren(...items.map((i) => {
    const fill = h('b'); fill.style.width = `${(i.count / max) * 100}%`;
    return h('div', { class: 'a-bar' }, h('div', {}, h('span', { title: i.name }, i.name), h('span', {}, nf.format(i.count))), h('i', { 'aria-hidden': 'true' }, fill));
  }));
}

function interest(rows) {
  const el = $('#productInterest');
  if (!rows.length) { el.replaceChildren(h('p', { class: 'a-note' }, 'No product details have been opened in this period.')); return; }
  el.replaceChildren(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'a-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col' }, 'Details opened'), h('th', { scope: 'col' }, 'Enquiries'))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row', style: 'font-weight:500;color:var(--ink);border-bottom:1px solid var(--line)' }, r.name), h('td', {}, nf.format(r.clicks)), h('td', {}, nf.format(r.inquiries))))))));
}

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

function chart(series, range) {
  const el = $('#chart');
  const W = 900, H = 220, P = { l: 36, r: 8, t: 10, b: 26 };
  const max = Math.max(4, ...series.map((d) => d.views));
  const step = (W - P.l - P.r) / Math.max(series.length, 1);
  const bw = Math.max(2, step * 0.62);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'a-chart', role: 'img' });
  const total = series.reduce((n, d) => n + d.views, 0);
  const best = series.reduce((b, d) => (d.views > (b?.views ?? -1) ? d : b), null);
  const title = s('title', {});
  title.textContent = `Page views per day over the last ${range} days: ${nf.format(total)} in total${best && best.views ? `, highest on ${best.date} with ${nf.format(best.views)}` : ''}.`;
  svg.append(title);
  for (const f of [0, 0.5, 1]) {
    const v = Math.round(max * f), yy = y(v);
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: yy, y2: yy, class: 'grid-line' }));
    const lbl = s('text', { x: P.l - 6, y: yy + 4, 'text-anchor': 'end', class: 'axis' }); lbl.textContent = nf.format(v); svg.append(lbl);
  }
  series.forEach((d, i) => {
    const x = P.l + i * step + (step - bw) / 2;
    svg.append(s('rect', { x, y: y(d.views), width: bw, height: Math.max(0, H - P.b - y(d.views)), rx: 2, class: 'v' }));
    svg.append(s('rect', { x: x + bw * 0.2, y: y(d.uniques), width: bw * 0.6, height: Math.max(0, H - P.b - y(d.uniques)), rx: 2, class: 'u' }));
    const every = Math.ceil(series.length / 6);
    if (i % every === 0) {
      const lbl = s('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis' });
      lbl.textContent = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      svg.append(lbl);
    }
  });
  el.replaceChildren(svg);
}
