// The performance log for an AI (lib/ai-log.js) and the page speed it reports
// (lib/vitals.js): it carries counts and totals, never personal data, even when the
// records it is built from are full of it, and its figures are the staff screens'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAiLog, snapshotOf, ACTIONS, SCHEMA, MIN_GROUP } from '../lib/ai-log.js';
import { cleanSample, addSample, readHistogram, summarise, pageGroup, mergeInto } from '../lib/vitals.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const at = (daysAgo, h = 0) => new Date(NOW - daysAgo * 86400000 + h * 3600000).toISOString();
const aggregate = (over = {}) => ({
  series: [{ date: '2026-11-07', views: 40, uniques: 12, inquiries: 3 }], views: 40, uniques: 12, inquiries: 3,
  pages: {}, referrers: {}, devices: { desktop: 8, mobile: 4, tablet: 0 }, productClicks: {}, productInquiries: {},
  channels: { search: 7, direct: 5 }, campaigns: {}, langs: { en: 9, am: 3 }, countries: {}, entries: {}, heat: { '1-14': 9, '3-10': 4 },
  events: {}, inquiryLines: { agri: 2, pack: 1 }, funnel: { visit: 12, pack: 6, studio: 2, enquiryPack: 1 }, eng: {}, leaves: 10, engaged: 6, secs: 420, vitals: {}, ...over,
});

// what a real enquiry holds: every one of these must stay out of the log
const PERSONAL = ['Abebe Kebede', 'abebe@kaldicoffee.com.et', '+251 911 22 33 44', '911223344', 'Kaldi Coffee PLC', 'call me after 5pm about the secret blend', 'Djibouti', 'Selam Tesfaye', 'staff-member-7'];
const lead = (o) => ({ id: Math.random(), name: 'Abebe Kebede', email: 'abebe@kaldicoffee.com.et', phone: '+251 911 22 33 44', company: 'Kaldi Coffee PLC', message: 'Hello, call me after 5pm about the secret blend. Destination port: Djibouti', status: 'new', ...o });
const inquiries = [
  lead({ product: 'Cleaned Natural Sesame', line: 'agri', createdAt: at(1), status: 'quoted', history: [{ status: 'read', from: 'new', at: at(1, 2), by: { name: 'Selam Tesfaye' } }], assignee: { id: 'staff-member-7', name: 'Selam Tesfaye' }, quotes: [{ at: at(0.5), currency: 'USD', total: 12000.4, items: [{ name: 'Sesame', note: 'secret blend' }] }] }),
  lead({ product: 'Pizza boxes', line: 'pack', createdAt: at(2), status: 'won', history: [{ status: 'won', from: 'new', at: at(1) }], design: '{"text1":"KALDI"}', bundle: [{ productId: 'pk_pizza' }], files: [{ name: 'abebe-logo.png' }] }),
  lead({ product: 'My own special thing for Abebe', line: 'agri', createdAt: at(3), phone: '0911223344', email: 'x@gmail.com' }),
  lead({ product: 'Pizza boxes', line: 'pack', createdAt: at(45) }), // the period before
];
const packaging = [
  { id: 'pk_pizza', name: 'Pizza boxes', family: 'food', shape3d: 'mailer', sizes: [{ id: 'm', label: 'Medium', w: 30, d: 30, h: 4, holds: 'One 30 cm pizza' }], minOrder: 1000 },
  { id: 'pk_hidden', name: 'Hidden', site: false, sizes: [] },
];
const agri = [{ id: 'sesame', name: 'Cleaned Natural Sesame', purity: '99.95%', spec: { moisture: '6%' } }];
const cur = aggregate({
  pages: { '/': 20, '/packaging/': 10, '/packaging/pizza-boxes/': 4, '/abebe-kebede/': 3, '/x@y.com/': 1, '/agriculture/?email=abebe@kaldicoffee.com.et': 2 },
  entries: { '/': 8, '/abebe-kebede/': 1 },
  productClicks: { 'Cleaned Natural Sesame': 6, 'Call me on +251 911 22 33 44': 1 },
  productInquiries: { 'Pizza boxes': 1, 'My own special thing for Abebe': 1 },
  referrers: { 'google.com': 5, direct: 5, 'abebe kebede': 1 },
  campaigns: { 'spring-launch / email / sesame': 4, 'Abebe Kebede': 1 },
  events: { bundle_add: 3, view_3d: 2, reveal_phone: 1 },
  eng: { '/packaging/': { n: 5, engaged: 3, secs: 200, deep: 2, b: [1, 1, 1, 1, 1] } },
});
const prev = aggregate({ views: 20, uniques: 8, inquiries: 1, events: { bundle_add: 1 } });
const built = new Set(['/', '/packaging/', '/packaging/pizza-boxes/', '/agriculture/']);
const make = (o = {}) => buildAiLog({ now: NOW, days: 30, cur, prev, inquiries, packaging, agri, certificates: [{ name: 'ECTA export licence', validUntil: '2026-12-01', file: '/uploads/certificates/x.pdf' }], emailStatus: { ok: false, at: at(0), to: 'abebe@kaldicoffee.com.et', error: 'refused for abebe@kaldicoffee.com.et' }, health: { failing: ['emailDelivery'], store: { store: 'file', ok: true, pending: 0, error: 'none' } }, targets: { agri: { enquiries: 10, quotes: null, wonValue: null, currency: 'USD' } }, isKnownPath: (p) => built.has(p), site: 'https://oliraagroindustry.com', ...o });

