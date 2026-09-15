// Chart primitives for the admin (plain SVG and HTML, no library).
// Rules from the ambient-ui dataviz reference: bars start at zero, the primary
// series is --accent and context is --ink-3, labels sit on the data instead of
// in a legend where possible, nothing is encoded by colour alone, and every
// chart ships a table with the same numbers.
import { h } from './api.js';
import { int, shortDate } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}
const text = (x, y, str, attrs = {}) => { const t = s('text', { x, y, ...attrs }); t.textContent = str; return t; };

/** "Show as table" disclosure with the chart's numbers. */
export function tableFor(caption, headers, rows) {
  return h('details', { class: 'v-table' },
    h('summary', {}, 'Show as table'),
    h('div', { class: 'v-table-scroll' },
      h('table', { class: 'a-table' },
        h('caption', { class: 'sr-only' }, caption),
        h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => (i ? h('td', { class: 'num' }, c) : h('th', { scope: 'row' }, c)))))))));
}

export function empty(message) {
  return h('p', { class: 'v-empty' }, message);
}

/** Tiny trend line for KPI cards: context grey, last point in accent. */
export function sparkline(values, { width = 120, height = 32, label = '' } = {}) {
  const vals = values.map((v) => Number(v) || 0);
  if (vals.length < 2) return h('span', { class: 'v-spark-empty' });
  const max = Math.max(...vals, 1), step = width / (vals.length - 1);
  const pts = vals.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)]);
  const last = pts[pts.length - 1];
  return s('svg', { class: 'v-spark', viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': label, preserveAspectRatio: 'none', style: `max-width:${width}px` },
    s('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'v-spark-line' }),
    s('circle', { cx: last[0], cy: last[1], r: 2.6, class: 'v-spark-dot' }));
}

/**
 * Time series: current period in accent, previous period dashed grey behind it,
 * optional marks (e.g. enquiry days) as a strip under the axis, peak annotated.
 */
export function trendChart({ dates, current, previous, marks, label, unit = 'visitors', markLabel = 'enquiries', width = 880 }) {
  // drawn at the container's real width so text stays at its true size (never under 11px)
  const W = Math.max(320, Math.round(width)), H = W < 560 ? 240 : 300, P = { l: 40, r: 78, t: 26, b: marks ? 56 : 30 };
  const n = dates.length;
  const all = [...current, ...(previous || [])];
  const max = Math.max(4, ...all);
  const nice = Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const x = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r));
  const y = (v) => P.t + (1 - v / nice) * (H - P.t - P.b);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'v-trend', role: 'img', 'aria-label': label });

  for (const f of [0, 0.5, 1]) {
    const v = nice * f;
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'v-grid' }), text(P.l - 8, y(v) + 4, int(v), { class: 'v-axis', 'text-anchor': 'end' }));
  }
  const ticks = Math.min(W < 560 ? 3 : 6, n);
  for (let k = 0; k < ticks; k++) {
    const i = Math.round((k / Math.max(ticks - 1, 1)) * (n - 1));
    svg.append(text(x(i), H - P.b + 18, shortDate(dates[i]), { class: 'v-axis', 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle' }));
  }
  // end-of-line labels, pushed apart when the two lines finish close together
  let yCur = y(current[n - 1]) + 4, yPrev = previous?.length ? y(previous[previous.length - 1]) + 4 : null;
  if (yPrev != null && Math.abs(yCur - yPrev) < 16) {
    const mid = (yCur + yPrev) / 2, curAbove = current[n - 1] >= previous[previous.length - 1];
    yCur = mid + (curAbove ? -9 : 9); yPrev = mid + (curAbove ? 9 : -9);
  }
  if (previous?.length) {
    svg.append(s('path', { d: path(previous), class: 'v-line-context' }));
    svg.append(text(W - P.r + 6, yPrev, 'Previous', { class: 'v-label-context' }));
  }
  svg.append(s('path', { d: `${path(current)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'v-area' }));
  svg.append(s('path', { d: path(current), class: 'v-line' }));
  svg.append(text(W - P.r + 6, yCur, 'This period', { class: 'v-label' }));

  // annotate the peak, the one point worth pointing at; keep clear of the end label
  const peak = current.reduce((b, v, i) => (v > current[b] ? i : b), 0);
  if (current[peak] > 0) {
    svg.append(s('circle', { cx: x(peak), cy: y(current[peak]), r: 4, class: 'v-dot' }));
    const nearEnd = x(peak) > W - P.r - 170;
    const anchor = nearEnd ? 'end' : x(peak) < 140 ? 'start' : 'middle';
    const ax = nearEnd ? x(peak) - 10 : x(peak);
    const ay = nearEnd ? Math.max(14, y(current[peak]) - 22) : y(current[peak]) - 10;
    svg.append(text(ax, ay, `Peak ${int(current[peak])} ${unit}, ${shortDate(dates[peak])}`, { class: 'v-annot', 'text-anchor': anchor }));
  }
  if (marks) {
    const my = H - P.b + 30;
    svg.append(text(P.l - 8, my + 4, markLabel.replace(/^./, (c) => c.toUpperCase()), { class: 'v-axis', 'text-anchor': 'end' }));
    marks.forEach((m, i) => {
      if (!m) return;
      const r = Math.min(9, 3 + m * 1.5);
      svg.append(s('circle', { cx: x(i), cy: my, r, class: 'v-mark' }, s('title', {}, `${shortDate(dates[i])}: ${m} ${markLabel}`)));
    });
  }
  // hover targets with native tooltips (no hover-only information: the table has it all)
  const colW = (W - P.l - P.r) / Math.max(n - 1, 1);
  dates.forEach((d, i) => {
    const t = `${shortDate(d)}: ${int(current[i])} ${unit}${previous ? `, previous period ${int(previous[i])}` : ''}${marks ? `, ${marks[i] || 0} ${markLabel}` : ''}`;
    svg.append(s('rect', { x: x(i) - colW / 2, y: P.t, width: colW, height: H - P.t - P.b + (marks ? 40 : 0), class: 'v-hit' }, s('title', {}, t)));
  });
  return svg;
}

/**
 * Sorted horizontal bars with the value, an optional previous-period change and
 * an optional second line of context. items: [{ label, value, display, note, delta }]
 */
export function barList(items, { max, emptyText = 'No data yet for this period.', tone = 'accent' } = {}) {
  if (!items.length) return empty(emptyText);
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return h('ol', { class: `v-bars v-bars-${tone}` }, items.map((i) => {
    const fill = h('b'); fill.style.width = `${Math.max(i.value > 0 ? 1.5 : 0, (i.value / top) * 100)}%`;
    return h('li', {},
      h('div', { class: 'v-bars-head' },
        h('span', { class: 'v-bars-label', title: i.title || i.label }, i.label),
        h('span', { class: 'v-bars-value' }, i.display ?? int(i.value), i.delta ? deltaChip(i.delta, true) : null)),
      h('i', { 'aria-hidden': 'true' }, fill),
      i.note ? h('small', {}, i.note) : null);
  }));
}

export function deltaChip(d, compact = false) {
  const icon = d.dir === 0 ? null : s('svg', { width: 9, height: 9, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: d.dir > 0 ? 'M5 1l4 7H1z' : 'M5 9L1 2h8z', fill: 'currentColor' }));
  return h('span', { class: `v-delta v-${d.tone}${compact ? ' is-compact' : ''}`, title: d.spoken },
    icon, h('span', { 'aria-hidden': 'true' }, d.text), h('span', { class: 'sr-only' }, d.spoken));
}

/** A 100% bar split into parts, labelled inside when there is room and in a key below. */
export function stackBar(parts, { label }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return empty('No data yet for this period.');
  const bar = h('div', { class: 'v-stack', role: 'img', 'aria-label': `${label}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}` });
  parts.forEach((p, i) => {
    if (!p.value) return;
    const share = (p.value / total) * 100;
    const seg = h('span', { class: `v-seg v-seg-${i}`, title: `${p.label}: ${int(p.value)} (${Math.round(share)}%)` }, share >= 12 ? `${Math.round(share)}%` : '');
    seg.style.width = `${share}%`;
    bar.append(seg);
  });
  const key = h('ul', { class: 'v-key' }, parts.filter((p) => p.value).map((p, i) => h('li', {}, h('i', { class: `v-seg-${parts.indexOf(p)}`, 'aria-hidden': 'true' }), `${p.label} `, h('b', {}, `${Math.round((p.value / total) * 100)}%`))));
  return h('div', {}, bar, key);
}

/** Funnel as descending bars: each step shows its count and the share kept from the step before. */
export function funnel(steps, { label }) {
  const first = steps[0]?.value || 0;
  if (!first) return empty('No visits recorded in this period yet.');
  return h('ol', { class: 'v-funnel', 'aria-label': label }, steps.map((st, i) => {
    const prevVal = i ? steps[i - 1].value : st.value;
    const kept = i && prevVal ? Math.round((st.value / prevVal) * 100) : null;
    const fill = h('b'); fill.style.width = `${Math.max(st.value ? 1.5 : 0, (st.value / first) * 100)}%`;
    return h('li', {},
      h('div', { class: 'v-funnel-head' }, h('span', {}, st.label), h('span', { class: 'v-funnel-num' }, int(st.value))),
      h('i', { 'aria-hidden': 'true' }, fill),
      i ? h('small', {}, prevVal ? `${kept}% of the step before${st.hint ? `. ${st.hint}` : ''}` : 'No one reached the step before') : h('small', {}, st.hint || ''));
  }));
}

/** Weekday by hour grid on a sequential ramp; the busiest cell is outlined and named. */
export function heatmap(matrix, { rowLabels, label }) {
  const max = Math.max(...matrix.flat(), 0);
  if (!max) return empty('No visits recorded with a time yet.');
  const level = (v) => (v === 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999)));
  let best = [0, 0];
  matrix.forEach((row, r) => row.forEach((v, c) => { if (v > matrix[best[0]][best[1]]) best = [r, c]; }));
  const grid = h('div', { class: 'v-heat', role: 'img', 'aria-label': label });
  grid.append(h('span', { class: 'v-heat-corner' }));
  for (let c = 0; c < 24; c++) grid.append(h('span', { class: 'v-heat-col' }, c % 3 === 0 ? String(c).padStart(2, '0') : ''));
  matrix.forEach((row, r) => {
    grid.append(h('span', { class: 'v-heat-row' }, rowLabels[r]));
    row.forEach((v, c) => grid.append(h('span', { class: `v-cell v-l${level(v)}${r === best[0] && c === best[1] ? ' is-best' : ''}`, title: `${rowLabels[r]} ${String(c).padStart(2, '0')}:00: ${int(v)} views` })));
  });
  return h('div', {}, grid, h('div', { class: 'v-heat-legend', 'aria-hidden': 'true' }, 'Fewer', ...[1, 2, 3, 4, 5].map((l) => h('i', { class: `v-cell v-l${l}` })), 'More'));
}

/**
 * Stacked columns for counts per bucket with up to two series; the second series
 * is hatched so the split never relies on colour. buckets: [{ label, values: [a, b] }]
 */
export function columns(buckets, { series, label, width = 880 }) {
  const W = Math.max(320, Math.round(width)), H = 240, P = { l: 34, r: 8, t: 20, b: 34 };
  const totals = buckets.map((b) => b.values.reduce((n, v) => n + v, 0));
  const max = Math.max(2, ...totals);
  const n = buckets.length;
  const slot = (W - P.l - P.r) / n, bw = Math.min(46, slot * 0.64);
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'v-cols', role: 'img', 'aria-label': label },
    s('defs', {}, s('pattern', { id: 'v-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 6, height: 6, class: 'v-col-1' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'v-hatch-line' }))));
  for (const f of [0, 0.5, 1]) { const v = Math.round(max * f); svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'v-grid' }), text(P.l - 6, y(v) + 4, int(v), { class: 'v-axis', 'text-anchor': 'end' })); }
  buckets.forEach((b, i) => {
    const cx = P.l + slot * i + slot / 2;
    let base = 0;
    b.values.forEach((v, k) => {
      if (!v) return;
      svg.append(s('rect', { x: cx - bw / 2, y: y(base + v), width: bw, height: y(base) - y(base + v), class: k ? 'v-col-hatch' : 'v-col-0', fill: k ? 'url(#v-hatch)' : null }, s('title', {}, `${b.label}: ${v} ${series[k]}`)));
      base += v;
    });
    if (totals[i]) svg.append(text(cx, y(totals[i]) - 5, int(totals[i]), { class: 'v-col-total', 'text-anchor': 'middle' }));
    const every = Math.ceil(n / Math.max(3, Math.floor(W / 90)));
    if (i % every === 0) svg.append(text(cx, H - 12, b.label, { class: 'v-axis', 'text-anchor': 'middle' }));
  });
  const key = h('ul', { class: 'v-key' }, series.map((name, k) => h('li', {}, h('i', { class: k ? 'v-key-hatch' : 'v-col-0', 'aria-hidden': 'true' }), name)));
  return h('div', {}, svg, key);
}
