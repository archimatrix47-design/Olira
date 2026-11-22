// Ask the data, answered by the website itself: no AI model. A question in plain
// words is read for what it asks about (visitors, sources, enquiries, speed,
// products, the team ...), the business line and the period it names, and answered
// from the website's performance log (lib/ai-log.js) and the enquiries, with the
// figures, the change on the period before, and the screen where to check them.
// A question it cannot read gets the list of what it can answer. Pure: the browser
// (src/scripts/team/manager/ask.js) and the tests call it with the data.
import { int, hours, delta, countryName, pageName, CHANNEL_NAMES } from './format.js';
import { stageWaits } from './lead-rules.js';

const norm = (q) => ` ${String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
/** True when any of the word stems starts a word in the question. */
const has = (q, ...stems) => stems.some((s) => q.includes(` ${s}`));
const pc = (share) => (share == null || !Number.isFinite(share) ? 'no share' : `${Math.round(share * 100)}%`);
const plural = (n, one, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
const change = (cur, prev, opts) => delta(cur, prev, opts).spoken;
const secs = (ms) => `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
const sum = (o) => Object.values(o || {}).reduce((n, v) => n + (Number(v) || 0), 0);
const money = (byCur) => Object.entries(byCur || {}).filter(([, v]) => v).map(([c, v]) => `${c} ${Math.round(v).toLocaleString('en-US')}`).join(' and ');

/** The period a question names, in days (7, 30, 90 or 365), or null for the one chosen on the page. */
export function periodOf(question) {
  const q = norm(question);
  if (has(q, 'week', '7 day', 'seven day')) return 7;
  if (has(q, 'quarter', '90 day', '3 month', 'three month')) return 90;
  if (has(q, 'year', '12 month', 'twelve month', '365 day', 'annual')) return 365;
  if (has(q, 'month', '30 day', 'thirty day')) return 30;
  return null;
}

/** The business line a question names: 'agriculture', 'packaging' or null for both. */
export function lineOfQuestion(question) {
  const q = norm(question);
  const agri = has(q, 'agri', 'sesame', 'pulse', 'spice', 'coffee', 'export', 'bean', 'seed');
  const pack = has(q, 'packag', 'bag', 'box', 'pouch', 'foil', 'print', 'sachet', 'carton');
  return agri === pack ? null : agri ? 'agriculture' : 'packaging';
}

const periodText = (days) => (days === 7 ? 'the last 7 days' : days === 90 ? 'the last 90 days' : days === 365 ? 'the last 12 months' : `the last ${days} days`);

/** What the built-in answers cover, with a question that works for each. */
export const CAN_ANSWER = [
  ['Visitors and page views', 'How many visitors did we have this month?'],
  ['Where visitors come from', 'Where do our visitors come from?'],
  ['Enquiries, by line and period', 'How many packaging enquiries this week?'],
  ['Markets and products asked about', 'Which countries send the most enquiries?'],
  ['How fast enquiries are answered', 'How quickly are enquiries answered?'],
  ['Quotes, wins and losses', 'How much did we win this quarter?'],
  ['Where enquiries wait, and what is overdue', 'Where are enquiries stuck?'],
  ['Who holds what on the team', 'Who has the most overdue enquiries?'],
  ['Products looked at but rarely asked about', 'Which products do visitors look at but rarely ask about?'],
  ['What to fill in first in the catalogues', 'What should the teams fill in first in the catalogues?'],
  ['Website speed, on phones too', 'Is the website fast enough on phones?'],
  ['Pages, and where visitors leave', 'Which pages do visitors leave quickly?'],
  ['The visitor journey and the studio', 'How many visitors reach the packaging page and send an enquiry?'],
  ['Lead quality', 'How good are our leads?'],
  ['Certificates', 'Which certificates are missing a document?'],
];

/**
 * Answer a question. data: { log (lib/ai-log.js for the period), leads (enquiries),
 * members (staff: { id, name, role }), overdue ([{ lead }], follow-ups past due) }.
 * Returns { topic, lines: [sentence], bars?: [{ label, value, display?, note? }], link?: { href, label } }.
 */
export function answer(question, data) {
  const q = norm(question);
  const { log } = data;
  const line = lineOfQuestion(question);
  const days = log?.period?.days || 30;
  const when = periodText(days);
  if (!q.trim() || has(q, 'help', 'what can')) return help();
  for (const [topic, test, fn] of TOPICS) if (test(q, data)) return { topic, ...fn({ q, data, log, line, days, when }) };
  return help(true);
}