test('no personal data reaches the log, however much the records hold', () => {
  const text = JSON.stringify(make());
  for (const s of PERSONAL) assert.ok(!text.toLowerCase().includes(s.toLowerCase()), `"${s}" leaked into the log`);
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), 'no email address of any kind');
  assert.ok(!/\+?\d[\d ]{8,}\d/.test(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '')), 'no phone-like number');
  assert.ok(!text.includes('abebe'), 'nor a page address or product name a visitor made up');
});

test('the figures are what the staff screens count', () => {
  const log = make();
  assert.equal(log.schema, 'olira-site-log/1');
  assert.deepEqual(log.period, { days: 30, from: '2026-10-09', to: '2026-11-07' });
  assert.deepEqual(log.traffic.totals, { views: 40, visitors: 12, enquiries: 3, enquiriesPer100Visitors: 25, viewsPerVisitor: 3.33, engagedShare: 0.6, averageSecondsOnPage: 42 });
  assert.deepEqual(log.traffic.pages.map((p) => [p.path, p.views]), [['/', 20], ['/packaging/', 10], ['(other pages)', 6], ['/packaging/pizza-boxes/', 4]], 'made-up addresses are summed, never named');
  assert.equal(log.traffic.pages[1].engagedShare, 0.6);
  assert.deepEqual(log.traffic.referrers.map((r) => r.name), ['direct', 'google.com', '(other)']);
  assert.deepEqual(log.traffic.campaigns.map((r) => r.name), ['spring-launch / email / sesame'], 'a one-off tag is left out');
  assert.deepEqual(log.traffic.busiestHours[0], { weekday: 'Monday', hourAddisAbaba: 14, views: 9 });
  assert.deepEqual(log.funnel.thisPeriod.reachedPackaging, 6);
  assert.deepEqual(log.actions.bundle_add, { count: 3, previous: 1, meaning: ACTIONS.bundle_add });
  const e = log.enquiries;
  assert.equal(e.received, 3); assert.equal(e.previous, 1, 'the enquiry from 45 days ago is in the period before');
  assert.deepEqual(e.byLine, { agriculture: 2, packaging: 1 });
  assert.equal(e.won, 1); assert.equal(e.winRate, 1);
  assert.deepEqual(e.quotes, { sent: 1, valueByCurrency: { USD: 12000 } });
  assert.equal(e.firstResponseHoursMedian, 13, 'median of 2 h and 24 h, the same rule as the Report');
  assert.deepEqual(e.products.map((p) => p.name).sort(), ['(not a catalogue product)', 'Cleaned Natural Sesame', 'Pizza boxes'], 'free text is never named');
  assert.ok(e.markets.every((m) => m.name === 'other' || m.name === 'unknown' || m.count >= MIN_GROUP), 'a market of one or two buyers is merged');
  assert.equal(e.withStudioDesign, 1); assert.equal(e.withPackingList, 1); assert.equal(e.withFiles, 1);
  assert.equal(log.targets.agriculture.enquiries.target, 10);
  assert.equal(log.catalogue.packaging.products, 1, 'a product hidden from the site is not counted');
  assert.equal(log.catalogue.packaging.sizesWithWhatFits, 1);
  assert.equal(log.catalogue.packaging.shownAs3dBox, 1);
  assert.deepEqual(log.catalogue.agriculture.interest, [{ name: 'Cleaned Natural Sesame', opened: 6, enquiries: 0 }]);
  assert.equal(log.certificates.expiringWithin60Days, 1);
  assert.deepEqual(log.health.emailDelivery, { working: false, lastAttempt: at(0) }, 'the status, never the address or the server\'s words');
});

