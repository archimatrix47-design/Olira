// Manager's dashboard: how both businesses are doing and what needs the
// manager today. KPIs against the previous period, the team's load, the main
// trend, both business-line journeys and a needs attention list. Website
// settings belong to the administrator; the catalogues to the marketing teams.
import { $, h, toast } from '../../admin/api.js';
import * as store from '../../admin/store.js';
import { trendChart, funnel, tableFor, empty } from '../../admin/charts.js';
import { kpiCard, freshness } from '../../admin/widgets.js';
import { int, pct, decimal, duration, hours, delta, NO_DATA, shortDate, WEEKDAYS, hourLabel, CHANNEL_NAMES, languageName, pageName } from '../../admin/format.js';
import { inPeriod, lineOfLead, firstResponseHours, median, ageHours, scoreOf } from '../../admin/leads.js';
import { session, followupsOf, OPEN, LINE_LABEL } from '../session.js';
import { certAlerts } from '../../admin/cert-alerts.js';
import { getJSON } from '../../common.js';

const view = () => $('[data-view="dashboard"]');

export async function show() {
  store.periodSelect(view().querySelector('[data-period]'), () => load());
  view().querySelector('[data-period]').value = String(store.getDays());
  await load();
}

async function load() {
  const days = store.getDays();
  view().setAttribute('aria-busy', 'true');
  try {
    const [a, inbox, prods, bags, certs] = await Promise.all([store.analytics(days), store.inquiries(), store.products().catch(() => []), store.packaging().catch(() => null), getJSON('/api/certifications').catch(() => null)]);
    const leads = Array.isArray(inbox?.inquiries) ? inbox.inquiries : [];
    freshness(view(), a, days);
    renderKpis(a, leads, days);
    renderTeam(leads);
    renderTrend(a, leads);
    renderFacts(a, leads, days);
    renderFunnels(a);
    renderAttention(a, leads, prods, days, bags, certs);
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
  const waiting = leads.filter((l) => !l.assignee && OPEN.includes(l.status)).length;
  const split = { agri: cur.filter((l) => lineOfLead(l) === 'agri').length, pack: cur.filter((l) => lineOfLead(l) === 'pack').length };

  $('#ovKpis').replaceChildren(
    kpiCard({ label: 'Visitors', value: int(t.uniques), delta: delta(t.uniques, p.uniques), spark: a.series.map((d) => d.uniques), context: `${int(t.views)} page views, ${t.viewsPerVisitor ?? 0} per visitor` }),
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), spark: dailyCounts(a.series, leads), context: `Agriculture ${split.agri}, packaging ${split.pack}` }),
    kpiCard({ label: 'Enquiries per 100 visitors', value: curRate == null ? NO_DATA : decimal(curRate), delta: curRate == null || prevRate == null ? null : delta(curRate, prevRate, { points: true }), context: 'How well visits turn into enquiries' }),
    kpiCard({ label: 'Engaged visits', value: t.engagedRate == null ? NO_DATA : pct(t.engagedRate, 0), delta: t.engagedRate == null || p.engagedRate == null ? null : delta(t.engagedRate, p.engagedRate, { points: true }), spark: a.series.map((d) => (d.leaves ? (d.engaged / d.leaves) * 100 : 0)), sparkLabel: 'Engaged share per day', context: t.avgSeconds == null ? 'Stayed 15 seconds or read half the page' : `Average ${duration(t.avgSeconds)} on a page` }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: within24 == null ? `${waiting} not handed out` : `${pct(within24, 0)} answered within a day. ${waiting} not handed out` }),
  );
}

