// The website's performance log, written for an AI to read: an AI reader account
// (GET /api/ai/log, lib/ai-access.js) or the local model the manager asks
// ("Ask the data" in the manager's workspace). It covers traffic, real visitors'
// page speed, the visit-to-enquiry funnel, what visitors did, the enquiry pipeline,
// targets, how complete the catalogues are, certificates and the site's health.
//
// Counts and totals only. It never holds a name, an email address, a phone number,
// a company, a message, a file, a quote's lines or a staff member's name. Every
// string a visitor could have typed (a page address, a product name, a campaign
// tag) is checked against the site's own pages or catalogue first, and markets
// seen on fewer than MIN_GROUP enquiries are merged, so no single buyer stands out.
// The figures are the ones staff see: the same aggregation as the Traffic page and
// the same definitions as the manager's Report (admin/leads.js), Products
// (admin/completeness.js) and targets (team/targets-progress.js).
// Pure: server.js passes the data in, and so do the tests.
import { STAGES, lineOfLead, scoreOf, firstResponseHours, median, marketOf, RESPONSE_BUCKETS } from './lead-rules.js';
import { agriCompleteness, packCompleteness } from './completeness.js';
import { progress } from './targets-progress.js';
import { hasPhotoMockup, inStudio } from './catalogue-facts.js';
import { has3d } from './box-styles.js';
import { certStatus, daysLeft } from './certificates.js';
import { summarise, PAGE_GROUPS, DEVICES, GOOD, POOR } from './vitals.js';

export const SCHEMA_VERSION = 'olira-site-log/1';
export const MIN_GROUP = 3;
const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OTHER_PAGES = '(other pages)';
const OTHER_PRODUCT = '(not a catalogue product)';
// what the enquiry form offers besides the catalogue's own names
const GENERIC_PRODUCTS = ['Agricultural products', 'Packaging', 'Several products', 'Not specified', 'Other'];

/** What each counted visitor action means (the events of /api/track, TRACK_EVENTS in lib/analytics.js). */
export const ACTIONS = {
  reveal_phone: 'Pressed a Call button and was shown the phone number',
  reveal_whatsapp: 'Pressed a WhatsApp button',
  telegram: 'Opened Telegram',
  email: 'Clicked an email address',
  home_product: 'Pointed at a product on the home page to see its photo',
  catalogue_filter: 'Filtered the packaging catalogue by group',
  studio_change: 'Changed the product or the print in the mockup studio',
  studio_logo: 'Uploaded a logo in the mockup studio',
  studio_logo_warn: 'The studio\'s logo check flagged an upload',
  studio_logo_fix: 'Applied the logo check\'s one-click fix',
  studio_artwork: 'Uploaded a full artwork in the mockup studio',
  studio_download: 'Downloaded a mockup picture',
  view_3d: 'Looked at a box in 3D (studio or product page)',
  lid_3d: 'Opened the lid of a 3D box',
  studio_quote: 'Asked for a quote from the mockup studio',
  studio_quote_only: 'Asked for a quote on a product the studio has no photo of yet',
  bundle_add: 'Added a product to the packing list',
  bundle_add_page: 'Of those, added it from the product\'s own page',
  bundle_remove: 'Removed a product from the packing list',
  bundle_below_min: 'Tried to send a packing list with a quantity under the minimum',
  bundle_send: 'Put the packing list into the quote form',
  form_start: 'Started filling in an enquiry form',
  form_invalid: 'Pressed Send with a field still to correct',
  form_fail: 'An enquiry could not be sent (server or connection)',
};

