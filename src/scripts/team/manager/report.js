// Manager's report: the enquiry pipeline for the period, for both lines or one.
// How many arrived, how fast the team answered, how good they were, where they
// came from and what they asked for.
import { $, $$, h, toast } from '../../admin/api.js';
import * as store from '../../admin/store.js';
import { columns, barList, tableFor, empty } from '../../admin/charts.js';
import { kpiCard, bucketsFor } from '../../admin/widgets.js';
import { int, pct, hours, delta, NO_DATA } from '../../admin/format.js';
import { STAGES, lineOfLead, scoreOf, firstResponseHours, median, RESPONSE_BUCKETS, inPeriod, ageHours } from '../../admin/leads.js';
import { OPEN } from '../session.js';

let everything = [];
let bound = false;
const view = () => $('[data-view="report"]');
const line = () => $('input[name="reportLine"]:checked').value;

export async function show({ params } = {}) {
  if (!bound) {
    bound = true;
    $$('input[name="reportLine"]').forEach((r) => r.addEventListener('change', () => { render(); writeUrl(); }));
  }
  store.periodSelect(view().querySelector('[data-period]'), () => { render(); writeUrl(); });
  view().querySelector('[data-period]').value = String(store.getDays());
  const ln = params?.get('line');
  $(`input[name="reportLine"][value="${ln === 'agri' || ln === 'pack' ? ln : 'all'}"]`).checked = true;
  view().setAttribute('aria-busy', 'true');
  try {
    const d = await store.inquiries();
    everything = Array.isArray(d?.inquiries) ? d.inquiries : [];
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { view().removeAttribute('aria-busy'); }
}

function writeUrl() {
  const p = new URLSearchParams({ days: String(store.getDays()) });
  if (line() !== 'all') p.set('line', line());
  history.replaceState(null, '', `#report?${p}`);
}

function render() {
  const days = store.getDays(), ln = line();
  const all = ln === 'all' ? everything : everything.filter((l) => lineOfLead(l) === ln);
  const both = ln === 'all';
  const cur = inPeriod(all, days), prev = inPeriod(all, days, days);
  const won = cur.filter((l) => l.status === 'won').length, lost = cur.filter((l) => l.status === 'lost').length;
  const winRate = won + lost ? (won / (won + lost)) * 100 : null;
  const avg = (list) => (list.length ? list.reduce((n, l) => n + scoreOf(l).score, 0) / list.length : null);
  const avgScore = avg(cur), prevAvg = avg(prev);
  const resp = median(cur.map(firstResponseHours)), prevResp = median(prev.map(firstResponseHours));
  const open = all.filter((l) => OPEN.includes(l.status)).length;

  $('#enKpis').replaceChildren(
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), context: both ? `Agriculture ${cur.filter((l) => lineOfLead(l) === 'agri').length}, packaging ${cur.filter((l) => lineOfLead(l) === 'pack').length}` : 'Against the period before' }),
    kpiCard({ label: 'Open pipeline', value: int(open), context: `${all.filter((l) => l.status === 'new').length} new, ${all.filter((l) => l.status === 'quoted').length} quoted, across all time` }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: 'Arrival to first move out of New' }),
    kpiCard({ label: 'Win rate', value: winRate == null ? NO_DATA : pct(winRate, 0), context: won + lost ? `${won} won, ${lost} lost this period` : 'Mark enquiries Won or Lost to measure it' }),
    kpiCard({ label: 'Average lead score', value: avgScore == null ? NO_DATA : String(Math.round(avgScore)), delta: avgScore == null || prevAvg == null ? null : delta(avgScore, prevAvg), context: 'Out of 100, from the details buyers give' }),
  );

  // volume over time, by business line
  const buckets = bucketsFor(days).map((b) => {
    const inB = all.filter((l) => { const t = Date.parse(l.createdAt); return t >= b.start && t < b.end; });
    return { label: b.label, values: both ? [inB.filter((l) => lineOfLead(l) === 'agri').length, inB.filter((l) => lineOfLead(l) === 'pack').length] : [inB.length] };
  });
  const series = both ? ['Agriculture', 'Packaging'] : [ln === 'pack' ? 'Packaging' : 'Agriculture'];
  $('#enVolume').replaceChildren(cur.length
    ? h('div', {}, columns(buckets, { series, width: $('#enVolume').clientWidth, label: `Enquiries over time: ${cur.length} in this period` }),
      tableFor('Enquiries over time', ['Period', ...series], buckets.map((b) => [b.label, ...b.values.map(int)])))
    : empty('No enquiries in this period.'));

  // pipeline
  const max = Math.max(1, ...STAGES.map((s) => cur.filter((l) => l.status === s.id).length));
  $('#enPipeline').replaceChildren(
    h('div', { class: 'v-bigstat' }, h('strong', {}, winRate == null ? NO_DATA : pct(winRate, 0)), h('span', {}, 'of closed enquiries were won')),
    cur.length ? h('ol', { class: 'v-pipe', 'aria-label': 'Enquiries by stage' }, STAGES.map((s) => {
      const n = cur.filter((l) => l.status === s.id).length;
      const b = h('b'); b.style.width = `${(n / max) * 100}%`;
      return h('li', { class: s.id === 'won' ? 'is-won' : s.open ? '' : 'is-closed' }, h('span', {}, s.label), h('i', { 'aria-hidden': 'true' }, b), h('span', {}, int(n)));
    })) : empty('No enquiries in this period.'));

  // response speed
  const answered = cur.map(firstResponseHours).filter((x) => x != null);
  const waiting = cur.filter((l) => l.status === 'new');
  const speedItems = [
    ...RESPONSE_BUCKETS.map((b) => ({ label: b.label, value: answered.filter(b.test).length })),
    { label: 'Still waiting in New', value: waiting.length, note: waiting.length ? `Oldest has waited ${hours(Math.max(...waiting.map(ageHours)))}` : null },
  ];
  $('#enSpeed').replaceChildren(
    cur.length ? barList(speedItems, { max: Math.max(1, ...speedItems.map((i) => i.value)) }) : empty('No enquiries in this period.'),
    h('p', { class: 'v-note' }, 'Studies of inbound sales leads find that a reply within the first hour makes a lead several times more likely to turn into business than a reply the next day.'),
    cur.length ? tableFor('Response speed', ['Time to first response', 'Enquiries'], speedItems.map((i) => [i.label, int(i.value)])) : h('span'));

  // lead quality
  const bands = { strong: 0, fair: 0, thin: 0 };
  const missing = {};
  cur.forEach((l) => {
    const sc = scoreOf(l); bands[sc.band]++;
    sc.checks.filter((c) => !c.ok).forEach((c) => { missing[c.gap] = (missing[c.gap] || 0) + 1; });
  });
  const gaps = Object.entries(missing).sort((x, y) => y[1] - x[1]).slice(0, 3);
  $('#enQuality').replaceChildren(
    cur.length ? barList([
      { label: 'Strong (70 and over)', value: bands.strong },
      { label: 'Fair (40 to 69)', value: bands.fair },
      { label: 'Thin (under 40)', value: bands.thin },
    ], { max: Math.max(1, cur.length) }) : empty('No enquiries in this period.'),
    gaps.length ? h('p', { class: 'v-note' }, `Most often missing: ${gaps.map(([k, n]) => `${k} (${n})`).join(', ')}. Asking for these in the first reply speeds up quoting.`) : h('span'));

  // markets and products
  const markets = {}, products = {}, ports = {};
  cur.forEach((l) => {
    const d = scoreOf(l).details;
    if (d.market) markets[d.market.name] = (markets[d.market.name] || 0) + 1;
    if (d.port) ports[d.port] = (ports[d.port] || 0) + 1;
    const p = l.product || 'Not specified'; products[p] = (products[p] || 0) + 1;
  });
  const top = (o, n = 5) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([label, value]) => ({ label, value }));
  $('#enMarkets').replaceChildren(
    h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'Markets'),
    barList(top(markets), { emptyText: 'No phone codes or country email domains yet.' }),
    h('h3', { class: 'a-label', style: 'margin:16px 0 10px' }, 'Asked for'),
    barList(top(products), { tone: 'b', emptyText: 'No enquiries in this period.' }),
    Object.keys(ports).length ? h('p', { class: 'v-note' }, `Destination ports named: ${top(ports, 6).map((p) => `${p.label} (${p.value})`).join(', ')}.`) : h('span'));
}
