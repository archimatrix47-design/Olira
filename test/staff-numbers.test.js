import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hours, delta, per100, believable, duration, SMALL_BASE } from '../lib/format.js';
import { scoreOf, scoreLabel, scoreReasons, oldestWaiting, BAND_KEY, stageSince, stageWaits, ageBands, recentMoves } from '../lib/lead-rules.js';

// The staff workspaces' numbers and inbox (fresh-eyes review FR-R19..R22).
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('an age of days is whole days, not "79.9 days"', () => {
  assert.equal(hours(79.9 * 24), '80 days');
  assert.equal(hours(80.4 * 24), '80 days');
  assert.equal(hours(30.5), '30.5 h', 'under two days stays in hours');
  assert.equal(hours(0.25), '15 min');
});

test('a change on a small earlier figure is a number, not a huge percentage', () => {
  assert.equal(SMALL_BASE, 20);
  assert.equal(delta(224, 18).text, '+206', 'not "+1,144%"');
  assert.equal(delta(224, 18).spoken, 'up 206 on the previous period');
  assert.equal(delta(45, 3).text, '+42');
  const gone = delta(0, 3);
  assert.equal(gone.text, '−3', 'not "−100%"');
  assert.equal(gone.tone, 'bad');
  assert.equal(delta(5, 0).text, '+5', 'from nothing: the count');
  assert.equal(delta(0, 0).text, 'No change');
  assert.equal(delta(130, 812).text, '−84%', 'a large earlier figure keeps the percentage');
  assert.equal(delta(25, 20).text, '+25%');
});

test('a small change in time is said in its unit', () => {
  const resp = delta(1 / 60, 2, { higherIsBetter: false, unit: hours });
  assert.equal(resp.text, '−2 h', 'first response: not "−100%"');
  assert.equal(resp.tone, 'good', 'faster is better');
  assert.equal(delta(19, 12, { unit: duration }).text, '+7s');
});

test('a rate over 100 per 100 visitors says the visits were under-counted', () => {
  assert.equal(per100(172.3), 'Visits under-counted');
  assert.equal(per100(172.3, 'Views'), 'Views under-counted');
  assert.equal(per100(4.46), '4.5');
  assert.equal(per100(100), '100');
  assert.equal(per100(null), 'No data');
  assert.equal(believable(172.3), false);
  assert.equal(believable(12), true);
  const dash = read('src/scripts/team/manager/dashboard.js');
  assert.match(dash, /label: 'Enquiries per 100 visitors', value: per100\(curRate\), delta: believable\(curRate\) && believable\(prevRate\)/, 'no change chip from an impossible rate');
  assert.match(read('src/scripts/team/insights.js'), /value: per100\(rate, 'Views'\), delta: believable\(rate\) && believable\(prevRate\)/);
  assert.match(read('src/scripts/team/manager/products.js'), /per100\(\(s\.inquiries \/ s\.clicks\) \* 100, 'Opens'\)/);
});

const lead = { id: 'a', name: 'Test Buyer', company: 'Buyer Trading Co', email: 'buyer@buyer-trading.example', phone: '+971 50 000 0000', product: 'Ethiopian Coffee', message: 'Destination port: Nhava Sheva\nQuantity: 1 FCL\nPlease quote.', createdAt: '2026-07-20T09:00:00Z', status: 'new' };