function help(missed = false) {
  return {
    topic: 'help',
    lines: [missed
      ? 'I could not tell what that asks about. These are the questions the website can answer from its own numbers; press one, or ask in your own words with one of these subjects.'
      : 'The website can answer these from its own numbers. Press one, or ask in your own words.'],
    ideas: CAN_ANSWER.map(([, example]) => example),
  };
}

const memberIn = (q, members = []) => members.find((m) => m.name && m.name.toLowerCase().split(/\s+/).some((part) => part.length > 2 && has(q, part)));

const TOPICS = [
  ['speed', (q) => has(q, 'fast', 'slow', 'speed', 'load', 'performance') && !has(q, 'answer', 'respond', 'repl'), ({ q, log }) => {
    const sp = log.speed;
    const phones = has(q, 'phone', 'mobile');
    const part = phones ? sp?.byDevice?.mobile : sp?.overall;
    if (!part || !part.pageViews) return { lines: [phones ? 'No page views from phones were measured in this period, so their speed is not known yet.' : 'No speed measurements yet in this period.'], link: { href: '#traffic', label: 'Traffic' } };
    const rate = (m) => (m?.rating === 'good' ? 'good' : m?.rating === 'poor' ? 'poor' : m?.rating ? 'needs improvement' : 'not measured');
    const out = [`${phones ? 'On phones' : 'Overall'}, from ${plural(part.pageViews, 'measured page view')}:`];
    if (part.lcp?.p75AtMost != null) out.push(`Main content showed within ${secs(part.lcp.p75AtMost)} for three in four views (${rate(part.lcp)}; good is under 2.5 s).`);
    if (part.cls?.p75AtMost != null) out.push(`The layout held still: ${part.cls.p75AtMost} (${rate(part.cls)}; good is under 0.1).`);
    if (part.ttfb?.p75AtMost != null) out.push(`The server answered within ${secs(part.ttfb.p75AtMost)} (${rate(part.ttfb)}).`);
    const slow = Object.entries(sp.byPage || {}).filter(([, v]) => v?.lcp?.rating && v.lcp.rating !== 'good').map(([k]) => k);
    out.push(slow.length ? `Pages to look at: ${slow.join(', ')}.` : 'No page is slow.');
    return { lines: out, link: { href: '#traffic', label: 'Traffic' } };
  }],
  ['certificates', (q) => has(q, 'certif', 'iso', 'haccp', 'gmp', 'expir'), ({ log }) => {
    const c = log.certificates;
    if (!c?.total) return { lines: ['No certifications are listed on the website yet.'] };
    const dated = c.valid || c.expired || c.expiringWithin60Days;
    return { lines: [`${plural(c.total, 'certification')} listed${dated ? `: ${int(c.valid)} valid, ${int(c.expired)} expired, ${int(c.expiringWithin60Days)} expiring within 60 days` : ', none with its dates filled in'}.`, c.withoutProofFile ? `${int(c.withoutProofFile)} have no certificate document uploaded, so buyers see "copy on request". The site administrator uploads them.` : 'Every one has its document uploaded.'] };
  }],
  ['health', (q) => has(q, 'email', 'broken', 'health', 'not working', 'problem with the'), ({ log }) => {
    const hl = log.health || {};
    const out = [];
    if (hl.emailDelivery) out.push(hl.emailDelivery.working ? 'Email delivery is working.' : 'Email delivery is not working: the last attempt failed. The site administrator checks it under Email delivery.');
    if (hl.enquiryStore) out.push(hl.enquiryStore.reachable ? 'Enquiries are being stored.' : 'The enquiry store did not answer; enquiries wait to be stored.');
    out.push(hl.failingChecks?.length ? `Failing checks: ${hl.failingChecks.join(', ')}.` : 'No health check is failing.');
    return { lines: out };
  }],
  ['response', (q) => has(q, 'answer', 'respond', 'response', 'repl', 'first contact') || (has(q, 'quick', 'how fast') && has(q, 'enquir', 'inquir', 'lead', 'buyer')), ({ log, when }) => {
    const e = log.enquiries;
    const med = e.firstResponseHoursMedian, prev = e.previousFirstResponseHoursMedian;
    const lines = [med == null
      ? `No enquiry that arrived in ${when} has had a first response yet.`
      : `Half the enquiries in ${when} had a first response within ${hours(med)}${prev != null ? `; ${change(med, prev, { higherIsBetter: false, unit: (v) => hours(v) })}` : ''}.`];
    const waiting = e.firstResponse?.['Not answered yet'];
    if (waiting) lines.push(`${plural(waiting, 'enquiry', 'enquiries')} from the period ${waiting === 1 ? 'has' : 'have'} not been answered yet. Buyers answered within an hour are far more likely to go ahead.`);
    return { lines, bars: Object.entries(e.firstResponse || {}).map(([label, value]) => ({ label, value })), link: { href: '#report', label: 'Report' } };
  }],
  ['won', (q) => has(q, 'won', 'win', 'sale', 'deal', 'revenue', 'lost', 'closed', 'earn'), ({ log, when }) => {
    const e = log.enquiries;
    const lines = [`In ${when}: ${plural(e.won, 'enquiry', 'enquiries')} won and ${int(e.lost)} lost${e.winRate != null ? `, a win rate of ${pc(e.winRate)}` : ''}.`];
    const v = money(e.quotes?.valueByCurrency);
    lines.push(e.quotes?.sent ? `${plural(e.quotes.sent, 'quote')} sent${v ? `, worth ${v}` : ''}.` : 'No quotes were sent in the period.');
    if (!e.won && !e.lost) lines.push('Nothing was marked Won or Lost, so the win rate cannot be measured yet: mark enquiries Won or Lost as they close.');
    return { lines, link: { href: '#report', label: 'Report' } };
  }],
  ['quotes', (q) => has(q, 'quote'), ({ log, when }) => {
    const e = log.enquiries;
    const v = money(e.quotes?.valueByCurrency);
    return { lines: [`${plural(e.quotes?.sent || 0, 'quote')} sent in ${when}${v ? `, worth ${v}` : ''}.`, `${plural(e.openNowAllTime?.Quoted || 0, 'enquiry', 'enquiries')} ${e.openNowAllTime?.Quoted === 1 ? 'is' : 'are'} quoted and waiting on the buyer now.`], link: { href: '#quotes', label: 'Quotes' } };
  }],
  ['quality', (q) => has(q, 'quality', 'score', 'good lead', 'strong lead', 'how good'), ({ log, when }) => {
    const s = log.enquiries.leadScore || {};
    const miss = (s.mostOftenMissing || []).slice(0, 3).map((m) => `${m.name} (${pc(m.share)})`).join(', ');
    return { lines: [`Enquiries in ${when} scored ${int(s.average)} out of 100 on average.`, miss ? `What they most often leave out: ${miss}. Asking for it in the reply makes the quote faster.` : ''].filter(Boolean),
      bars: [['Strong (70 and over)', s.bands?.strong], ['Fair (40 to 69)', s.bands?.fair], ['Thin (under 40)', s.bands?.thin]].map(([label, value]) => ({ label, value: value || 0 })), link: { href: '#report', label: 'Report' } };
  }],
  ['gaps', (q) => has(q, 'fill', 'missing', 'complete', 'incomplete', 'catalog', 'photo', 'price', 'minimum', 'lead time'), ({ log, line }) => {
    const c = log.catalogue || {};
    const lines = [], bars = [];
    for (const [key, label] of [['packaging', 'Packaging'], ['agriculture', 'Agriculture']]) {
      const k = c[key];
      if (!k || (line && line !== key)) continue;
      lines.push(key === 'packaging'
        ? `Packaging: ${int(k.products)} products, ${int(k.withPhoto)} with a photo, ${int(k.withPrice)} with a price, ${int(k.withMinimumOrder)} with a minimum order, ${int(k.withLeadTime)} with a lead time; ${int(k.sizesMeasured)} of ${int(k.sizes)} sizes measured.`
        : `Agriculture: ${int(k.products)} products, ${int(k.withPhoto)} with a photo, ${int(k.withMinimumOrder)} with a minimum order; ${int(k.averageCompleteness)}% complete on average.`);
      for (const p of (k.leastComplete || []).slice(0, key === 'packaging' ? 4 : 2)) bars.push({ label: `${p.name} (${label.toLowerCase()})`, value: p.score, display: `${int(p.score)}% complete`, note: `Missing: ${p.missing.join(', ')}` });
    }
    lines.push('Start with the least complete products below, and with prices and minimums: buyers ask for them first.');
    return { lines, bars, link: { href: '#products', label: 'Products' } };
  }],
  ['interest', (q) => (has(q, 'look', 'view', 'interest', 'popular', 'rarely', 'attention', 'open') && has(q, 'product')) || has(q, 'rarely ask'), ({ log, line }) => {
    const rows = [];
    for (const key of ['packaging', 'agriculture']) if (!line || line === key) for (const p of log.catalogue?.[key]?.interest || []) rows.push(p);
    if (!rows.length) return { lines: ['No product was opened in this period yet.'] };
    const quiet = rows.filter((p) => p.opened >= 3).sort((a, b) => (a.enquiries / a.opened) - (b.enquiries / b.opened) || b.opened - a.opened).slice(0, 5);
    const lines = quiet.length
      ? [`Looked at but rarely asked about: ${quiet.slice(0, 3).map((p) => `${p.name} (opened ${int(p.opened)} times, ${plural(p.enquiries, 'enquiry', 'enquiries')})`).join('; ')}.`, 'A clearer price, minimum order or photo on these pages often turns looks into enquiries.']
      : ['No product has been opened often enough yet to judge.'];
    return { lines, bars: quiet.map((p) => ({ label: p.name, value: p.opened, display: `${int(p.opened)} opens`, note: `${plural(p.enquiries, 'enquiry', 'enquiries')}` })), link: { href: '#products', label: 'Products' } };
  }],
  ['products', (q) => has(q, 'product', 'item', 'what do', 'ask for', 'asked for', 'most requested'), ({ log, when }) => {
    const top = (log.enquiries.products || []).filter((p) => p.name).slice(0, 6);
    if (!top.length) return { lines: [`No enquiries named a product in ${when}.`] };
    return { lines: [`Most asked for in ${when}: ${top.slice(0, 3).map((p) => `${p.name} (${int(p.count)})`).join(', ')}.`], bars: top.map((p) => ({ label: p.name, value: p.count })), link: { href: '#report', label: 'Report' } };
  }],
  ['markets', (q) => has(q, 'countr', 'market', 'nation', 'abroad', 'where are our buyer', 'where do our buyer', 'which buyer'), ({ log, when }) => {
    const m = (log.enquiries.markets || []).filter((x) => x.name !== 'unknown' && x.name !== 'other');
    const unknown = (log.enquiries.markets || []).find((x) => x.name === 'unknown');
    const named = (cc) => (/^[A-Z]{2}$/.test(cc) ? countryName(cc) : cc);
    const lines = m.length ? [`Enquiries in ${when} came most from ${m.slice(0, 3).map((x) => `${named(x.name)} (${int(x.count)})`).join(', ')}.`] : [`No market could be read from the enquiries in ${when}.`];
    if (unknown?.count) lines.push(`For ${pc(unknown.share)} of them the market could not be told: it is read from phone codes and email addresses.`);
    const visits = (log.traffic.countries || []).slice(0, 3);
    if (visits.length) lines.push(`Visitors came most from ${visits.map((x) => `${named(x.name)} (${pc(x.share)})`).join(', ')}.`);
    return { lines, bars: m.slice(0, 6).map((x) => ({ label: named(x.name), value: x.count })), link: { href: '#report', label: 'Report' } };
  }],
  ['sources', (q) => has(q, 'come from', 'comes from', 'came from', 'source', 'channel', 'referr', 'google', 'search', 'social', 'campaign', 'find us', 'found us'), ({ log, when }) => {
    const t = log.traffic;
    const ch = (t.channels || []).slice(0, 6);
    if (!ch.length) return { lines: [`No visits were recorded in ${when}.`] };
    const prev = Object.fromEntries((t.previousChannels || []).map((c) => [c.name, c.count]));
    const lines = [`In ${when}, page views came ${ch.slice(0, 3).map((c) => `${pc(c.share)} from ${(CHANNEL_NAMES[c.name] || c.name).toLowerCase()}`).join(', ')}.`];
    if (ch[0]?.name === 'direct') lines.push('Direct includes links opened in WhatsApp and most apps, which hide where they came from.');
    const ref = (t.referrers || []).filter((r) => r.name !== 'direct').slice(0, 3);
    if (ref.length) lines.push(`Websites that sent visitors: ${ref.map((r) => r.name).join(', ')}.`);
    return { lines, bars: ch.map((c) => ({ label: CHANNEL_NAMES[c.name] || c.name, value: c.count, note: change(c.count, prev[c.name] ?? 0) })), link: { href: '#traffic', label: 'Traffic' } };
  }],
  ['devices', (q) => has(q, 'phone', 'mobile', 'device', 'desktop', 'tablet', 'computer'), ({ log, when }) => {
    const d = log.traffic.devices || {};
    const total = sum(d);
    if (!total) return { lines: [`No visits were recorded in ${when}.`] };
    return { lines: [`In ${when}: ${pc((d.mobile || 0) / total)} of page views were on phones, ${pc((d.desktop || 0) / total)} on computers and ${pc((d.tablet || 0) / total)} on tablets.`], bars: [['Phones', d.mobile], ['Computers', d.desktop], ['Tablets', d.tablet]].map(([label, value]) => ({ label, value: value || 0 })), link: { href: '#traffic', label: 'Traffic' } };
  }],
  ['journey', (q) => has(q, 'journey', 'funnel', 'step', 'convert', 'conversion', 'studio', 'whatsapp', '3d', 'mockup', 'reach'), ({ log, line, when }) => {
    const f = log.funnel?.thisPeriod || {};
    const steps = line === 'agriculture'
      ? [['Visitors', f.visitors], ['Reached agriculture', f.reachedAgriculture], ['Opened a product', f.openedAgricultureProduct], ['Sent an enquiry', f.sentAgricultureEnquiry]]
      : line === 'packaging'
        ? [['Visitors', f.visitors], ['Reached packaging', f.reachedPackaging], ['Used the studio', f.usedStudio], ['Sent an enquiry', f.sentPackagingEnquiry]]
        : [['Visitors', f.visitors], ['Reached agriculture', f.reachedAgriculture], ['Reached packaging', f.reachedPackaging], ['Sent an enquiry', (f.sentAgricultureEnquiry || 0) + (f.sentPackagingEnquiry || 0)]];
    const a = log.actions || {};
    const extra = [a.reveal_whatsapp?.count ? `${plural(a.reveal_whatsapp.count, 'WhatsApp button press', 'WhatsApp button presses')}` : null, a.view_3d?.count ? `${plural(a.view_3d.count, '3D view')}` : null, a.studio_download?.count ? `${plural(a.studio_download.count, 'mockup download')}` : null].filter(Boolean);
    return { lines: [`In ${when}, of ${plural(f.visitors || 0, 'visitor')}: ${steps.slice(1).map(([label, n]) => `${label.toLowerCase()} ${int(n || 0)}`).join(', ')}.`, extra.length ? `Also: ${extra.join(', ')}.` : ''].filter(Boolean),
      bars: steps.map(([label, value]) => ({ label, value: value || 0 })), link: { href: '#traffic', label: 'Traffic' } };
  }],
  ['pages', (q) => has(q, 'page', 'leave', 'bounce', 'read', 'engag'), ({ q, log, when }) => {
    const pages = (log.traffic.pages || []).filter((p) => p.views > 0);
    if (!pages.length) return { lines: [`No page views were recorded in ${when}.`] };
    if (has(q, 'leave', 'bounce', 'quick')) {
      const quick = pages.filter((p) => p.views >= 5 && p.engagedShare != null).sort((a, b) => a.engagedShare - b.engagedShare).slice(0, 5);
      return { lines: quick.length ? [`Pages most often left quickly: ${quick.slice(0, 3).map((p) => `${pageName(p.path)} (${pc(1 - p.engagedShare)} left within 15 seconds or before scrolling halfway)`).join('; ')}.`] : ['No page has had enough views yet to judge.'],
        bars: quick.map((p) => ({ label: pageName(p.path), value: Math.round((1 - p.engagedShare) * 100), display: `${pc(1 - p.engagedShare)} left quickly`, note: `${int(p.views)} views` })), link: { href: '#traffic', label: 'Traffic' } };
    }
    return { lines: [`Most viewed in ${when}: ${pages.slice(0, 3).map((p) => `${pageName(p.path)} (${int(p.views)})`).join(', ')}.`], bars: pages.slice(0, 6).map((p) => ({ label: pageName(p.path), value: p.views, note: p.engagedShare != null ? `${pc(p.engagedShare)} stayed with it` : null })), link: { href: '#traffic', label: 'Traffic' } };
  }],
  ['team', (q, data) => has(q, 'who', 'team', 'person', 'staff', 'workload', 'busiest', 'holds', 'each of') || !!memberIn(q, data.members), ({ q, data }) => {
    const OPEN = ['new', 'read', 'contacted', 'quoted'];
    const people = (data.members || []).filter((m) => m.role === 'agri' || m.role === 'pack');
    const rows = people.map((m) => ({ m,
      open: (data.leads || []).filter((l) => l.assignee?.id === m.id && OPEN.includes(l.status)).length,
      overdue: (data.overdue || []).filter((d) => d.lead.assignee?.id === m.id).length,
      won: (data.leads || []).filter((l) => l.assignee?.id === m.id && l.status === 'won').length }));
    const one = memberIn(q, people);
    if (one) {
      const r = rows.find((x) => x.m.id === one.id);
      return { lines: [`${one.name} holds ${plural(r.open, 'open enquiry', 'open enquiries')}, ${int(r.overdue)} overdue, and has ${int(r.won)} won.`], link: { href: `#inbox?filter=open&owner=${encodeURIComponent(one.id)}`, label: `${one.name}'s enquiries` } };
    }
    if (!rows.length) return { lines: ['No one is on the marketing teams yet.'] };
    const loose = (data.leads || []).filter((l) => !l.assignee && OPEN.includes(l.status)).length;
    const byOverdue = [...rows].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    const lines = [`${byOverdue[0].m.name} has the most overdue: ${int(byOverdue[0].overdue)} of ${plural(byOverdue[0].open, 'open enquiry', 'open enquiries')}.`];
    if (loose) lines.push(`${plural(loose, 'open enquiry', 'open enquiries')} ${loose === 1 ? 'is' : 'are'} not handed out to anyone.`);
    return { lines, bars: byOverdue.map((r) => ({ label: r.m.name, value: r.open, note: `${int(r.overdue)} overdue, ${int(r.won)} won` })), link: { href: '#people', label: 'Team performance' } };
  }],
  ['waiting', (q) => has(q, 'overdue', 'late', 'wait', 'stuck', 'pipeline', 'stage', 'open', 'follow', 'behind'), ({ data }) => {
    const waits = stageWaits(data.leads || []);
    const open = waits.reduce((n, w) => n + w.count, 0);
    if (!open) return { lines: ['No enquiries are open: nothing is waiting.'] };
    const worst = waits.filter((w) => w.count).sort((a, b) => b.count * (b.medianDays || 0) - a.count * (a.medianDays || 0))[0];
    const d = (x) => (x == null ? 'no time' : x < 1 ? 'under a day' : `${int(Math.round(x))} days`);
    return { lines: [`${plural(open, 'enquiry', 'enquiries')} open, ${int((data.overdue || []).length)} overdue.`, `Most of the waiting is at ${worst.label}: ${int(worst.count)}, typically ${d(worst.medianDays)} there.`],
      bars: waits.map((w) => ({ label: w.label, value: w.count, note: w.count ? `typically ${d(w.medianDays)}, the oldest ${d(w.oldestDays)}` : 'none' })), link: { href: '#pipeline', label: 'Pipeline' } };
  }],
  ['enquiries', (q) => has(q, 'enquir', 'inquir', 'lead', 'request', 'buyer'), ({ log, line, when }) => {
    const e = log.enquiries;
    if (line) {
      const n = e.byLine?.[line] ?? 0, prev = e.previousByLine?.[line] ?? 0;
      return { lines: [`${plural(n, `${line} enquiry`, `${line} enquiries`)} in ${when}, ${change(n, prev)}.`], link: { href: `#inbox?line=${line === 'agriculture' ? 'agri' : 'pack'}`, label: 'Enquiries' } };
    }
    const st = Object.entries(e.stageOfThisPeriodsEnquiries || {}).filter(([, v]) => v);
    return { lines: [`${plural(e.received, 'enquiry', 'enquiries')} in ${when}, ${change(e.received, e.previous)}: ${int(e.byLine?.agriculture)} agriculture and ${int(e.byLine?.packaging)} packaging.`, st.length ? `Where they are now: ${st.map(([k, v]) => `${k} ${int(v)}`).join(', ')}.` : ''].filter(Boolean),
      bars: [['Agriculture', e.byLine?.agriculture], ['Packaging', e.byLine?.packaging]].map(([label, value]) => ({ label, value: value || 0 })), link: { href: '#report', label: 'Report' } };
  }],
  ['visitors', (q) => has(q, 'visit', 'traffic', 'view', 'audience', 'how busy', 'people came'), ({ log, when }) => {
    const t = log.traffic.totals, p = log.traffic.previous || {};
    return { lines: [`In ${when}: ${plural(t.visitors, 'visitor')} (${change(t.visitors, p.visitors)}) and ${plural(t.views, 'page view')} (${change(t.views, p.views)}).`, `A visitor saw ${t.viewsPerVisitor ?? 'no'} pages on average and stayed about ${int(t.averageSecondsOnPage)} seconds on each.`],
      link: { href: '#traffic', label: 'Traffic' } };
  }],
];
