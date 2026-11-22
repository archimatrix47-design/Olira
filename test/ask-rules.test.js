// Ask the data without a model (lib/ask-rules.js): each question finds its subject,
// the period and line are read from the words, and the answers carry the right numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, periodOf, lineOfQuestion, CAN_ANSWER } from '../lib/ask-rules.js';

const day = 86400000, now = Date.now();
const at = (d) => new Date(now - d * day).toISOString();
const LOG = {
  period: { days: 30, from: '2026-10-23', to: '2026-11-21' },
  traffic: {
    totals: { views: 400, visitors: 120, viewsPerVisitor: 3.3, averageSecondsOnPage: 70 },
    previous: { views: 300, visitors: 100 },
    channels: [{ name: 'search', count: 240, share: 0.6 }, { name: 'direct', count: 160, share: 0.4 }],
    previousChannels: [{ name: 'search', count: 150, share: 0.5 }],
    devices: { desktop: 100, mobile: 280, tablet: 20 },
    countries: [], referrers: [],
    pages: [{ path: '/packaging/', views: 200, engagedShare: 0.3 }, { path: '/', views: 150, engagedShare: 0.8 }],
  },
  funnel: { thisPeriod: { visitors: 120, reachedAgriculture: 30, reachedPackaging: 70, openedAgricultureProduct: 10, usedStudio: 20, sentAgricultureEnquiry: 2, sentPackagingEnquiry: 6 } },
  actions: { reveal_whatsapp: { count: 9 } },
  speed: { overall: { pageViews: 50, lcp: { p75AtMost: 1800, rating: 'good' } }, byDevice: { mobile: { pageViews: 30, lcp: { p75AtMost: 3200, rating: 'needs-improvement' } } }, byPage: {} },
  enquiries: {
    received: 8, previous: 4, byLine: { agriculture: 2, packaging: 6 }, previousByLine: { agriculture: 1, packaging: 3 },
    stageOfThisPeriodsEnquiries: { New: 5, Quoted: 3 }, openNowAllTime: { Quoted: 3 },
    firstResponseHoursMedian: 2.5, previousFirstResponseHoursMedian: 5, firstResponse: { 'Under 1 hour': 2, 'Not answered yet': 3 },
    won: 1, lost: 2, winRate: 1 / 3, quotes: { sent: 3, valueByCurrency: { USD: 12000 } },
    leadScore: { average: 55, bands: { strong: 2, fair: 4, thin: 2 }, mostOftenMissing: [{ name: 'quantity', share: 0.5 }] },
    markets: [{ name: 'KE', count: 4, share: 0.5 }, { name: 'unknown', count: 4, share: 0.5 }],
    products: [{ name: 'Pizza boxes', count: 5 }],
  },
  catalogue: {
    packaging: { products: 18, withPhoto: 11, withPrice: 0, withMinimumOrder: 0, withLeadTime: 0, sizes: 54, sizesMeasured: 30, leastComplete: [{ name: 'Bakery boxes', score: 0, missing: ['photo', 'price'] }], interest: [{ name: 'Medical packets', opened: 24, enquiries: 0 }, { name: 'Twisted handle bags', opened: 10, enquiries: 9 }] },
    agriculture: { products: 7, withPhoto: 7, withMinimumOrder: 7, averageCompleteness: 78, leastComplete: [], interest: [] },
  },
  certificates: { total: 6, valid: 0, expired: 0, expiringWithin60Days: 0, withoutProofFile: 6 },
  health: { emailDelivery: { working: false }, failingChecks: [] },
};
const MEMBERS = [{ id: 'a', name: 'Hana Tesfaye', role: 'agri' }, { id: 'p', name: 'Dawit Bekele', role: 'pack' }];
const LEADS = [
  { id: '1', status: 'new', createdAt: at(10), assignee: { id: 'p' } },
  { id: '2', status: 'quoted', createdAt: at(20), assignee: { id: 'p' }, history: [{ status: 'quoted', at: at(15) }] },
  { id: '3', status: 'read', createdAt: at(3), assignee: { id: 'a' } },
  { id: '4', status: 'new', createdAt: at(1) },
];
const DATA = { log: LOG, leads: LEADS, members: MEMBERS, overdue: [{ lead: LEADS[0] }, { lead: LEADS[1] }] };
const ask = (q) => answer(q, DATA);
const text = (a) => a.lines.join(' ');

