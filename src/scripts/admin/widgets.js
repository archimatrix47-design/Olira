// Small shared pieces for the insight views.
import { h } from './api.js';
import { sparkline, deltaChip } from './charts.js';
import { NO_DATA, longDate } from './format.js';

/** KPI card: label, value, delta and sparkline, context (dataviz.md §5). */
export function kpiCard({ label, value, delta, spark, context, sparkLabel }) {
  const noData = value === NO_DATA;
  return h('div', { class: 'a-card k-card' },
    h('p', {}, label),
    h('div', { class: `k-value${noData ? ' is-nodata' : ''}` }, value),
    h('div', { class: 'k-row' }, delta ? deltaChip(delta) : h('span'), spark ? sparkline(spark, { label: sparkLabel || `${label} per day` }) : null),
    context ? h('small', {}, context) : null);
}

/** "Showing … Updated … Sources recorded since …" line under a view heading. */
export function freshness(view, a, days) {
  const el = view.querySelector('[data-freshness]');
  if (!el) return;
  const parts = [`Last ${days === 365 ? '12 months' : `${days} days`}, compared with the ${days === 365 ? '12 months' : `${days} days`} before.`];
  parts.push(`Updated ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`);
  if (a?.firstTracked) {
    const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    if (a.firstTracked > start) parts.push(`Sources, engagement, markets and actions have been recorded since ${longDate(a.firstTracked)}, so earlier days show visits only.`);
  } else if (a) {
    parts.push('Sources, engagement, markets and actions start recording with the next visit.');
  }
  el.textContent = parts.join(' ');
}

const ICONS = {
  ok: 'M20 6L9 17l-5-5',
  todo: 'M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  optional: 'M12 5v14M5 12h14',
};
export function statusIcon(kind) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: kind })) svg.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[kind]); svg.append(p);
  return svg;
}

/** Group dated items into buckets matching the period: days up to 31, else weeks, else months. */
export function bucketsFor(days) {
  const now = new Date();
  const out = [];
  if (days <= 31) {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000); const key = d.toISOString().slice(0, 10);
      out.push({ key, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), start: Date.parse(`${key}T00:00:00Z`), end: Date.parse(`${key}T00:00:00Z`) + 86400000 });
    }
  } else if (days <= 120) {
    const weeks = Math.ceil(days / 7);
    for (let w = weeks - 1; w >= 0; w--) {
      const end = now.getTime() - w * 7 * 86400000, start = end - 7 * 86400000;
      out.push({ key: `w${w}`, label: new Date(start + 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), start, end });
    }
  } else {
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      out.push({ key: `m${m}`, label: d.toLocaleDateString(undefined, { month: 'short' }), start: d.getTime(), end: end.getTime() });
    }
  }
  return out;
}
