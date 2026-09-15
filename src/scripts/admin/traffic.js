// Traffic: where visitors come from, what they read, when they visit, and what
// they do on the page.
import { $, h, toast } from './api.js';
import * as store from './store.js';
import { barList, stackBar, heatmap, tableFor, empty } from './charts.js';
import { kpiCard, freshness } from './widgets.js';
import { int, pct, duration, delta, NO_DATA, WEEKDAYS, hourLabel, CHANNEL_NAMES, CHANNEL_HELP, countryName, languageName, pageName } from './format.js';

const view = () => $('[data-view="traffic"]');

export async function show() {
  store.periodSelect(view().querySelector('[data-period]'), () => load());
  view().querySelector('[data-period]').value = String(store.getDays());
  await load();
}

async function load() {
  const days = store.getDays();
  view().setAttribute('aria-busy', 'true');
  try {
    const a = await store.analytics(days);
    freshness(view(), a, days);
    renderKpis(a);
    renderChannels(a);
    renderReferrers(a);
    renderPages(a);
    renderHeat(a);
    renderMarkets(a);
    renderActions(a);
    renderCampaigns(a);
    renderDevices(a);
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  } finally {
    view().removeAttribute('aria-busy');
  }
}

function renderKpis(a) {
  const t = a.totals, p = a.previous;
  const deepAll = a.pages.reduce((n, x) => n + (x.deepRate != null ? (x.deepRate / 100) * x.leaves : 0), 0);
  const leaves = a.pages.reduce((n, x) => n + x.leaves, 0);
  $('#trKpis').replaceChildren(
    kpiCard({ label: 'Page views', value: int(t.views), delta: delta(t.views, p.views), spark: a.series.map((d) => d.views) }),
    kpiCard({ label: 'Visitors', value: int(t.uniques), delta: delta(t.uniques, p.uniques), spark: a.series.map((d) => d.uniques), context: 'Counted once per day each' }),
    kpiCard({ label: 'Pages per visitor', value: t.viewsPerVisitor == null ? NO_DATA : String(t.viewsPerVisitor), delta: t.viewsPerVisitor == null || p.viewsPerVisitor == null ? null : delta(t.viewsPerVisitor, p.viewsPerVisitor), context: 'Typical sites see 1.5 to 3' }),
    kpiCard({ label: 'Average time on a page', value: duration(t.avgSeconds), delta: t.avgSeconds == null || p.avgSeconds == null ? null : delta(t.avgSeconds, p.avgSeconds), context: 'Only while the page is visible' }),
    kpiCard({ label: 'Read to the end', value: leaves ? pct((deepAll / leaves) * 100, 0) : NO_DATA, context: 'Scrolled at least three quarters of the page' }),
  );
}

function renderChannels(a) {
  const total = Object.values(a.channels).reduce((n, v) => n + v, 0);
  const items = Object.entries(a.channels).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({
    label: CHANNEL_NAMES[k] || k, value: v, title: CHANNEL_HELP[k],
    display: `${int(v)}  (${pct((v / total) * 100, 0)})`,
    delta: delta(v, a.previousChannels?.[k] || 0), note: CHANNEL_HELP[k],
  }));
  $('#trChannels').replaceChildren(
    total ? stackBar(items.map((i) => ({ label: i.label, value: i.value })), { label: 'Page views by source' }) : empty('Sources are recorded from the next visit.'),
    total ? h('div', { style: 'margin-top:16px' }, barList(items)) : h('span'),
    total ? tableFor('Page views by source', ['Source', 'Page views', 'Share', 'Previous period'], items.map((i) => [i.label, int(i.value), pct((i.value / total) * 100, 0), int(a.previousChannels?.[Object.keys(CHANNEL_NAMES).find((k) => CHANNEL_NAMES[k] === i.label)] || 0)])) : h('span'));
}

function renderReferrers(a) {
  const items = a.topReferrers.filter((r) => r.name !== 'direct').map((r) => ({ label: r.name, value: r.count }));
  const direct = a.topReferrers.find((r) => r.name === 'direct')?.count || 0;
  $('#trReferrers').replaceChildren(
    barList(items, { emptyText: 'No other website has linked a visitor here in this period.' }),
    h('p', { class: 'v-note' }, `${int(direct)} page views came with no referrer (typed in, bookmarks, WhatsApp and other apps).`),
    items.length ? tableFor('Referring websites', ['Website', 'Page views'], items.map((i) => [i.label, int(i.value)])) : h('span'));
}