test('every counted action has a meaning, and every part of the log is described', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const list = server.match(/const TRACK_EVENTS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(list, 'TRACK_EVENTS found in server.js');
  const events = [...list[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
  assert.ok(events.length > 20);
  assert.deepEqual(Object.keys(ACTIONS).sort(), events, 'a new event needs its meaning in ACTIONS');
  const log = make();
  const meta = ['schema', 'about', 'site', 'generatedAt', 'period', 'previousPeriod', 'trackedSince', 'notes', 'previousSpeed'];
  for (const k of Object.keys(log).filter((k) => !meta.includes(k))) assert.ok(SCHEMA.sections[k], `the schema describes "${k}"`);
});

test('real visitors\' speed: kept as counts, read as Google reads it', () => {
  assert.deepEqual(cleanSample({ lcp: 1800, inp: '120', cls: 0.02, ttfb: 300 }), { lcp: 1800, inp: 120, cls: 0.02, ttfb: 300 });
  assert.equal(cleanSample({ lcp: -1, inp: 'fast', cls: 99, ttfb: '' }), null, 'nothing usable, nothing stored');
  assert.deepEqual(cleanSample({ lcp: 1e9, cls: 0.3 }), { cls: 0.3 });
  assert.equal(pageGroup('/'), 'home'); assert.equal(pageGroup('/packaging/pizza-boxes/'), 'packaging-product'); assert.equal(pageGroup('/agriculture/'), 'agriculture'); assert.equal(pageGroup('/x@y/'), 'other');
  const store = {};
  for (const lcp of [1000, 2000, 2400, 5000]) addSample(store, 'packaging', 'mobile', { lcp });
  addSample(store, 'made-up', 'fridge', { ttfb: 100 });
  assert.deepEqual(Object.keys(store).sort(), ['other|desktop', 'packaging|mobile'], 'only the known kinds of page and device');
  assert.deepEqual(readHistogram('lcp', store['packaging|mobile'].lcp), { samples: 4, p75AtMost: 2500, p75Over: null, goodShare: 0.75, rating: 'good' });
  addSample(store, 'packaging', 'mobile', { lcp: 12000 }); addSample(store, 'packaging', 'mobile', { lcp: 12000 });
  assert.deepEqual(readHistogram('lcp', store['packaging|mobile'].lcp), { samples: 6, p75AtMost: null, p75Over: 10000, goodShare: 0.5, rating: 'poor' });
  const twoDays = mergeInto(mergeInto({}, store), store);
  assert.equal(summarise(twoDays).pageViews, 14);
  assert.equal(summarise(twoDays, (k) => k.endsWith('|mobile')).lcp.samples, 12);
  const log = make({ cur: { ...cur, vitals: store } });
  assert.equal(log.speed.byPage.packaging.lcp.samples, 6);
  assert.equal(log.speed.byDevice.mobile.pageViews, 6);
});

test('a day\'s history line holds the main figures only', () => {
  const line = snapshotOf(make());
  assert.deepEqual(Object.keys(line).sort(), ['actions', 'byLine', 'catalogueCompleteness', 'date', 'engagedShare', 'enquiries', 'firstResponseHoursMedian', 'openPipeline', 'speedP75', 'views', 'visitors']);
  assert.equal(line.date, '2026-11-07');
  assert.equal(line.openPipeline, 3, 'quoted, plus two new (the one from the period before still counts today)');
  for (const s of PERSONAL) assert.ok(!JSON.stringify(line).includes(s));
});

test('an older product name many buyers used is kept, marked; typed details never are', () => {
  const extra = [
    ...[1, 2, 3].map((n) => lead({ product: 'Kraft paper bags', line: 'pack', createdAt: at(n) })),
    ...[1, 2, 3].map((n) => lead({ product: 'Call 0911223344 now', line: 'pack', createdAt: at(n) })),
    ...[1, 2, 3].map((n) => lead({ product: 'see www.example.com', line: 'pack', createdAt: at(n) })),
    lead({ product: 'Humera sesame', line: 'agri', createdAt: at(2) }),
  ];
  const e = make({ inquiries: [...inquiries, ...extra] }).enquiries;
  const by = Object.fromEntries(e.products.map((p) => [p.name, p]));
  assert.deepEqual([by['Kraft paper bags']?.count, by['Kraft paper bags']?.inCatalogue], [3, false], 'shared by three: kept, marked as not in the catalogue');
  assert.equal(by['Pizza boxes'].inCatalogue, true);
  assert.equal(by['Humera sesame'], undefined, 'one enquiry alone is never named');
  assert.equal(by['Call 0911223344 now'], undefined, 'a phone number is never a product');
  assert.equal(by['see www.example.com'], undefined, 'nor a web address');
  assert.equal(by['(not a catalogue product)'].count, 8);
});
