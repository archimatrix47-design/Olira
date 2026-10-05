// A marketing team's insights: views of its own pages, its products' opens and
// enquiries, where visitors come from (site-wide), and its own sales numbers
// from the enquiries it can already see. Data: /api/team/insights (the server
// keeps each team to its own line) and the team's enquiries.
import { $, h, api, toast } from '../admin/api.js';
import * as store from '../admin/store.js';
import { kpiCard } from '../admin/widgets.js';
import { trendChart, tableFor, sparkline, barList, deltaChip, empty } from '../admin/charts.js';
import { int, decimal, delta, hours, duration, pct, shortDate, countryName, CHANNEL_NAMES, NO_DATA } from '../admin/format.js';
import { inPeriod, firstResponseHours, median } from '../admin/leads.js';
import { leads, session } from './session.js';
import { renderTargets } from './targets.js';

const view = () => $('[data-view="insights"]');
let leadsCache = []; // this account's enquiries, for the won counts

export async function show() {
  const sel = view().querySelector('[data-period]');
  store.periodSelect(sel, () => load());
  sel.value = String(store.getDays());
  await load();
}

async function load() {
  const days = store.getDays();
  view().setAttribute('aria-busy', 'true');
  try {
    const [a, all, tg] = await Promise.all([api(`/api/team/insights?days=${days}`), leads(), api('/api/team/targets').catch(() => null)]);
    leadsCache = all;
    const cur = inPeriod(all, days), prev = inPeriod(all, days, days);
    renderKpis(a, cur, prev);
    renderTargets($('#insTargets'), { targets: tg?.targets || {}, leads: all, lines: [a.line] });
    renderTrend(a);
    renderMine(all, days);
    renderProducts(a);
    renderPages(a);
    renderSources(a);
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { view().removeAttribute('aria-busy'); }
}

// when an enquiry was won or lost: the last time it entered that stage
const closedAt = (l) => Date.parse((l.history || []).filter((x) => x.status === l.status).at(-1)?.at || l.createdAt);
const closedIn = (list, status, days, offset = 0) => {
  const end = Date.now() - offset * 86400000, start = end - days * 86400000;
  return list.filter((l) => l.status === status && closedAt(l) > start && closedAt(l) <= end);
};

function renderKpis(a, cur, prev) {
  const days = store.getDays();
  const rate = a.views ? (cur.length / a.views) * 100 : null, prevRate = a.prevViews ? (prev.length / a.prevViews) * 100 : null;
  const resp = median(cur.map(firstResponseHours)), prevResp = median(prev.map(firstResponseHours));
  const won = closedIn(leadsCache, 'won', days), prevWon = closedIn(leadsCache, 'won', days, days);
  $('#insKpis').replaceChildren(
    kpiCard({ label: 'Views of your pages', value: int(a.views), delta: delta(a.views, a.prevViews), spark: a.series.map((d) => d.views), context: `${int(a.pages.length)} pages viewed` }),
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), context: 'Received in this period' }),
    kpiCard({ label: 'Enquiries per 100 views', value: rate == null ? NO_DATA : decimal(rate), delta: rate == null || prevRate == null ? null : delta(rate, prevRate, { points: true }), context: 'How well your pages turn into enquiries' }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: 'From arrival to the first step' }),
    kpiCard({ label: 'Won', value: int(won.length), delta: delta(won.length, prevWon.length), context: valueOf(won) || 'No quote value recorded' }),
  );
}
const valueOf = (list) => {
  const s = {};
  for (const l of list) if (l.quote?.total) s[l.quote.currency] = (s[l.quote.currency] || 0) + Number(l.quote.total);
  return Object.entries(s).map(([c, n]) => `${c} ${Math.round(n).toLocaleString('en-US')}`).join(' and ');
};

function renderTrend(a) {
  const box = $('#insTrend');
  const dates = a.series.map((d) => d.date), current = a.series.map((d) => d.views), previous = a.series.map((d) => d.prevViews);
  const total = current.reduce((n, v) => n + v, 0), prevTotal = previous.reduce((n, v) => n + v, 0);
  box.replaceChildren(
    trendChart({ dates, current, previous, width: box.clientWidth, label: `Daily views of your pages: ${int(total)} this period against ${int(prevTotal)} in the period before.`, unit: 'views' }),
    tableFor('Daily views of your pages', ['Date', 'Views', 'Period before'], a.series.map((d) => [shortDate(d.date), int(d.views), int(d.prevViews)])));
}