function renderPages(a) {
  if (!a.pages.length) { $('#trPages').replaceChildren(empty('No page views in this period yet.')); return; }
  const bands = (b) => {
    const total = b.reduce((n, v) => n + v, 0);
    const el = h('span', { class: 'v-bands', role: 'img', 'aria-label': total ? `Time on page: ${['under 10 seconds', '10 to 30 seconds', '30 to 60 seconds', '1 to 3 minutes', 'over 3 minutes'].map((l, i) => `${Math.round((b[i] / total) * 100)}% ${l}`).join(', ')}` : 'No time data' });
    b.forEach((v) => { const s = h('span'); s.style.width = total ? `${(v / total) * 100}%` : '0'; el.append(s); });
    return el;
  };
  const table = h('table', { class: 'a-table' },
    h('caption', { class: 'sr-only' }, 'Pages with engagement'),
    h('thead', {}, h('tr', {}, ['Page', 'Views', 'Landed here first', 'Engaged', 'Average time', 'Read to the end', 'Time spent'].map((c, i) => h('th', { scope: 'col', class: i && i < 6 ? 'num' : '' }, c)))),
    h('tbody', {}, a.pages.map((p) => h('tr', {},
      h('th', { scope: 'row' }, pageName(p.path)),
      h('td', { class: 'num' }, int(p.views)),
      h('td', { class: 'num' }, int(p.entries)),
      h('td', { class: 'num' }, p.engagedRate == null ? NO_DATA : pct(p.engagedRate, 0)),
      h('td', { class: 'num' }, duration(p.avgSeconds)),
      h('td', { class: 'num' }, p.deepRate == null ? NO_DATA : pct(p.deepRate, 0)),
      h('td', {}, bands(p.timeBuckets))))));
  $('#trPages').replaceChildren(h('div', { class: 'a-scroll' }, table));
}

function renderHeat(a) {
  // show the week starting Monday, the way buyers plan it
  const order = [1, 2, 3, 4, 5, 6, 0];
  const matrix = order.map((d) => a.heatmap[d]);
  const labels = order.map((d) => WEEKDAYS[d]);
  const total = matrix.flat().reduce((n, v) => n + v, 0);
  if (!total) { $('#trHeat').replaceChildren(empty('Times are recorded from the next visit.')); return; }
  const byHour = Array.from({ length: 24 }, (_, hr) => matrix.reduce((n, row) => n + row[hr], 0));
  // busiest 3-hour window across the week
  let best = 0;
  for (let hr = 0; hr < 24; hr++) if (byHour[hr] + byHour[(hr + 1) % 24] + byHour[(hr + 2) % 24] > byHour[best] + byHour[(best + 1) % 24] + byHour[(best + 2) % 24]) best = hr;
  const windowShare = ((byHour[best] + byHour[(best + 1) % 24] + byHour[(best + 2) % 24]) / total) * 100;
  const byDay = matrix.map((row) => row.reduce((n, v) => n + v, 0));
  const topDay = labels[byDay.indexOf(Math.max(...byDay))];
  $('#trHeat').replaceChildren(
    heatmap(matrix, { rowLabels: labels, label: `Page views by weekday and hour in Addis Ababa time. Busiest window ${hourLabel(best)} to ${hourLabel((best + 3) % 24)}, busiest day ${topDay}.` }),
    h('p', { class: 'v-note' }, `${pct(windowShare, 0)} of views arrive between ${hourLabel(best)} and ${hourLabel((best + 3) % 24)}. ${topDay} is the busiest day. Many buyers are in other time zones, so this is when a quick reply lands best.`),
    tableFor('Page views by weekday and hour', ['Day', ...Array.from({ length: 24 }, (_, i) => hourLabel(i))], matrix.map((row, r) => [labels[r], ...row.map(int)])));
}

