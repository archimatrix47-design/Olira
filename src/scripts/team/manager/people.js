// Manager's team performance: for each person on the marketing teams, what
// they hold now and how the enquiries of the period went: first response,
// replies and calls, quotes, wins and losses. Enquiries count in the period
// they arrived; work (replies, quotes) counts in the period it was done.
import { $, h, toast, timeAgo } from '../../admin/api.js';
import * as store from '../../admin/store.js';
import { barList, empty } from '../../admin/charts.js';
import { kpiCard } from '../../admin/widgets.js';
import { int, pct, hours, NO_DATA } from '../../admin/format.js';
import { firstResponseHours, median, inPeriod } from '../../admin/leads.js';
import { session, leads, followupsOf, OPEN, LINE_LABEL } from '../session.js';
import { money } from './pipeline.js';

const view = () => $('[data-view="people"]');
const CONTACT = new Set(['call', 'whatsapp', 'email', 'meeting']);
let all = [];

export async function show() {
  store.periodSelect(view().querySelector('[data-period]'), () => render());
  view().querySelector('[data-period]').value = String(store.getDays());
  view().setAttribute('aria-busy', 'true');
  try {
    all = await leads(true);
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { view().removeAttribute('aria-busy'); }
}

/** When the enquiry reached its current closed stage. */
const closedAt = (l) => Date.parse((l.history || []).filter((x) => x.status === l.status).at(-1)?.at || l.createdAt);

function statsFor(m, days) {
  const since = Date.now() - days * 86400000;
  const held = all.filter((l) => l.assignee?.id === m.id);
  const arrived = inPeriod(held, days);
  const acts = all.flatMap((l) => (l.activity || []).filter((a) => a.by?.id === m.id && Date.parse(a.at) >= since));
  const quotes = all.flatMap((l) => (l.quotes || []).filter((q) => q.by?.id === m.id && Date.parse(q.at) >= since));
  const won = held.filter((l) => l.status === 'won' && closedAt(l) >= since);
  const lost = held.filter((l) => l.status === 'lost' && closedAt(l) >= since);
  return {
    m,
    open: held.filter((l) => OPEN.includes(l.status)).length,
    overdue: followupsOf(all).filter((d) => d.lead.assignee?.id === m.id).length,
    taken: arrived.length,
    response: median(arrived.map(firstResponseHours)),
    replies: acts.filter((a) => a.type === 'reply').length,
    contacts: acts.filter((a) => CONTACT.has(a.type)).length,
    quotes: quotes.length,
    quoteValue: money(quotes.map((q) => ({ quote: q }))),
    won, lost,
    winRate: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null,
    lastActive: acts.map((a) => a.at).sort().at(-1) || null,
  };
}

function render() {
  const days = store.getDays();
  const people = session.members.filter((m) => m.role === 'agri' || m.role === 'pack');
  const rows = people.map((m) => statsFor(m, days)).sort((a, b) => a.m.role.localeCompare(b.m.role) || b.open - a.open || a.m.name.localeCompare(b.m.name));
  const cur = inPeriod(all, days);
  const loose = all.filter((l) => !l.assignee && OPEN.includes(l.status)).length;
  const resp = median(cur.map(firstResponseHours));
  const won = rows.reduce((n, r) => n + r.won.length, 0), lost = rows.reduce((n, r) => n + r.lost.length, 0);

  $('#peopleKpis').replaceChildren(
    kpiCard({ label: 'People on the teams', value: int(people.length), context: `${people.filter((m) => m.role === 'agri').length} agriculture, ${people.filter((m) => m.role === 'pack').length} packaging` }),
    kpiCard({ label: 'Not handed out', value: int(loose), context: loose ? 'Open enquiries nobody holds' : 'Every open enquiry has someone on it' }),
    kpiCard({ label: 'Team first response', value: resp == null ? NO_DATA : hours(resp), context: 'Median, enquiries of this period' }),
    kpiCard({ label: 'Win rate', value: won + lost ? pct((won / (won + lost)) * 100, 0) : NO_DATA, context: won + lost ? `${won} won, ${lost} lost this period` : 'Nothing closed this period' }),
  );

  const table = $('#peopleTable');
  if (!rows.length) {
    table.replaceChildren(empty('No one is on the marketing teams yet. The site administrator adds them under Staff accounts.'));
  } else {
    const cols = ['Person', 'Open now', 'Overdue', 'Taken this period', 'First response', 'Replies and calls', 'Quotes', 'Won', 'Win rate', 'Last active'];
    table.replaceChildren(h('table', { class: 'a-table t-people' },
      h('caption', { class: 'sr-only' }, 'Team performance for the period'),
      h('thead', {}, h('tr', {}, cols.map((t, i) => h('th', { scope: 'col', class: i && i < 9 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: 't-person' }, h('a', { href: `#inbox?filter=open&owner=${encodeURIComponent(r.m.id)}` }, r.m.name), h('span', { class: `a-tag ${r.m.role}` }, LINE_LABEL[r.m.role]))),
        h('td', { class: 'num' }, int(r.open)),
        h('td', { class: 'num' }, r.overdue ? h('span', { class: 'a-tag warn' }, int(r.overdue)) : '0'),
        h('td', { class: 'num' }, int(r.taken)),
        h('td', { class: 'num' }, r.response == null ? NO_DATA : hours(r.response)),
        h('td', { class: 'num' }, `${int(r.replies)} / ${int(r.contacts)}`),
        h('td', { class: 'num' }, int(r.quotes), r.quoteValue ? h('small', {}, r.quoteValue) : null),
        h('td', { class: 'num' }, int(r.won.length)),
        h('td', { class: 'num' }, r.winRate == null ? NO_DATA : pct(r.winRate, 0)),
        h('td', {}, r.lastActive ? timeAgo(r.lastActive) : 'Not in this period'))))),
    h('p', { class: 'v-note' }, 'Replies are emails sent from the workspace; calls include WhatsApp, meetings and emails from their own mailbox that they logged.'));
  }

  $('#peopleLoad').replaceChildren(rows.length
    ? barList([...rows.map((r) => ({ label: r.m.name, value: r.open, note: r.overdue ? `${r.overdue} overdue` : null })), ...(loose ? [{ label: 'Not handed out', value: loose }] : [])].sort((a, b) => b.value - a.value), { emptyText: 'Nothing open.' })
    : empty('No one on the teams yet.'));
  const winners = rows.filter((r) => r.won.length).map((r) => ({ label: r.m.name, value: r.won.length, display: `${int(r.won.length)}${money(r.won) ? `, ${money(r.won)}` : ''}` }));
  $('#peopleWon').replaceChildren(winners.length ? barList(winners, { tone: 'b' }) : empty('Nothing marked Won in this period.'));
}