/** The same-day funnel: visitors that reached each step on the same day (STEP in lib/analytics.js). */
const FUNNEL = [
  ['visit', 'visitors', 'Visited the website'],
  ['agri', 'reachedAgriculture', 'Opened an agriculture page'],
  ['pack', 'reachedPackaging', 'Opened a packaging page'],
  ['product', 'openedAgricultureProduct', 'Opened an agricultural product\'s details'],
  ['studio', 'usedStudio', 'Used the packaging mockup studio'],
  ['contactHome', 'contactedFromHome', 'Pressed a contact button on the home page'],
  ['contactAgri', 'contactedFromAgriculture', 'Pressed a contact button on an agriculture page'],
  ['contactPack', 'contactedFromPackaging', 'Pressed a contact button on a packaging page'],
  ['enquiryAgri', 'sentAgricultureEnquiry', 'Sent an agriculture enquiry'],
  ['enquiryPack', 'sentPackagingEnquiry', 'Sent a packaging enquiry'],
];

const share = (a, b) => (b ? +(a / b).toFixed(3) : null);
const round1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const sum = (obj) => Object.values(obj || {}).reduce((n, v) => n + (Number(v) || 0), 0);
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** [{ name, count, share }] largest first, at most n, of the entries keep() accepts. */
function top(obj, n, total = sum(obj), minCount = 1) {
  return Object.entries(obj || {}).filter(([, c]) => c >= minCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
    .map(([name, count]) => ({ name, count, share: share(count, total) }));
}
/** Keys that fail keep() are summed under one name, so nothing unexpected is passed on. */
function only(obj, keep, other) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) { const key = keep(k) ? k : other; out[key] = (out[key] || 0) + (Number(v) || 0); }
  return out;
}
/** A page address the site really has, in a safe shape (never an address a visitor made up). */
const pathShape = /^\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+\.html)?$/;
const hostShape = /^(direct|[a-z0-9-]+(\.[a-z0-9-]+)+)$/;
const productShape = /^[\p{L}\p{N} ,.&()'/+-]{2,60}$/u;

function trafficSummary(a) {
  return {
    views: a.views,
    visitors: a.uniques,
    enquiries: a.inquiries,
    enquiriesPer100Visitors: a.uniques ? +((a.inquiries / a.uniques) * 100).toFixed(2) : null,
    viewsPerVisitor: a.uniques ? +(a.views / a.uniques).toFixed(2) : null,
    engagedShare: share(a.engaged, a.leaves),
    averageSecondsOnPage: a.leaves ? Math.round(a.secs / a.leaves) : null,
  };
}

function funnelOf(f) {
  const out = {};
  for (const [key, name] of FUNNEL) out[name] = f?.[key] || 0;
  return out;
}

function speedOf(vitals) {
  const overall = summarise(vitals);
  if (!overall) return null;
  const byDevice = {}, byPage = {};
  for (const d of DEVICES) { const s = summarise(vitals, (k) => k.endsWith(`|${d}`)); if (s) byDevice[d] = s; }
  for (const g of PAGE_GROUPS) { const s = summarise(vitals, (k) => k.startsWith(`${g}|`)); if (s) byPage[g] = s; }
  return { overall, byDevice, byPage };
}

function enquiriesOf(all, { now, days, offset, productNames }) {
  const end = now - offset * DAY, start = end - days * DAY;
  const within = (t, s = start, e = end) => { const x = Date.parse(t); return x > s && x <= e; };
  const cur = all.filter((l) => within(l.createdAt));
  const prev = all.filter((l) => within(l.createdAt, start - days * DAY, start));
  const byLine = (list) => ({ agriculture: list.filter((l) => lineOfLead(l) === 'agri').length, packaging: list.filter((l) => lineOfLead(l) === 'pack').length });
  const byStage = (list) => Object.fromEntries(STAGES.map((s) => [s.label, list.filter((l) => (l.status || 'new') === s.id).length]));
  const won = cur.filter((l) => l.status === 'won').length, lost = cur.filter((l) => l.status === 'lost').length;
  const resp = cur.map(firstResponseHours), prevResp = prev.map(firstResponseHours);
  const buckets = Object.fromEntries(RESPONSE_BUCKETS.map((b) => [b.label, resp.filter((h) => h !== null && b.test(h)).length]));
  buckets['Not answered yet'] = resp.filter((h) => h === null).length;
  // quotes sent in the period (each quote a lead was sent), and their value by currency
  const quotes = { sent: 0, valueByCurrency: {} };
  for (const l of all) {
    for (const q of Array.isArray(l.quotes) ? l.quotes : []) {
      if (!q?.at || !within(q.at)) continue;
      quotes.sent++;
      const cur3 = /^[A-Z]{3}$/.test(q.currency || '') ? q.currency : 'unknown';
      quotes.valueByCurrency[cur3] = Math.round((quotes.valueByCurrency[cur3] || 0) + (Number(q.total) || 0));
    }
  }
  // the lead score's details, never the details themselves
  const scores = cur.map(scoreOf);
  const missing = {};
  for (const s of scores) for (const c of s.checks) if (!c.ok) missing[c.gap] = (missing[c.gap] || 0) + 1;
  const markets = {};
  for (const l of cur) { const cc = marketOf(l)?.cc || 'unknown'; markets[cc] = (markets[cc] || 0) + 1; }
  // products asked for: the catalogue's names; an older name (a product since renamed) only
  // when at least MIN_GROUP enquiries share it and it reads as a name, never as typed details
  const known = new Set([...productNames, ...GENERIC_PRODUCTS]);
  const asked = {};
  for (const l of cur) { const n = String(l.product || '').trim(); asked[n] = (asked[n] || 0) + 1; }
  const products = only(asked, (n) => known.has(n) || (asked[n] >= MIN_GROUP && productShape.test(n) && !/@|https?:|www\.|\d{6,}/i.test(n)), OTHER_PRODUCT);
  return {
    received: cur.length, previous: prev.length,
    byLine: byLine(cur), previousByLine: byLine(prev),
    stageOfThisPeriodsEnquiries: byStage(cur),
    openNowAllTime: Object.fromEntries(STAGES.filter((s) => s.open).map((s) => [s.label, all.filter((l) => (l.status || 'new') === s.id).length])),
    handedOutShare: share(cur.filter((l) => l.assignee).length, cur.length),
    firstResponseHoursMedian: round1(median(resp)), previousFirstResponseHoursMedian: round1(median(prevResp)),
    firstResponse: buckets,
    won, lost, winRate: share(won, won + lost),
    quotes,
    leadScore: {
      average: scores.length ? Math.round(scores.reduce((n, s) => n + s.score, 0) / scores.length) : null,
      bands: { strong: scores.filter((s) => s.band === 'strong').length, fair: scores.filter((s) => s.band === 'fair').length, thin: scores.filter((s) => s.band === 'thin').length },
      mostOftenMissing: top(missing, 7, cur.length),
    },
    withStudioDesign: cur.filter((l) => l.design).length,
    withPackingList: cur.filter((l) => l.bundle).length,
    withFiles: cur.filter((l) => Array.isArray(l.files) && l.files.length).length,
    // countries from the buyer's phone code or email domain: a hint, merged below MIN_GROUP
    markets: top(only(markets, (cc) => cc === 'unknown' || markets[cc] >= MIN_GROUP, 'other'), 12, cur.length),
    products: top(products, 15, cur.length).map((x) => ({ ...x, inCatalogue: known.has(x.name) })),
  };
}

function targetsOf(all, targets, now) {
  const out = {};
  for (const [line, name] of [['agri', 'agriculture'], ['pack', 'packaging']]) {
    const t = targets?.[line];
    if (!t || [t.enquiries, t.quotes, t.wonValue].every((v) => v === null || v === undefined)) continue;
    const p = progress(all, t, line, now);
    const row = (r) => ({ done: r.done, target: r.target, onPace: r.onPace });
    out[name] = { month: p.month.name, monthElapsedShare: +p.month.elapsed.toFixed(3), enquiries: row(p.enquiries), quotes: row(p.quotes), wonValue: { ...row(p.wonValue), currency: p.wonValue.currency, wonInOtherCurrencies: p.wonValue.otherCurrency } };
  }
  return Object.keys(out).length ? out : null;
}

function catalogueOf(packaging, agri, opens, enquired) {
  const pack = (packaging || []).filter((p) => p && p.site !== false);
  const sizes = pack.flatMap((p) => (Array.isArray(p.sizes) ? p.sizes : []));
  const pScores = pack.map((p) => ({ name: p.name, ...packCompleteness(p) }));
  const aScores = (agri || []).map((p) => ({ name: p.name, ...agriCompleteness(p) }));
  const avg = (list) => (list.length ? Math.round(list.reduce((n, x) => n + x.score, 0) / list.length) : null);
  const weakest = (list) => [...list].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).filter((x) => !x.complete).slice(0, 10).map(({ name, score, missing }) => ({ name, score, missing }));
  const interest = (p) => ({ name: p.name, opened: opens[p.name] || 0, enquiries: enquired[p.name] || 0 });
  return {
    packaging: {
      products: pack.length,
      withPhoto: pack.filter((p) => p.image).length,
      designableInStudio: pack.filter(inStudio).length,
      withPhotoMockup: pack.filter(hasPhotoMockup).length,
      shownAs3dBox: pack.filter(has3d).length,
      sizes: sizes.length,
      sizesMeasured: sizes.filter((s) => s.w && s.h).length,
      sizesWithWhatFits: sizes.filter((s) => s.holds).length,
      withPrice: pack.filter((p) => p.pricePer1000 || (p.sizes || []).some((s) => s.pricePer1000)).length,
      withMinimumOrder: pack.filter((p) => p.minOrder || ((p.sizes || []).length && p.sizes.every((s) => s.minOrder))).length,
      withLeadTime: pack.filter((p) => p.leadTimeDays).length,
      averageCompleteness: avg(pScores),
      leastComplete: weakest(pScores),
      interest: pack.map(interest).filter((x) => x.opened || x.enquiries).sort((a, b) => b.enquiries - a.enquiries || b.opened - a.opened).slice(0, 20),
    },
    agriculture: {
      products: (agri || []).length,
      withPhoto: (agri || []).filter((p) => p.image).length,
      withPurity: (agri || []).filter((p) => p.purity).length,
      withMinimumOrder: (agri || []).filter((p) => p.moq).length,
      averageSpecificationFields: (agri || []).length ? round1((agri || []).reduce((n, p) => n + Object.values(p.spec || {}).filter((v) => String(v || '').trim()).length, 0) / agri.length) : null,
      averageCompleteness: avg(aScores),
      leastComplete: weakest(aScores),
      interest: (agri || []).map(interest).sort((a, b) => b.opened - a.opened || b.enquiries - a.enquiries),
    },
  };
}

