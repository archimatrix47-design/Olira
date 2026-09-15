// Follow-ups (what is waiting on the team) and Quotes (every saved quote).
import { $, h, toast, formatDate, timeAgo } from '../admin/api.js';
import { hours } from '../admin/format.js';
import { session, leads, followupsOf, isMine, stageName } from './session.js';
import { printQuote } from './quote.js';

// the same 400ms rule as the inbox: a skeleton only when the wait is noticeable
function whileLoading(box, rows) {
  box.setAttribute('aria-busy', 'true');
  const t = setTimeout(() => box.replaceChildren(...Array.from({ length: rows }, () => h('div', { class: 't-skel-row', 'aria-hidden': 'true' }, h('span', { class: 't-skel' }), h('span', { class: 't-skel' })))), 400);
  return () => { clearTimeout(t); box.removeAttribute('aria-busy'); };
}
const leadLink = (l, text = 'Open') => h('a', { class: 'btn btn-secondary btn-sm', href: `#inbox?lead=${encodeURIComponent(l.id)}` }, text);

export async function showFollowups() {
  const box = $('#followupList');
  const done = whileLoading(box, 4);
  try {
    const all = await leads(true);
    done();
    const due = followupsOf(all);
    if (!due.length) {
      box.replaceChildren(h('div', { class: 'a-card a-empty' }, h('strong', {}, 'Nothing is waiting on you'), 'New enquiries, quiet buyers and quotes that need a nudge will appear here.'));
      return;
    }
    const groups = [
      ['accept', 'Waiting to be accepted', 'Over 4 hours old and nobody has taken them.'],
      ['contact', 'Accepted, not contacted yet', 'Accepted more than a day ago with no reply, call or message logged.'],
      ['quote', 'Quotes to follow up', 'Quoted more than 5 days ago with nothing since.'],
      ['quiet', 'Gone quiet', 'Contacted, then nothing for a week.'],
    ];
    box.replaceChildren(...groups.map(([kind, title, note]) => {
      const items = due.filter((d) => d.kind === kind);
      if (!items.length) return null;
      return h('section', { class: 'a-card t-follow-group', 'aria-labelledby': `fu-${kind}` },
        h('div', { class: 'a-card-head' }, h('div', {}, h('h2', { id: `fu-${kind}` }, `${title} (${items.length})`), h('p', {}, note))),
        h('ul', { class: 'a-rows' }, items.map(({ lead: l, due: at }) => h('li', {},
          h('div', { class: 'grow' },
            h('strong', {}, `${l.name || 'Unknown'}${l.company ? `, ${l.company}` : ''}`),
            h('span', {}, `${stageName(l.status)}${l.assignee ? `, ${isMine(l) ? 'yours' : l.assignee.name}` : ''}. Arrived ${timeAgo(l.createdAt)}. Due ${hours((Date.now() - at) / 3600000)} ago.`)),
          leadLink(l)))));
    }).filter(Boolean));
  } catch (e) { done(); if (e.status !== 401) toast(e.message, 'error'); }
}

export async function showQuotes() {
  const box = $('#quoteTable');
  const done = whileLoading(box, 5);
  try {
    const all = await leads(true);
    done();
    const rows = [];
    for (const l of all) for (const q of l.quotes || (l.quote ? [l.quote] : [])) rows.push({ l, q, current: l.quote?.number === q.number && l.quote?.at === q.at });
    rows.sort((a, b) => Date.parse(b.q.at) - Date.parse(a.q.at));
    if (!rows.length) { box.replaceChildren(h('div', { class: 'a-empty' }, h('strong', {}, 'No quotes yet'), 'Build a quote on an enquiry in the Inbox. It appears here once saved.')); return; }
    const money = (q) => `${q.currency} ${Number(q.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    box.replaceChildren(h('table', { class: 'a-table t-quotes' },
      h('caption', { class: 'sr-only' }, 'Quotes'),
      h('thead', {}, h('tr', {}, ['Quote', 'Buyer', 'Total', 'Saved', 'Enquiry stage', ''].map((t, i) => h('th', { scope: 'col', class: i === 2 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map(({ l, q, current }) => h('tr', {},
        h('th', { scope: 'row' }, q.number, current ? null : h('span', { class: 'flag info' }, 'Earlier version')),
        h('td', {}, `${l.name || 'Unknown'}${l.company ? `, ${l.company}` : ''}`),
        h('td', { class: 'num' }, money(q)),
        h('td', {}, h('time', { datetime: q.at, title: formatDate(q.at) }, `${timeAgo(q.at)}${q.by ? `, ${q.by.name}` : ''}`)),
        h('td', {}, stageName(l.status)),
        h('td', { class: 't-quote-actions' }, leadLink(l), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Print quote ${q.number}`, onclick: () => printQuote(l, q) }, 'Print'))))),
    ));
  } catch (e) { done(); if (e.status !== 401) toast(e.message, 'error'); }
}

export { session };