function renderMine(all, days) {
  const me = session.user?.id;
  const mine = all.filter((l) => l.assignee?.id === me);
  const quotes = all.flatMap((l) => (l.activity || []).filter((x) => x.type === 'quote' && x.by?.id === me && Date.parse(x.at) > Date.now() - days * 86400000));
  const won = closedIn(mine, 'won', days), lost = closedIn(mine, 'lost', days);
  const resp = median(inPeriod(mine, days).map(firstResponseHours));
  const fact = (dt, dd, sub) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd, sub ? h('small', {}, sub) : null));
  $('#insMine').replaceChildren(
    fact('Enquiries you hold', int(mine.filter((l) => ['new', 'read', 'contacted', 'quoted'].includes(l.status)).length), 'Open now'),
    fact('Your first response', resp == null ? NO_DATA : hours(resp), 'Median, enquiries you accepted in this period'),
    fact('Quotes you sent', int(quotes.length), 'In this period'),
    fact('Won and lost', `${int(won.length)} won, ${int(lost.length)} lost`, won.length + lost.length ? `${pct((won.length / (won.length + lost.length)) * 100, 0)} won${valueOf(won) ? `, ${valueOf(won)}` : ''}` : 'Nothing closed in this period'),
  );
}

function renderProducts(a) {
  const box = $('#insProducts');
  if (!a.products.length) { box.replaceChildren(empty('No products in the catalogue yet.')); return; }
  box.replaceChildren(h('table', { class: 'a-table a-perf' },
    h('caption', { class: 'sr-only' }, 'Your products: opened and asked about'),
    h('thead', {}, h('tr', {}, ['Product', 'Opened', 'Asked about', 'Per 100 opens', 'Trend'].map((t, i) => h('th', { scope: 'col', class: i && i < 4 ? 'num' : '' }, t)))),
    h('tbody', {}, a.products.map((p) => {
      const per = p.opens ? (p.enquiries / p.opens) * 100 : null;
      const flag = p.opens >= 10 && (!p.enquiries || per < 2) ? h('span', { class: 'flag' }, 'Opened often, rarely asked about') : !p.opens ? h('span', { class: 'flag info' }, 'Not opened') : null;
      return h('tr', {},
        h('th', { scope: 'row' }, p.name, flag),
        h('td', { class: 'num' }, int(p.opens), deltaChip(delta(p.opens, p.prevOpens), true)),
        h('td', { class: 'num' }, int(p.enquiries)),
        h('td', { class: 'num' }, per == null ? NO_DATA : decimal(per)),
        h('td', {}, p.daily.some(Boolean) ? sparkline(p.daily, { width: 110, height: 28, label: `${p.name} opened per day` }) : h('span', { class: 'a-note' }, 'No opens')));
    }))));
}

// "/packaging/pizza-boxes/" -> "Pizza boxes"; the line pages by their names
const pageLabel = (path) => {
  if (/^\/(agriculture|packaging)\/?$/.test(path)) return path.includes('pack') ? 'Packaging page' : 'Agriculture page';
  const slug = path.replace(/\/+$/, '').split('/').pop() || path;
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
};
function renderPages(a) {
  $('#insPages').replaceChildren(barList(a.pages.map((p) => ({
    label: pageLabel(p.path), title: p.path, value: p.views, delta: delta(p.views, p.prevViews),
    note: p.avgSeconds == null ? null : `${duration(p.avgSeconds)} on average${p.engagedRate == null ? '' : `, ${pct(p.engagedRate, 0)} stayed to read`}`,
  })), { emptyText: 'Your pages have no views in this period yet.' }));
}

function renderSources(a) {
  $('#insSources').replaceChildren(
    h('h3', { class: 'v-sub' }, 'How they found the website'),
    barList(a.site.channels.map((c) => ({ label: CHANNEL_NAMES[c.name] || c.name, value: c.count }))),
    h('h3', { class: 'v-sub' }, 'Countries'),
    barList(a.site.countries.map((c) => ({ label: countryName(c.name), value: c.count })), { emptyText: 'No countries recorded yet.' }));
}