test('every example question the page offers finds its own subject, not the help list', () => {
  for (const [, example] of CAN_ANSWER) assert.notEqual(ask(example).topic, 'help', example);
});

test('questions go to the subject they ask about', () => {
  const cases = {
    'How many visitors did we have this month?': 'visitors',
    'How many people came to the site?': 'visitors',
    'Where do our visitors come from?': 'sources',
    'Which pages do visitors leave quickly?': 'pages',
    'How quickly are enquiries answered?': 'response',
    'Is the website fast enough on phones?': 'speed',
    'Which products do visitors look at but rarely ask about?': 'interest',
    'What should the teams fill in first in the catalogues?': 'gaps',
    'Who has the most overdue enquiries?': 'team',
    'How is Hana doing?': 'team',
    'Where are enquiries stuck?': 'waiting',
    'Are enquiries down?': 'enquiries',
    'Which certificates are missing a document?': 'certificates',
    'How many visitors reach the packaging page and send an enquiry?': 'journey',
    'what is the weather like': 'help',
  };
  for (const [q, topic] of Object.entries(cases)) assert.equal(ask(q).topic, topic, q);
});

test('the period and the business line are read from the words', () => {
  assert.equal(periodOf('enquiries this week'), 7);
  assert.equal(periodOf('wins this quarter'), 90);
  assert.equal(periodOf('visitors over the last 12 months'), 365);
  assert.equal(periodOf('how many visitors'), null);
  assert.equal(lineOfQuestion('how many packaging enquiries'), 'packaging');
  assert.equal(lineOfQuestion('sesame enquiries from Kenya'), 'agriculture');
  assert.equal(lineOfQuestion('all enquiries'), null);
});

test('answers carry the right numbers and say where to check them', () => {
  assert.match(text(ask('How many visitors did we have?')), /120 visitors \(up 20% on the previous period\)/);
  assert.match(text(ask('How many packaging enquiries?')), /^6 packaging enquiries in the last 30 days/);
  assert.match(text(ask('How quickly are enquiries answered?')), /within 2\.5 h.*down/);
  assert.match(text(ask('How much did we win?')), /1 enquiry won and 2 lost, a win rate of 33%/);
  assert.match(text(ask('Which products do visitors look at but rarely ask about?')), /Medical packets \(opened 24 times, 0 enquiries\)/);
  assert.match(text(ask('Is the website fast enough on phones?')), /On phones.*3\.2 s for three in four views \(needs improvement/);
  assert.match(text(ask('Who has the most overdue enquiries?')), /Dawit Bekele has the most overdue: 2 of 2 open enquiries/);
  assert.match(text(ask('How is Hana doing?')), /Hana Tesfaye holds 1 open enquiry, 0 overdue/);
  assert.match(text(ask('Which certificates are missing a document?')), /none with its dates filled in.*6 have no certificate document/);
  assert.equal(ask('Where do our visitors come from?').link.href, '#traffic');
  assert.ok(ask('Where are enquiries stuck?').bars.length === 4, 'one bar per open stage');
});

test('a question it cannot read gets the list of questions it can answer', () => {
  const a = ask('tell me a joke');
  assert.equal(a.topic, 'help');
  assert.equal(a.ideas.length, CAN_ANSWER.length);
});

test('the Ask buttons start disabled and the script enables them once it handles them', async () => {
  const fs = await import('node:fs');
  const view = fs.readFileSync(new URL('../src/components/team/views/Ask.astro', import.meta.url), 'utf8');
  // pressed before the script is ready, a live submit button sends the form natively and reloads the page
  assert.match(view, /<button[^>]*id="askGo"[^>]*\sdisabled[\s>]/);
  assert.match(view, /<button[^>]*data-ask-idea[^>]*\sdisabled[\s>]/);
  const js = fs.readFileSync(new URL('../src/scripts/team/manager/ask.js', import.meta.url), 'utf8');
  const show = js.slice(js.indexOf('export async function show'));
  const bindAt = show.indexOf('bind();'), enableAt = show.indexOf("$('#askGo').disabled = false");
  assert.ok(bindAt > 0 && enableAt > bindAt, 'enabled after the submit handler is bound');
  assert.ok(enableAt < show.indexOf('await '), 'enabled without waiting for the model settings');
});
