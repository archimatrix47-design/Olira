// Overview: "is everything fine, and what needs doing". KPIs against the
// previous period, the main trend, both business-line journeys, a needs
// attention list and the setup checklist.
import { $, h, toast } from './api.js';
import * as store from './store.js';
import { trendChart, funnel, tableFor, empty } from './charts.js';
import { kpiCard, freshness, statusIcon } from './widgets.js';
import { int, pct, decimal, duration, hours, delta, NO_DATA, shortDate, WEEKDAYS, hourLabel, CHANNEL_NAMES, languageName, pageName } from './format.js';
import { inPeriod, lineOfLead, firstResponseHours, median, ageHours, scoreOf } from './leads.js';

const view = () => $('[data-view="overview"]');

export async function show() {
  store.periodSelect(view().querySelector('[data-period]'), () => load());
  view().querySelector('[data-period]').value = String(store.getDays());
  await load();
}

async function load() {
  const days = store.getDays();
  view().setAttribute('aria-busy', 'true');
  try {
    const [a, inbox, prods, setup] = await Promise.all([store.analytics(days), store.inquiries(), store.products().catch(() => []), store.setup()]);
    const leads = Array.isArray(inbox?.inquiries) ? inbox.inquiries : [];
    freshness(view(), a, days);
    renderKpis(a, leads, days);
    renderTrend(a, leads);
    renderFacts(a, leads, days);
    renderFunnels(a);
    renderAttention(a, leads, prods, setup, days);
    renderHealth(a, prods, setup);
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  } finally {
    view().removeAttribute('aria-busy');
  }
}

function dailyCounts(series, leads) {
  const byDay = {};
  for (const l of leads) { const k = String(l.createdAt).slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
  return series.map((d) => byDay[d.date] || 0);
}

function renderKpis(a, leads, days) {
  const cur = inPeriod(leads, days), prev = inPeriod(leads, days, days);
  const t = a.totals, p = a.previous;
  const rate = (n, v) => (v ? (n / v) * 100 : null);
  const curRate = rate(cur.length, t.uniques), prevRate = rate(prev.length, p.uniques);
  const resp = median(cur.map(firstResponseHours)), prevResp = median(prev.map(firstResponseHours));
  const answered = cur.filter((l) => firstResponseHours(l) != null);
  const within24 = answered.length ? (answered.filter((l) => firstResponseHours(l) < 24).length / answered.length) * 100 : null;
  const waiting = leads.filter((l) => l.status === 'new').length;
  const split = { agri: cur.filter((l) => lineOfLead(l) === 'agri').length, pack: cur.filter((l) => lineOfLead(l) === 'pack').length };

  $('#ovKpis').replaceChildren(
    kpiCard({ label: 'Visitors', value: int(t.uniques), delta: delta(t.uniques, p.uniques), spark: a.series.map((d) => d.uniques), context: `${int(t.views)} page views, ${t.viewsPerVisitor ?? 0} per visitor` }),
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), spark: dailyCounts(a.series, leads), context: `Agriculture ${split.agri}, packaging ${split.pack}` }),
    kpiCard({ label: 'Enquiries per 100 visitors', value: curRate == null ? NO_DATA : decimal(curRate), delta: curRate == null || prevRate == null ? null : delta(curRate, prevRate, { points: true }), context: 'How well visits turn into enquiries' }),
    kpiCard({ label: 'Engaged visits', value: t.engagedRate == null ? NO_DATA : pct(t.engagedRate, 0), delta: t.engagedRate == null || p.engagedRate == null ? null : delta(t.engagedRate, p.engagedRate, { points: true }), spark: a.series.map((d) => (d.leaves ? (d.engaged / d.leaves) * 100 : 0)), sparkLabel: 'Engaged share per day', context: t.avgSeconds == null ? 'Stayed 15 seconds or read half the page' : `Average ${duration(t.avgSeconds)} on a page` }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: within24 == null ? `${waiting} waiting in New` : `${pct(within24, 0)} answered within a day. ${waiting} waiting in New` }),
  );
}

function renderTrend(a, leads) {
  const dates = a.series.map((d) => d.date);
  const current = a.series.map((d) => d.uniques);
  const previous = a.previousSeries.map((d) => d.uniques);
  const marks = dailyCounts(a.series, leads);
  const box = $('#ovTrend');
  if (!current.some(Boolean) && !previous.some(Boolean)) { box.replaceChildren(empty('No visits recorded in this period yet.')); return; }
  const total = current.reduce((n, v) => n + v, 0), prevTotal = previous.reduce((n, v) => n + v, 0);
  box.replaceChildren(
    trendChart({ dates, current, previous, marks, width: box.clientWidth, label: `Daily visitors: ${int(total)} this period against ${int(prevTotal)} in the previous period, with ${marks.reduce((n, v) => n + v, 0)} enquiries.`, unit: 'visitors', markLabel: 'enquiries' }),
    tableFor('Daily visitors and enquiries', ['Date', 'Visitors', 'Previous period', 'Page views', 'Enquiries'], a.series.map((d, i) => [shortDate(d.date), int(d.uniques), int(previous[i]), int(d.views), int(marks[i])])));
}

