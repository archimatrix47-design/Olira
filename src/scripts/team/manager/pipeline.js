// Manager's pipeline: every open enquiry as a card in its stage, with the value
// of the quotes in each stage, and what was won or lost in the last 30 days.
// A card opens the enquiry in Enquiries, where it is worked; its stage can also
// be changed on the card, with the same confirm step as the enquiry screen. The
// board scrolls sideways on narrow screens, with a fade on the side that has more.
import { $, $$, h, api, toast, formatDate, timeAgo } from '../../admin/api.js';
import { scoreOf, BAND_LABEL, STAGES, stageLabel } from '../../admin/leads.js';
import { int } from '../../admin/format.js';
import { confirmSelect } from '../../admin/stage-control.js';
import { leads, putLead, followupsOf, lineOf, LINE_LABEL, teamOf } from '../session.js';

const COLUMNS = [
  { id: 'new', label: 'New', note: 'Arrived, nobody on it yet' },
  { id: 'read', label: 'Accepted', note: 'Someone has it, no contact yet' },
  { id: 'contacted', label: 'Contacted', note: 'In conversation' },
  { id: 'quoted', label: 'Quoted', note: 'Waiting on the buyer' },
  { id: 'won', label: 'Won', note: 'Last 30 days', closed: true },
  { id: 'lost', label: 'Lost', note: 'Last 30 days', closed: true },
];
const SHOWN = 25;
const MONTH = 30 * 86400000;
let bound = false;
let all = [];