test('a lead score reads "Score 90" and lists why', () => {
  const sc = scoreOf(lead);
  assert.equal(scoreLabel(sc), `Score ${sc.score}`);
  const why = scoreReasons(sc);
  assert.equal(why.length, sc.checks.length);
  assert.ok(why.includes('+15 Company named'), why.join(' | '));
  assert.ok(why.some((r) => r.startsWith('0 ')), 'and what is missing, at 0');
  assert.match(BAND_KEY, /strong from 70, fair from 40, thin below 40/);
  const inbox = read('src/scripts/team/inbox.js');
  assert.match(inbox, /popovertarget: id/, 'the score in an enquiry opens its key');
  assert.match(inbox, /h\('p', \{ class: 't-score-pop-key' \}, BAND_KEY\)/);
  assert.match(inbox, /scoreLabel\(sc\), h\('span', \{ class: 'sr-only' \}, ` out of 100/, 'the list says "Score 40" too');
  assert.match(read('src/scripts/team/manager/pipeline.js'), /scoreLabel\(sc\)\)/);
  // as a control it takes the staff tools' button heights: 28 px, 44 px on touch screens
  const css = read('src/styles/team.css');
  assert.match(css, /\.t-score-btn \{ height: 28px;/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.t-score-btn \{ height: 44px; \} \}/);
});

test('a wide screen opens the oldest enquiry still waiting, not an empty pane', () => {
  const waiting = (l) => l.status === 'new' && !l.assignee;
  const list = [
    { id: 'newest', status: 'new', createdAt: '2026-10-10T00:00:00Z' },
    { id: 'taken', status: 'new', assignee: { id: 'u' }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'oldest', status: 'new', createdAt: '2026-07-20T00:00:00Z' },
    { id: 'won', status: 'won', createdAt: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(oldestWaiting(list, waiting), 'oldest');
  assert.equal(oldestWaiting(list.filter((l) => l.id === 'won'), waiting), null, 'nothing waiting: the pane stays as it is');
  assert.match(read('src/scripts/team/inbox.js'), /if \(!selectedId && !want && matchMedia\('\(min-width: 761px\)'\)\.matches\) \{\n {4}const first = oldestWaiting\(filtered\(\), waiting\);\n {4}if \(first\) select\(first, \{ push: false \}\);/, 'and a link to one enquiry (from a notification email) is never swapped for another');
});

test('on a phone the inbox starts with one line, and the tabs stay in one sideways row', () => {
  assert.match(read('src/components/team/views/Inbox.astro'), /<p class="t-phone-line" id="inboxGist"><\/p>/);
  const inbox = read('src/scripts/team/inbox.js');
  assert.match(inbox, /\$\('#inboxGist'\)\.textContent = toAccept\.length\n {4}\? `\$\{int\(toAccept\.length\)\} \$\{boss\(\) \? 'not handed out' : 'to accept'\}, oldest \$\{hours\(oldest\)\}/);
  const css = read('src/styles/team.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const phone = css.slice(css.indexOf('.t-phone-line { display: none; }'));
  assert.match(phone, /@media \(max-width: 760px\) \{\n {2}\.t-inbox-head \.t-summary \{ display: none; \}\n {2}\.t-phone-line \{ display: block;/);
  assert.match(phone, /\[data-view="inbox"\] \.t-toolbar \.a-seg \{ flex-wrap: nowrap; min-width: 0; max-width: 100%; overflow-x: auto;/);
  assert.match(phone, /\[data-view="inbox"\] \.t-toolbar \{ min-width: 0; \}/, 'the row scrolls inside the card, the card stays on screen');
});

// the manager dashboard's "Where enquiries wait": time in the current stage, not since arrival
test('time in a stage counts from the last move into it, and ages fall in their bands', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const day = 86400000;
  const at = (d) => new Date(now - d * day).toISOString();
  const leads = [
    { status: 'quoted', createdAt: at(40), history: [{ status: 'read', at: at(39) }, { status: 'quoted', at: at(10) }] },
    { status: 'quoted', createdAt: at(30), history: [{ status: 'quoted', at: at(2) }, { at: at(1), assignee: { id: 'tm_1' } }] },
    { status: 'new', createdAt: at(0.5) },
    { status: 'new', createdAt: at(5) },
    { status: 'won', createdAt: at(3) },
  ];
  assert.equal(stageSince(leads[0]), now - 10 * day, 'the move into Quoted, not the arrival');
  assert.equal(stageSince(leads[2]), now - 0.5 * day, 'never moved: since it arrived');
  assert.equal(stageSince(leads[1]), now - 2 * day, 'a later entry that is not a move (handing out) does not restart the clock');
  const w = Object.fromEntries(stageWaits(leads, now).map((r) => [r.id, r]));
  assert.equal(w.quoted.count, 2);
  assert.equal(w.quoted.medianDays, 6);
  assert.equal(w.quoted.oldestDays, 10);
  assert.equal(w.new.count, 2);
  assert.equal(w.contacted.count, 0);
  assert.equal(w.contacted.medianDays, null);
  assert.ok(!('won' in w), 'closed stages are not waiting');
  assert.deepEqual(ageBands(leads, now).map((b) => [b.label, b.count]), [['Over 4 weeks', 2], ['1 to 4 weeks', 0], ['1 to 7 days', 1], ['Under a day', 1]]);
});

test('recent moves: the newest move into a stage first, only within the day, at most five', () => {
  const now = Date.parse('2026-11-22T10:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
  // seven quotes moved in today (an hour apart), one moved in two days ago, one created quoted today
  const moved = Array.from({ length: 7 }, (_, k) => ({ id: `q${k}`, status: 'quoted', createdAt: hoursAgo(300), history: [{ status: 'quoted', at: hoursAgo(7 - k) }] }));
  const old = { id: 'old', status: 'quoted', createdAt: hoursAgo(300), history: [{ status: 'quoted', at: hoursAgo(48) }] };
  const created = { id: 'new', status: 'quoted', createdAt: hoursAgo(0.5) };
  const got = recentMoves([...moved, old, created], now).map((l) => l.id);
  assert.deepEqual(got, ['new', 'q6', 'q5', 'q4', 'q3'], 'the latest move leads, however many moved today');
  assert.ok(!got.includes('old'));
  assert.deepEqual(recentMoves([old], now), []);
  assert.equal(recentMoves(moved, now, { max: 2 }).length, 2);
});