function certificatesOf(certs, now) {
  const list = Array.isArray(certs) ? certs : [];
  const status = (s) => list.filter((c) => certStatus(c, now) === s).length;
  const upcoming = list.map((c) => ({ name: c.name, daysLeft: daysLeft(c, now) })).filter((c) => c.daysLeft !== null && c.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)[0] || null;
  return { total: list.length, valid: status('valid'), expiringWithin60Days: status('expiring'), expired: status('expired'), withoutProofFile: status('no-proof'), withVerifyLink: list.filter((c) => c.verifyUrl).length, nextToExpire: upcoming };
}

/**
 * The log for the `days` ending `offset` days ago. cur and prev are lib/analytics.js's
 * aggregateAnalytics(days, offset) and (days, offset + days).
 */
export function buildAiLog({ now = Date.now(), days = 30, offset = 0, cur, prev, inquiries = [], packaging = [], agri = [], certificates = [], emailStatus = null, health = null, targets = null, isKnownPath = () => false, firstTracked = null, site = '' }) {
  const end = now - offset * DAY;
  const known = (p) => typeof p === 'string' && p.length <= 100 && pathShape.test(p) && isKnownPath(p);
  const productNames = [...(packaging || []).map((p) => p.name), ...(agri || []).map((p) => p.name)].filter(Boolean);
  const isProduct = (n) => productNames.includes(n);
  const pages = only(cur.pages, known, OTHER_PAGES), prevPages = only(prev.pages, known, OTHER_PAGES);
  const opens = only(cur.productClicks, isProduct, OTHER_PRODUCT), enquired = only(cur.productInquiries, isProduct, OTHER_PRODUCT);
  const actions = {};
  for (const [name, meaning] of Object.entries(ACTIONS)) {
    const n = cur.events?.[name] || 0, p = prev.events?.[name] || 0;
    if (n || p) actions[name] = { count: n, previous: p, meaning };
  }
  const heat = Object.entries(cur.heat || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => {
    const [dow, hour] = k.split('-').map(Number);
    return { weekday: WEEKDAYS[dow] || null, hourAddisAbaba: hour, views: n };
  });
  const all = Array.isArray(inquiries) ? inquiries : [];

  return {
    schema: SCHEMA_VERSION,
    about: 'How the Olira Agro Industry website is performing, for an AI to read. Counts and totals only: no names, email addresses, phone numbers, companies or messages. Shares are fractions from 0 to 1. Field meanings: GET /api/ai/schema.',
    site,
    generatedAt: new Date(now).toISOString(),
    period: { days, from: dateOf(end - days * DAY + DAY), to: dateOf(end) },
    previousPeriod: { from: dateOf(end - 2 * days * DAY + DAY), to: dateOf(end - days * DAY) },
    trackedSince: firstTracked,
    traffic: {
      totals: trafficSummary(cur), previous: trafficSummary(prev),
      daily: (cur.series || []).map((d) => ({ date: d.date, views: d.views, visitors: d.uniques, enquiries: d.inquiries })),
      channels: top(cur.channels, 10), previousChannels: top(prev.channels, 10),
      devices: cur.devices,
      countries: top(cur.countries, 12),
      languages: top(cur.langs, 10),
      referrers: top(only(cur.referrers, (h) => hostShape.test(h), '(other)'), 12),
      campaigns: top(cur.campaigns, 10, sum(cur.campaigns), 2),
      landingPages: top(only(cur.entries, known, OTHER_PAGES), 10),
      pages: Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([path, n]) => {
        const e = path === OTHER_PAGES ? null : cur.eng?.[path];
        return { path, views: n, previousViews: prevPages[path] || 0, engagedShare: e?.n ? share(e.engaged, e.n) : null, averageSeconds: e?.n ? Math.round(e.secs / e.n) : null, scrolledThreeQuartersShare: e?.n ? share(e.deep, e.n) : null };
      }),
      busiestHours: heat,
    },
    funnel: { thisPeriod: funnelOf(cur.funnel), previous: funnelOf(prev.funnel) },
    actions,
    speed: speedOf(cur.vitals),
    previousSpeed: summarise(prev.vitals),
    enquiries: enquiriesOf(all, { now, days, offset, productNames }),
    targets: targetsOf(all, targets, end),
    catalogue: catalogueOf(packaging, agri, opens, enquired),
    certificates: certificatesOf(certificates, end),
    health: {
      emailDelivery: emailStatus ? { working: !!emailStatus.ok, lastAttempt: emailStatus.at || null } : null,
      enquiryStore: health?.store ? { kind: health.store.store || null, reachable: !!health.store.ok, waitingToBeStored: Number(health.store.pending) || 0 } : null,
      failingChecks: Array.isArray(health?.failing) ? health.failing.map(String).slice(0, 20) : [],
    },
    notes: [
      'Visitors are counted once per day: a person who comes back tomorrow is counted again. Nobody is followed from one day to the next.',
      'Bots, monitors and headless browsers are not counted. Staff pages are never counted.',
      `Page speed comes from real visitors' browsers (Chrome and Edge measure all four; Safari only the server time). p75AtMost: three in four visits were at most this; good limits: LCP ${GOOD.lcp} ms, INP ${GOOD.inp} ms, CLS ${GOOD.cls}, TTFB ${GOOD.ttfb} ms; poor above ${POOR.lcp} ms, ${POOR.inp} ms, ${POOR.cls}, ${POOR.ttfb} ms.`,
      'Countries of visitors come only from the hosting network when it supplies them; markets of enquiries are read from phone codes and email domains, so they are hints.',
      'Enquiry figures are for enquiries that arrived in the period; "openNowAllTime" is the pipeline today.',
      `Groups smaller than ${MIN_GROUP} enquiries are merged into "other", and anything a visitor could have typed is shown only when it matches the site's own pages or catalogue.`,
    ],
  };
}