function renderMarkets(a) {
  const langs = a.languages.map((l) => ({ label: languageName(l.name), value: l.count, title: l.name }));
  const blocks = [h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'Browser language'), barList(langs, { emptyText: 'Languages are recorded from the next visit.' })];
  if (a.countries.length) {
    blocks.push(h('h3', { class: 'a-label', style: 'margin:18px 0 10px' }, 'Country'), barList(a.countries.map((c) => ({ label: countryName(c.name), value: c.count })), { tone: 'b' }));
  } else {
    blocks.push(h('p', { class: 'v-note' }, 'Country appears here if the site is served through a CDN such as Cloudflare, which reports it without sharing the IP address.'));
  }
  if (langs.length) blocks.push(tableFor('Browser language', ['Language', 'Page views'], langs.map((l) => [l.label, int(l.value)])));
  $('#trMarkets').replaceChildren(...blocks);
}

function actionItems(names, a, { higherIsBetter = true } = {}) {
  return names.map(([key, label]) => ({ label, value: a.events?.[key] || 0, delta: delta(a.events?.[key] || 0, a.previousEvents?.[key] || 0, { higherIsBetter }) }))
    .filter((i) => i.value || i.delta.dir);
}
function renderActions(a) {
  const contact = actionItems([
    ['reveal_whatsapp', 'Opened WhatsApp number'], ['reveal_phone', 'Opened phone number'], ['email', 'Clicked the email address'],
    ['telegram', 'Opened Telegram'], ['form_start_agri', 'Started the agriculture form'], ['form_start_pack', 'Started the packaging form'],
  ], a);
  const errors = actionItems([['form_invalid', 'Form sent with missing or wrong fields'], ['form_fail', 'Form could not be sent']], a, { higherIsBetter: false });
  $('#trContact').replaceChildren(
    barList(contact, { emptyText: 'No contact actions recorded in this period yet.' }),
    errors.length ? h('div', { style: 'margin-top:18px' }, h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'Form problems'), barList(errors, { tone: 'context' })) : h('span'),
    contact.length ? tableFor('Contact actions', ['Action', 'Count'], [...contact, ...errors].map((i) => [i.label, int(i.value)])) : h('span'));
  const studio = actionItems([['studio_change', 'Changed the bag or print'], ['studio_logo', 'Uploaded a logo'], ['studio_download', 'Downloaded a mockup'], ['studio_quote', 'Asked for a quote from the design']], a);
  const views = a.pages.find((p) => p.path === '/packaging/')?.views || 0;
  const used = a.events?.studio_change || 0;
  $('#trStudio').replaceChildren(
    barList(studio, { tone: 'b', emptyText: 'No one has used the bag designer in this period yet.' }),
    views ? h('p', { class: 'v-note' }, `${pct((used / views) * 100, 0)} of packaging page views changed the design. ${int(a.events?.studio_quote || 0)} went on to ask for a quote.`) : h('span'),
    studio.length ? tableFor('Bag designer use', ['Action', 'Count'], studio.map((i) => [i.label, int(i.value)])) : h('span'));
}

function renderCampaigns(a) {
  if (!a.campaigns.length) {
    $('#trCampaigns').replaceChildren(empty('No tagged campaign links in this period.'),
      h('p', { class: 'v-note' }, 'To measure a WhatsApp broadcast, trade directory or ad, add tags to the link, for example oliraagroindustry.com/agriculture/?utm_source=whatsapp&utm_medium=broadcast&utm_campaign=sesame-october'));
    return;
  }
  const rows = a.campaigns.map((c) => { const [source, medium, campaign] = c.name.split(' / '); return [campaign, source, medium, int(c.count)]; });
  $('#trCampaigns').replaceChildren(h('div', { class: 'a-scroll' }, h('table', { class: 'a-table' },
    h('caption', { class: 'sr-only' }, 'Campaign visits'),
    h('thead', {}, h('tr', {}, ['Campaign', 'Source', 'Medium', 'Page views'].map((c, i) => h('th', { scope: 'col', class: i === 3 ? 'num' : '' }, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r[0]), h('td', {}, r[1]), h('td', {}, r[2]), h('td', { class: 'num' }, r[3])))))));
}

function renderDevices(a) {
  const parts = [['desktop', 'Computer'], ['mobile', 'Phone'], ['tablet', 'Tablet']].map(([k, label]) => ({ label, value: a.devices[k] || 0 }));
  $('#trDevices').replaceChildren(h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'Devices'), stackBar(parts, { label: 'Page views by device' }));
  const entries = a.entries.map((e) => ({ label: pageName(e.name), value: e.count }));
  $('#trEntries').replaceChildren(h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'First page of the visit'), barList(entries, { emptyText: 'First pages are recorded from the next visit.' }));
}