function renderFacts(a, leads, days) {
  const fact = (dt, dd, sub) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd, sub ? h('small', {}, sub) : null));
  const topOf = (obj) => Object.entries(obj || {}).sort((x, y) => y[1] - x[1])[0];
  const out = [];
  const ch = topOf(a.channels);
  const chTotal = Object.values(a.channels || {}).reduce((n, v) => n + v, 0);
  out.push(fact('Biggest source', ch ? CHANNEL_NAMES[ch[0]] || ch[0] : NO_DATA, ch ? `${pct((ch[1] / chTotal) * 100, 0)} of page views` : 'Recorded from now on'));
  let best = null;
  a.heatmap.forEach((row, r) => row.forEach((v, c) => { if (v && (!best || v > best.v)) best = { r, c, v }; }));
  out.push(fact('Busiest time', best ? `${WEEKDAYS[best.r]} ${hourLabel(best.c)}` : NO_DATA, best ? 'Addis Ababa time. A good hour to be ready to reply' : 'Recorded from now on'));
  const markets = {};
  for (const l of inPeriod(leads, days)) { const m = scoreOf(l).details.market; if (m) markets[m.name] = (markets[m.name] || 0) + 1; }
  const mk = topOf(markets), lang = a.languages?.[0];
  out.push(fact('Leading market', mk ? mk[0] : lang ? languageName(lang.name) : NO_DATA, mk ? `${mk[1]} ${mk[1] === 1 ? 'enquiry' : 'enquiries'} by phone code or email domain` : lang ? 'Most common browser language' : 'No enquiries or language data yet'));
  const prod = a.products?.[0];
  out.push(fact('Most viewed product', prod ? prod.name : NO_DATA, prod ? `Opened ${int(prod.clicks)} times, ${int(prod.inquiries)} ${prod.inquiries === 1 ? 'enquiry' : 'enquiries'}` : 'No product details opened yet'));
  const page = a.pages?.filter((p) => p.leaves >= 3).sort((x, y) => (y.engagedRate ?? 0) - (x.engagedRate ?? 0))[0];
  out.push(fact('Most engaging page', page ? pageName(page.path) : NO_DATA, page ? `${pct(page.engagedRate, 0)} engaged, ${duration(page.avgSeconds)} average` : 'Needs a few more visits'));
  $('#ovFacts').replaceChildren(...out);
}

function renderFunnels(a) {
  const f = a.funnel || {};
  const agri = [
    { label: 'Visitors', value: f.visit || 0 },
    { label: 'Saw agriculture', value: f.agri || 0 },
    { label: 'Opened a product', value: f.product || 0 },
    { label: 'Reached for contact', value: f.contactAgri || 0, hint: 'Call, WhatsApp, email or form' },
    { label: 'Sent an enquiry', value: f.enquiryAgri || 0 },
  ];
  const pack = [
    { label: 'Visitors', value: f.visit || 0 },
    { label: 'Saw packaging', value: f.pack || 0 },
    { label: 'Used the bag designer', value: f.studio || 0 },
    { label: 'Reached for contact', value: f.contactPack || 0, hint: 'Call, WhatsApp, email or form' },
    { label: 'Sent an enquiry', value: f.enquiryPack || 0 },
  ];
  const render = (el, steps, name, cls) => {
    el.className = cls;
    el.replaceChildren(funnel(steps, { label: `${name} journey` }), tableFor(`${name} journey`, ['Step', 'Visitors'], steps.map((s) => [s.label, int(s.value)])));
  };
  render($('#ovFunnelAgri'), agri, 'Agriculture', '');
  render($('#ovFunnelPack'), pack, 'Packaging', 'a-funnel-pack');
}