/** One line of the daily history (ai-log.jsonl): the day's main figures, kept beyond the analytics' own retention. */
export function snapshotOf(log) {
  const t = log.traffic.totals, s = log.speed?.overall;
  return {
    date: log.period.to,
    views: t.views, visitors: t.visitors, enquiries: log.enquiries.received, byLine: log.enquiries.byLine,
    engagedShare: t.engagedShare,
    speedP75: s ? { lcp: s.lcp?.p75AtMost ?? null, inp: s.inp?.p75AtMost ?? null, cls: s.cls?.p75AtMost ?? null, ttfb: s.ttfb?.p75AtMost ?? null, pageViews: s.pageViews } : null,
    openPipeline: Object.values(log.enquiries.openNowAllTime).reduce((a, b) => a + b, 0),
    firstResponseHoursMedian: log.enquiries.firstResponseHoursMedian,
    catalogueCompleteness: { packaging: log.catalogue.packaging.averageCompleteness, agriculture: log.catalogue.agriculture.averageCompleteness },
    actions: Object.fromEntries(Object.entries(log.actions).map(([k, v]) => [k, v.count])),
  };
}

/** What every part of the log means, for GET /api/ai/schema. */
export const SCHEMA = {
  schema: SCHEMA_VERSION,
  endpoints: {
    'GET /api/ai/log?days=30': 'The log for the last 7 to 365 days, with the period before it for comparison.',
    'GET /api/ai/history': 'One line per day (snapshotOf): the main figures, kept for trends beyond a year.',
    'GET /api/ai/schema': 'This description.',
  },
  access: 'Send the reader key in the Authorization header: "Authorization: Bearer olira_ai_...". Never put it in the address. The admin can switch access off or remove a key at any time; then the answer is 403 or 401.',
  units: 'Times in milliseconds unless the name says seconds or hours. Shares are fractions from 0 to 1. Money is in the currency named beside it. Dates are UTC days, except busiestHours (Addis Ababa time).',
  sections: {
    traffic: 'Page views, daily visitors, enquiries, where visitors came from (channels, referrers, campaigns, countries, languages, devices), the pages they landed on and read, and how engaged they were (engaged = 15 seconds or more, or half the page scrolled).',
    funnel: 'Of the day\'s visitors, how many reached each step on the same day: a section, a product, the studio, a contact button, an enquiry.',
    actions: 'Counted visitor actions with their meaning (contact buttons, the mockup studio, the packing list, the enquiry forms).',
    speed: 'Real visitors\' page speed (Core Web Vitals): overall, by device and by kind of page. lcp = main content shown, inp = answer to a tap or click, cls = layout jumping, ttfb = server answer.',
    enquiries: 'The enquiry pipeline: received, by line, stages, first response time, wins, quotes and their value by currency, the lead score and the details buyers most often leave out, studio designs and packing lists attached, markets and products asked for.',
    targets: 'The month\'s targets set by the manager, and progress (done, target, on pace for the time of month).',
    catalogue: 'How complete each catalogue is for a buyer (0 to 100, the same score staff see), the least complete products and what they miss, and which products were opened and enquired about.',
    certificates: 'Certifications shown on the site: valid, expiring within 60 days, expired, without a proof file.',
    health: 'Whether enquiry emails are going out, whether the enquiry store is reachable, and any failing health checks.',
  },
  privacy: 'The log is built so that it cannot hold personal data: lib/ai-log.js reads only counts, dates, stages and catalogue facts, and the tests check that names, emails, phone numbers, companies and messages never appear in it.',
};