export async function show({ params } = {}) {
  if (!bound) {
    bound = true;
    $$('input[name="pipeLine"]').forEach((r) => r.addEventListener('change', () => { render(); writeUrl(); }));
    $('#pipeOwner').addEventListener('change', () => { render(); writeUrl(); });
    const group = (line) => { const p = teamOf(line); return p.length ? h('optgroup', { label: LINE_LABEL[line] }, p.map((m) => h('option', { value: m.id }, m.name))) : null; };
    $('#pipeOwner').replaceChildren(h('option', { value: '' }, 'Anyone'), h('option', { value: 'none' }, 'Nobody yet'), ...[group('agri'), group('pack')].filter(Boolean));
    const board = $('#pipeBoard');
    board.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(board);
  }
  const ln = params?.get('line'), owner = params?.get('owner');
  $(`input[name="pipeLine"][value="${ln === 'agri' || ln === 'pack' ? ln : 'all'}"]`).checked = true;
  $('#pipeOwner').value = owner && $(`#pipeOwner option[value="${CSS.escape(owner)}"]`) ? owner : '';
  const board = $('#pipeBoard');
  board.setAttribute('aria-busy', 'true');
  try {
    all = await leads(true);
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { board.removeAttribute('aria-busy'); }
}

function writeUrl() {
  const p = new URLSearchParams();
  const ln = $('input[name="pipeLine"]:checked').value, owner = $('#pipeOwner').value;
  if (ln !== 'all') p.set('line', ln);
  if (owner) p.set('owner', owner);
  history.replaceState(null, '', `#pipeline${p.toString() ? `?${p}` : ''}`);
}

/** Quote totals by currency, as "USD 92,500 and ETB 1,200,000". */
export function money(list) {
  const sums = {};
  for (const l of list) if (l.quote?.total) sums[l.quote.currency] = (sums[l.quote.currency] || 0) + Number(l.quote.total);
  const parts = Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${Math.round(n).toLocaleString('en-US')}`);
  return parts.length ? parts.join(' and ') : '';
}
const closedAt = (l) => Date.parse((l.history || []).filter((x) => x.status === l.status).at(-1)?.at || l.createdAt);
const age = (l) => {
  const d = (Date.now() - Date.parse(l.createdAt)) / 86400000;
  return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${Math.round(d)} d`;
};

function render() {
  const ln = $('input[name="pipeLine"]:checked').value, owner = $('#pipeOwner').value;
  const list = all.filter((l) => (ln === 'all' || lineOf(l) === ln) && (!owner || (owner === 'none' ? !l.assignee : l.assignee?.id === owner)));
  const overdue = new Set(followupsOf(list).map((d) => d.lead.id));
  const now = Date.now();
  const cols = COLUMNS.map((c) => ({
    ...c,
    items: list.filter((l) => l.status === c.id && (!c.closed || now - closedAt(l) < MONTH))
      // overdue first, then the oldest: what has waited longest is most at risk
      .sort((a, b) => (overdue.has(b.id) - overdue.has(a.id)) || Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  }));
  const open = cols.filter((c) => !c.closed).reduce((n, c) => n + c.items.length, 0);
  const openValue = money(cols.find((c) => c.id === 'quoted').items);
  $('#pipeSummary').replaceChildren(
    h('span', {}, h('strong', {}, int(open)), ' open'),
    h('span', {}, h('strong', {}, int(overdue.size)), ' overdue'),
    openValue ? h('span', {}, 'Quoted and waiting: ', h('strong', {}, openValue)) : null);

  $('#pipeBoard').replaceChildren(...cols.map((c) => {
    const value = ['quoted', 'won'].includes(c.id) ? money(c.items) : '';
    const more = c.items.length - SHOWN;
    return h('section', { class: `t-col t-col-${c.id}`, 'aria-labelledby': `pipe-${c.id}` },
      h('header', {},
        h('h2', { id: `pipe-${c.id}` }, c.label, h('b', {}, int(c.items.length))),
        h('p', {}, value || c.note)),
      c.items.length
        ? h('ul', {}, c.items.slice(0, SHOWN).map((l) => card(l, overdue.has(l.id))))
        : h('p', { class: 't-col-empty' }, 'None'),
      more > 0 ? h('a', { class: 'btn btn-ghost btn-sm', href: `#inbox?filter=${c.closed ? 'closed' : 'open'}${ln !== 'all' ? `&line=${ln}` : ''}` }, `${more} more in Enquiries`) : null);
  }));
  edges();
}

/** Mark the sides of the board that have more columns beyond them (a fade in team.css). */
function edges() {
  const b = $('#pipeBoard');
  if (!b) return;
  const max = b.scrollWidth - b.clientWidth;
  b.toggleAttribute('data-more-left', b.scrollLeft > 4);
  b.toggleAttribute('data-more-right', max - b.scrollLeft > 4);
}

/** Change a card's stage; the server writes it into the enquiry's history. */
async function move(l, status) {
  try {
    const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}`, { method: 'POST', body: { status } });
    putLead(r.inquiry);
    const i = all.findIndex((x) => x.id === l.id);
    if (i >= 0) all[i] = r.inquiry;
    render();
    const msg = `${l.name || 'The enquiry'} moved to ${stageLabel(status)}.`;
    toast(msg); // the toast stack is a live region: screen readers hear it once
    // keep the keyboard where the card went (closed stages may hide it from the board)
    const card = $(`#pipeBoard [data-lead="${CSS.escape(l.id)}"] .t-card`);
    const target = card || $(`#pipe-${status}`);
    if (target) { if (!card) target.tabIndex = -1; target.focus(); }
  } catch (e) {
    toast(e.message, 'error');
    render();
  }
}

function card(l, late) {
  const sc = scoreOf(l);
  const who = l.name || 'Unknown';
  const spoken = [who, l.company, LINE_LABEL[lineOf(l)], l.assignee ? `held by ${l.assignee.name}` : 'not handed out',
    l.quote ? `quoted ${l.quote.currency} ${Number(l.quote.total).toLocaleString('en-US')}` : null, late ? 'follow-up overdue' : null,
    `arrived ${timeAgo(l.createdAt)}`].filter(Boolean).join(', ');
  const stage = confirmSelect({ options: STAGES.map((s) => [s.id, s.label]), value: l.status, label: `Stage for ${who}`, onConfirm: (v) => move(l, v) });
  return h('li', { class: 't-card-wrap', 'data-lead': l.id }, h('a', { class: `t-card${late ? ' is-late' : ''}`, href: `#inbox?lead=${encodeURIComponent(l.id)}`, 'aria-label': spoken },
    h('span', { class: 't-card-top' }, h('strong', {}, who), h('time', { datetime: l.createdAt, title: formatDate(l.createdAt) }, age(l))),
    l.company ? h('span', { class: 't-card-co' }, l.company) : null,
    h('span', { class: 't-card-meta' },
      h('span', { class: `a-tag ${lineOf(l)}` }, LINE_LABEL[lineOf(l)]),
      h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, String(sc.score)),
      l.quote ? h('span', { class: 't-card-money' }, `${l.quote.currency} ${Math.round(l.quote.total).toLocaleString('en-US')}`) : null),
    h('span', { class: 't-card-owner' }, l.assignee ? l.assignee.name : 'Not handed out', late ? h('em', {}, 'Overdue') : null)),
  h('div', { class: 't-card-stage' }, stage.select, stage.button));
}