function renderAttention(a, leads, prods, setup, days) {
  const items = [];
  const add = (level, title, text, href, action) => items.push({ level, title, text, href, action });
  const stale = leads.filter((l) => l.status === 'new' && ageHours(l) > 24).sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
  if (stale.length) add('high', `${stale.length} ${stale.length === 1 ? 'enquiry has' : 'enquiries have'} waited more than a day`, `Oldest arrived ${hours(ageHours(stale[0]))} ago. Buyers answered within an hour are several times more likely to go ahead.`, `#enquiries?days=${days}`, 'Open New');
  const fresh = leads.filter((l) => l.status === 'new' && ageHours(l) <= 24);
  if (fresh.length) add('medium', `${fresh.length} new ${fresh.length === 1 ? 'enquiry' : 'enquiries'} today`, 'Reply while the buyer is still comparing suppliers.', `#enquiries?days=${days}`, 'Reply');
  const undelivered = inPeriod(leads, days).filter((l) => l.emailed === false);
  if (undelivered.length) add('high', `${undelivered.length} ${undelivered.length === 1 ? 'enquiry' : 'enquiries'} did not reach your email`, 'They are safe in the inbox here. Check Email delivery so the next ones arrive.', '#email', 'Check email');
  // null means the settings could not be read, which is not the same as "not set up"
  if (setup.email && !setup.email.smtpHost) add('high', 'Email delivery is not set up', 'Enquiries are saved here, but no one is notified and buyers get no confirmation.', '#email', 'Set up');
  const fails = a.events?.form_fail || 0;
  if (fails) add('high', `Visitors saw a sending error ${fails} ${fails === 1 ? 'time' : 'times'}`, 'The form offered them WhatsApp, email or a call instead. Check the email settings.', '#email', 'Check email');
  const followUp = leads.filter((l) => l.status === 'quoted' && (Date.now() - Date.parse((l.history || []).slice(-1)[0]?.at || l.createdAt)) / 86400000 > 7);
  if (followUp.length) add('medium', `${followUp.length} ${followUp.length === 1 ? 'quote has' : 'quotes have'} had no update for a week`, 'A short follow up often decides it.', `#enquiries?days=365`, 'Follow up');
  const noPhoto = (prods || []).filter((p) => !p.image);
  if (noPhoto.length) add('medium', `${noPhoto.length} ${noPhoto.length === 1 ? 'product has' : 'products have'} no photo`, noPhoto.map((p) => p.name).join(', '), '#products', 'Add photos');
  const cold = (a.products || []).filter((p) => p.clicks >= 10 && p.inquiries === 0);
  if (cold.length) add('medium', `${cold[0].name} gets attention but no enquiries`, `Opened ${cold[0].clicks} times this period. Check its description, minimum order and photo.`, '#products', 'Review');
  if (a.previous.uniques >= 20 && a.totals.uniques < a.previous.uniques * 0.7) add('medium', `Visitors fell ${Math.round((1 - a.totals.uniques / a.previous.uniques) * 100)}% on the previous period`, 'See which source dropped on the Traffic page.', `#traffic?days=${days}`, 'See traffic');
  if (!items.length) add('ok', 'Nothing needs attention', 'No waiting enquiries, delivery problems or missing content.', null, null);
  $('#ovAttention').replaceChildren(...items.map((i) => h('li', { class: `is-${i.level}` },
    h('div', {}, h('strong', {}, i.title), h('span', {}, i.text)),
    i.href ? h('a', { class: `btn btn-sm ${i.level === 'high' ? 'btn-primary' : 'btn-secondary'}`, href: i.href }, i.action) : null)));
}

function renderHealth(a, prods, setup) {
  const list = prods || [];
  const withPhoto = list.filter((p) => p.image).length;
  const rows = [
    setup.email === null
      ? ['optional', 'Email delivery', 'Could not check just now. Open Email delivery to see the settings', '#email']
      : [setup.email.smtpHost ? 'ok' : 'todo', 'Email delivery', setup.email.smtpHost ? `Enquiries go to ${setup.email.recipientEmail}` : 'Not set up, so nobody is notified', '#email'],
    [setup.contacts?.phones?.length ? 'ok' : 'todo', 'Call and WhatsApp', setup.contacts?.phones?.length ? `${setup.contacts.phones.length} phone ${setup.contacts.phones.length === 1 ? 'number' : 'numbers'}${setup.social?.whatsapp ? ', WhatsApp link set' : ', WhatsApp uses the main phone'}` : 'No phone number saved', '#company'],
    [setup.social?.telegram ? 'ok' : 'optional', 'Telegram', setup.social?.telegram ? 'Shown beside WhatsApp' : 'Optional. Add a channel link to show the icon', '#social'],
    [list.length && withPhoto === list.length ? 'ok' : 'todo', 'Product photos', `${withPhoto} of ${list.length} products have a photo`, '#products'],
    [setup.certs?.length ? 'ok' : 'todo', 'Certifications', setup.certs?.length ? `${setup.certs.length} listed on the agriculture page` : 'None listed', '#certifications'],
    [setup.integrations?.analytics?.measurementId ? 'ok' : 'optional', 'Google Analytics', setup.integrations?.analytics?.measurementId ? 'Connected' : 'Optional. The built-in numbers here work without it', '#marketing'],
    [a.firstTracked ? 'ok' : 'optional', 'Detailed visit data', a.firstTracked ? `Recording since ${shortDate(a.firstTracked)}` : 'Starts with the next visit', null],
  ];
  $('#ovHealth').replaceChildren(...rows.map(([kind, title, text, href]) => h('li', {}, statusIcon(kind),
    h('div', {}, h('strong', {}, title, h('span', { class: 'sr-only' }, kind === 'ok' ? ', done' : kind === 'todo' ? ', needs doing' : ', optional')), h('span', {}, text, href && kind !== 'ok' ? ' ' : null, href && kind !== 'ok' ? h('a', { href }, kind === 'todo' ? 'Fix' : 'Set up') : null)))));
}