// who holds what: open enquiries per person, overdue follow-ups, and the ones nobody has
function renderTeam(leads) {
  const box = $('#ovTeam');
  const due = followupsOf(leads);
  const people = session.members.filter((m) => m.role === 'agri' || m.role === 'pack');
  const rows = people.map((m) => ({
    m,
    open: leads.filter((l) => l.assignee?.id === m.id && OPEN.includes(l.status)).length,
    overdue: due.filter((d) => d.lead.assignee?.id === m.id).length,
  })).sort((x, y) => y.overdue - x.overdue || y.open - x.open || x.m.name.localeCompare(y.m.name));
  const loose = (line) => leads.filter((l) => !l.assignee && OPEN.includes(l.status) && lineOfLead(l) === line).length;
  const chip = (label, n, href, warn) => h('a', { class: `t-team-chip${warn ? ' is-warn' : ''}`, href }, h('strong', {}, int(n)), h('span', {}, label));
  box.replaceChildren(
    h('div', { class: 't-team-strip' },
      chip('agriculture not handed out', loose('agri'), '#inbox?filter=unassigned&line=agri', loose('agri') > 0),
      chip('packaging not handed out', loose('pack'), '#inbox?filter=unassigned&line=pack', loose('pack') > 0),
      chip(due.length === 1 ? 'follow-up due' : 'follow-ups due', due.length, '#followups', due.length > 0)),
    rows.length
      ? h('ul', { class: 't-team-list', 'aria-label': 'Open enquiries per person' }, rows.map(({ m, open, overdue }) => h('li', {},
        h('a', { class: 't-team-link', href: `#inbox?filter=open&owner=${encodeURIComponent(m.id)}` },
          h('span', { class: `a-avatar ${m.role}`, 'aria-hidden': 'true' }, m.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')),
          h('span', { class: 'grow' }, h('strong', {}, m.name), h('span', {}, LINE_LABEL[m.role])),
          h('span', { class: 't-team-n' }, h('strong', {}, int(open)), ' open'),
          overdue ? h('span', { class: 'a-tag warn' }, `${overdue} overdue`) : null))))
      : h('p', { class: 'a-note' }, 'No one is on the marketing teams yet. The site administrator adds them under Staff accounts.'));
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

const onSite = (bags) => (bags || []).filter((p) => p.site !== false);

function renderAttention(a, leads, prods, days, bags, certs) {
  const items = [];
  const add = (level, title, text, href, action) => items.push({ level, title, text, href, action });
  const loose = leads.filter((l) => !l.assignee && OPEN.includes(l.status) && ageHours(l) > 4).sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
  if (loose.length) add('high', `${loose.length} ${loose.length === 1 ? 'enquiry has' : 'enquiries have'} not been taken for over 4 hours`, `Oldest arrived ${hours(ageHours(loose[0]))} ago. Hand ${loose.length === 1 ? 'it' : 'them'} to someone: buyers answered within an hour are several times more likely to go ahead.`, '#inbox?filter=unassigned', 'Hand out');
  const fresh = leads.filter((l) => l.status === 'new' && ageHours(l) <= 4);
  if (fresh.length) add('medium', `${fresh.length} new ${fresh.length === 1 ? 'enquiry' : 'enquiries'} in the last 4 hours`, 'The teams are notified by email. Check someone takes each one.', '#inbox?filter=unassigned', 'See them');
  const due = followupsOf(leads).filter((d) => d.kind !== 'accept');
  if (due.length) {
    // who holds the most overdue ones, so the manager knows whom to ask
    const by = {};
    for (const d of due) if (d.lead.assignee) by[d.lead.assignee.name] = (by[d.lead.assignee.name] || 0) + 1;
    const top = Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, c]) => `${n} (${c})`);
    // untaken enquiries are the alert above; these are the ones someone holds
    add('medium', `${due.length} ${due.length === 1 ? 'follow-up is' : 'follow-ups are'} overdue on enquiries someone has taken`, `Buyers waiting on a first contact, a quote to chase or a conversation gone quiet.${top.length ? ` Most are with ${top.join(', ')}.` : ''}`, '#followups', 'See follow-ups');
  }
  const undelivered = inPeriod(leads, days).filter((l) => l.emailed === false);
  if (undelivered.length) add('high', `${undelivered.length} ${undelivered.length === 1 ? 'enquiry' : 'enquiries'} did not reach anyone by email`, 'They are safe here. Ask the site administrator to check Email delivery so the next ones arrive.', '#inbox?filter=all', 'See them');
  const fails = a.events?.form_fail || 0;
  if (fails) add('high', `Visitors saw a sending error ${fails} ${fails === 1 ? 'time' : 'times'}`, 'The form offered them WhatsApp, email or a call instead. Ask the site administrator to check Email delivery.', null, null);
  const noPhoto = (prods || []).filter((p) => !p.image);
  if (noPhoto.length) add('medium', `${noPhoto.length} agriculture ${noPhoto.length === 1 ? 'product has' : 'products have'} no photo`, `${noPhoto.map((p) => p.name).join(', ')}. The agriculture team adds photos in its workspace.`, '#products', 'See products');
  const noPackPhoto = onSite(bags).filter((p) => !p.image);
  if (noPackPhoto.length) {
    add('medium', `${noPackPhoto.length} packaging ${noPackPhoto.length === 1 ? 'product has' : 'products have'} no photo`,
      `${noPackPhoto.map((p) => p.name).join(', ')}. ${noPackPhoto.length === 1 ? 'It shows' : 'They show'} as a text tile in the catalogue. The packaging team adds photos in its workspace.`,
      '#products', 'See products');
  }
  // certificates are the proof importers check: the manager hears about gaps first
  for (const c of certAlerts(certs, { forManager: true })) add(c.level, c.title, c.text, null, null);
  const stopped = a.events?.bundle_below_min || 0;
  if (stopped >= 3) add('medium', `A minimum order stopped visitors ${int(stopped)} times`, 'They tried to send a packing list below the minimum order for a product. Agree with the packaging team whether the minimums still suit the business.', '#products', 'See products');
  const warned = a.events?.studio_logo_warn || 0, fixed = a.events?.studio_logo_fix || 0;
  if (warned >= 3 && fixed < warned / 2) add('medium', `${int(warned)} uploaded logos would print badly`, `The studio flagged a white box or a very pale logo and offered a fix; ${int(fixed)} ${fixed === 1 ? 'visitor' : 'visitors'} used it. The team should ask for a transparent PNG or vector file when replying to those quotes.`, `#traffic?days=${days}`, 'See designer');
  const cold = (a.products || []).filter((p) => p.clicks >= 10 && p.inquiries === 0);
  const packNames = new Set((bags || []).map((p) => p.name));
  if (cold.length) add('medium', `${cold[0].name} gets attention but no enquiries`, `Opened ${cold[0].clicks} times this period. Its description, minimum order and photo are worth a look with the ${packNames.has(cold[0].name) ? 'packaging' : 'agriculture'} team.`, `#products?days=${days}`, 'Review');
  if (a.previous.uniques >= 20 && a.totals.uniques < a.previous.uniques * 0.7) add('medium', `Visitors fell ${Math.round((1 - a.totals.uniques / a.previous.uniques) * 100)}% on the previous period`, 'See which source dropped on the Traffic page.', `#traffic?days=${days}`, 'See traffic');
  if (!items.length) add('ok', 'Nothing needs attention', 'Every enquiry has someone on it, nothing is overdue and the catalogues are complete.', null, null);
  $('#ovAttention').replaceChildren(...items.map((i) => h('li', { class: `is-${i.level}` },
    h('div', {}, h('strong', {}, i.title), h('span', {}, i.text)),
    i.href ? h('a', { class: `btn btn-sm ${i.level === 'high' ? 'btn-primary' : 'btn-secondary'}`, href: i.href }, i.action) : null)));
}
