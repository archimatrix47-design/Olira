// Enquiries: an inbox (the list, and the chosen enquiry beside it, with
// everything needed to act on it) and a report of the pipeline for the period.
// Enquiry text comes from strangers, so it is only ever set as text.
import { $, $$, h, api, toast, confirmDialog, formatDate, timeAgo } from './api.js';
import { bundleTable, bundleCount, bundleText } from '../team/bundle-view.js';
import * as store from './store.js';
import { columns, barList, tableFor, empty } from './charts.js';
import { kpiCard, bucketsFor } from './widgets.js';
import { int, pct, hours, delta, NO_DATA } from './format.js';
import { confirmSelect } from './stage-control.js';
import { captureFocus, restoreFocus, scrollBehavior } from './motion.js';
import { arrowKeys, backButton } from './tools.js';
import { STAGES, stageLabel, lineOfLead, scoreOf, BAND_LABEL, firstResponseHours, median, RESPONSE_BUCKETS, inPeriod, ageHours } from './leads.js';

let all = [];
let bound = false;
let selectedId = null;
const view = () => $('[data-view="enquiries"]');
const LINE_LABEL = { agri: 'Agriculture', pack: 'Packaging' };
const OPEN = ['new', 'read', 'contacted', 'quoted'];
const tab = () => $('input[name="enTab"]:checked').value;
const line = () => $('input[name="leadLine"]:checked').value;

export async function refreshBadge() {
  try { setBadge((await store.inquiries()).inquiries || []); } catch (e) {}
}
function setBadge(list) {
  const n = list.filter((i) => i.status === 'new').length;
  const badge = $('#newCount');
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n || '');
  badge.setAttribute('aria-label', `${n} new`);
}

export async function show({ params } = {}) {
  if (!bound) {
    bound = true;
    ['#leadStage', '#leadSort', '#leadPeriodOnly'].forEach((s) => $(s).addEventListener('change', () => { renderInbox(); writeUrl(); }));
    $$('input[name="leadLine"]').forEach((r) => r.addEventListener('change', () => { renderInbox(); writeUrl(); }));
    $$('input[name="enTab"]').forEach((r) => r.addEventListener('change', () => { showTab(); writeUrl(); }));
    let t; $('#leadSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderInbox(); writeUrl(); }, 150); });
    $('#leadsRefresh').addEventListener('click', () => load(true));
    $('#leadsCsv').addEventListener('click', csv);
    arrowKeys($('#leads'), '.t-row', (id) => select(id));
  }
  store.periodSelect(view().querySelector('[data-period]'), () => { renderInsights(); renderInbox(); writeUrl(); });
  view().querySelector('[data-period]').value = String(store.getDays());
  // the tab, the business line and the enquiry live in the URL, so a view can be bookmarked
  const want = params?.get('tab');
  if (want === 'report' || want === 'inbox') $(`input[name="enTab"][value="${want}"]`).checked = true;
  const ln = params?.get('line');
  if (ln && $(`input[name="leadLine"][value="${CSS.escape(ln)}"]`)) $(`input[name="leadLine"][value="${CSS.escape(ln)}"]`).checked = true;
  showTab();
  await load();
  const lead = params?.get('lead');
  if (lead && all.some((i) => i.id === lead)) {
    // a link to one enquiry shows it even when the filters would hide it
    if (!filtered().some((i) => i.id === lead)) {
      $('#leadStage').value = 'all'; $('#leadSearch').value = ''; $('#leadPeriodOnly').checked = false;
      $('input[name="leadLine"][value="all"]').checked = true;
      renderInbox();
    }
    select(lead, { focus: true, push: true });
  }
}

function showTab() {
  for (const part of $$('[data-en-tab]')) part.hidden = part.dataset.enTab !== tab();
  // charts are drawn at their real width, so they are drawn once they can be measured
  if (tab() === 'report') renderInsights();
}

function writeUrl() {
  const p = new URLSearchParams({ days: String(store.getDays()) });
  if (tab() === 'report') p.set('tab', 'report');
  if (line() !== 'all') p.set('line', line());
  if (selectedId && tab() === 'inbox') p.set('lead', selectedId);
  history.replaceState(null, '', `#enquiries?${p}`);
}

async function load(force) {
  if (force) store.invalidate('inquiries');
  try {
    const d = await store.inquiries();
    all = Array.isArray(d?.inquiries) ? d.inquiries : [];
    setBadge(all);
    const focus = captureFocus();
    renderInsights();
    renderInbox();
    restoreFocus(focus);
    if (force) toast('Enquiries refreshed.');
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

/* ---------- insights ---------- */
function renderInsights() {
  if (tab() !== 'report') return;
  const days = store.getDays();
  const cur = inPeriod(all, days), prev = inPeriod(all, days, days);
  const won = cur.filter((l) => l.status === 'won').length, lost = cur.filter((l) => l.status === 'lost').length;
  const winRate = won + lost ? (won / (won + lost)) * 100 : null;
  const avg = (list) => (list.length ? list.reduce((n, l) => n + scoreOf(l).score, 0) / list.length : null);
  const avgScore = avg(cur), prevAvg = avg(prev);
  const resp = median(cur.map(firstResponseHours)), prevResp = median(prev.map(firstResponseHours));
  const open = all.filter((l) => OPEN.includes(l.status)).length;

  $('#enKpis').replaceChildren(
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), context: `Agriculture ${cur.filter((l) => lineOfLead(l) === 'agri').length}, packaging ${cur.filter((l) => lineOfLead(l) === 'pack').length}` }),
    kpiCard({ label: 'Open pipeline', value: int(open), context: `${all.filter((l) => l.status === 'new').length} new, ${all.filter((l) => l.status === 'quoted').length} quoted, across all time` }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: 'Arrival to first move out of New' }),
    kpiCard({ label: 'Win rate', value: winRate == null ? NO_DATA : pct(winRate, 0), context: won + lost ? `${won} won, ${lost} lost this period` : 'Mark enquiries Won or Lost to measure it' }),
    kpiCard({ label: 'Average lead score', value: avgScore == null ? NO_DATA : String(Math.round(avgScore)), delta: avgScore == null || prevAvg == null ? null : delta(avgScore, prevAvg), context: 'Out of 100, from the details buyers give' }),
  );

  // volume over time by business line
  const buckets = bucketsFor(days).map((b) => {
    const inB = all.filter((l) => { const t = Date.parse(l.createdAt); return t >= b.start && t < b.end; });
    return { label: b.label, values: [inB.filter((l) => lineOfLead(l) === 'agri').length, inB.filter((l) => lineOfLead(l) === 'pack').length] };
  });
  $('#enVolume').replaceChildren(cur.length
    ? h('div', {}, columns(buckets, { series: ['Agriculture', 'Packaging'], width: $('#enVolume').clientWidth, label: `Enquiries over time: ${cur.length} in this period` }),
      tableFor('Enquiries over time', ['Period', 'Agriculture', 'Packaging'], buckets.map((b) => [b.label, int(b.values[0]), int(b.values[1])])))
    : empty('No enquiries in this period.'));

  // pipeline
  const max = Math.max(1, ...STAGES.map((s) => cur.filter((l) => l.status === s.id).length));
  $('#enPipeline').replaceChildren(
    h('div', { class: 'v-bigstat' }, h('strong', {}, winRate == null ? NO_DATA : pct(winRate, 0)), h('span', {}, 'of closed enquiries were won')),
    cur.length ? h('ol', { class: 'v-pipe', 'aria-label': 'Enquiries by stage' }, STAGES.map((s) => {
      const n = cur.filter((l) => l.status === s.id).length;
      const b = h('b'); b.style.width = `${(n / max) * 100}%`;
      return h('li', { class: s.id === 'won' ? 'is-won' : s.open ? '' : 'is-closed' }, h('span', {}, s.label), h('i', { 'aria-hidden': 'true' }, b), h('span', {}, int(n)));
    })) : empty('No enquiries in this period.'));

  // response speed
  const answered = cur.map(firstResponseHours).filter((x) => x != null);
  const waiting = cur.filter((l) => l.status === 'new');
  const speedItems = [
    ...RESPONSE_BUCKETS.map((b) => ({ label: b.label, value: answered.filter(b.test).length })),
    { label: 'Still waiting in New', value: waiting.length, note: waiting.length ? `Oldest has waited ${hours(Math.max(...waiting.map(ageHours)))}` : null },
  ];
  $('#enSpeed').replaceChildren(
    cur.length ? barList(speedItems, { max: Math.max(1, ...speedItems.map((i) => i.value)) }) : empty('No enquiries in this period.'),
    h('p', { class: 'v-note' }, 'Studies of inbound sales leads find that a reply within the first hour makes a lead several times more likely to turn into business than a reply the next day.'),
    cur.length ? tableFor('Response speed', ['Time to first response', 'Enquiries'], speedItems.map((i) => [i.label, int(i.value)])) : h('span'));

  // lead quality
  const bands = { strong: 0, fair: 0, thin: 0 };
  const missing = {};
  cur.forEach((l) => {
    const sc = scoreOf(l); bands[sc.band]++;
    sc.checks.filter((c) => !c.ok).forEach((c) => { missing[c.gap] = (missing[c.gap] || 0) + 1; });
  });
  const gaps = Object.entries(missing).sort((x, y) => y[1] - x[1]).slice(0, 3);
  $('#enQuality').replaceChildren(
    cur.length ? barList([
      { label: 'Strong (70 and over)', value: bands.strong },
      { label: 'Fair (40 to 69)', value: bands.fair },
      { label: 'Thin (under 40)', value: bands.thin },
    ], { max: Math.max(1, cur.length) }) : empty('No enquiries in this period.'),
    gaps.length ? h('p', { class: 'v-note' }, `Most often missing: ${gaps.map(([k, n]) => `${k} (${n})`).join(', ')}. Asking for these in the first reply speeds up quoting.`) : h('span'));

  // markets and products
  const markets = {}, products = {}, ports = {};
  cur.forEach((l) => {
    const d = scoreOf(l).details;
    if (d.market) markets[d.market.name] = (markets[d.market.name] || 0) + 1;
    if (d.port) ports[d.port] = (ports[d.port] || 0) + 1;
    const p = l.product || 'Not specified'; products[p] = (products[p] || 0) + 1;
  });
  const top = (o, n = 5) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([label, value]) => ({ label, value }));
  $('#enMarkets').replaceChildren(
    h('h3', { class: 'a-label', style: 'margin-bottom:10px' }, 'Markets'),
    barList(top(markets), { emptyText: 'No phone codes or country email domains yet.' }),
    h('h3', { class: 'a-label', style: 'margin:16px 0 10px' }, 'Asked for'),
    barList(top(products), { tone: 'b', emptyText: 'No enquiries in this period.' }),
    Object.keys(ports).length ? h('p', { class: 'v-note' }, `Destination ports named: ${top(ports, 6).map((p) => `${p.label} (${p.value})`).join(', ')}.`) : h('span'));
}

/* ---------- inbox: the list ---------- */
function filtered() {
  const stage = $('#leadStage').value, ln = line(), sort = $('#leadSort').value;
  const q = $('#leadSearch').value.trim().toLowerCase();
  let list = $('#leadPeriodOnly').checked ? inPeriod(all, store.getDays()) : all.slice();
  list = list.filter((i) => (stage === 'all' || (stage === 'open' ? OPEN.includes(i.status) : i.status === stage))
    && (ln === 'all' || lineOfLead(i) === ln)
    && (!q || [i.name, i.company, i.email, i.phone, i.product, i.message, i.note, i.assignee?.name].some((v) => String(v || '').toLowerCase().includes(q))));
  if (sort === 'oldest') list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  else if (sort === 'score') list.sort((a, b) => scoreOf(b).score - scoreOf(a).score);
  else list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return list;
}

function renderInbox() {
  const list = filtered();
  $('#leadsSummary').textContent = `${list.length} of ${all.length} ${all.length === 1 ? 'enquiry' : 'enquiries'} shown.`;
  const ul = $('#leads');
  if (!list.length) {
    ul.replaceChildren(h('li', { class: 't-list-empty' }, h('strong', {}, all.length ? 'Nothing matches' : 'No enquiries yet'),
      all.length ? ($('#leadStage').value === 'open' ? 'Every enquiry is closed or archived. Choose All stages to see them.' : 'Try another stage, business line or search.') : 'When someone sends a form on the website, it appears here.'));
  } else {
    ul.replaceChildren(...list.map(row));
  }
  renderDetail();
}

function row(i) {
  const ln = lineOfLead(i), sc = scoreOf(i);
  const spoken = [
    [i.name || 'Unknown', i.company].filter(Boolean).join(', '),
    stageLabel(i.status), LINE_LABEL[ln],
    `Lead score ${sc.score}, ${BAND_LABEL[sc.band].toLowerCase()}`,
    i.emailed === false ? 'Notification email not delivered' : null,
    i.assignee ? `Handled by ${i.assignee.name}` : null,
    `Received ${timeAgo(i.createdAt)}`,
  ].filter(Boolean).join('. ');
  const btn = h('button', { type: 'button', class: 't-row', 'data-id': i.id, 'aria-label': spoken, 'aria-current': i.id === selectedId ? 'true' : null, onclick: (e) => select(i.id, { focus: true, push: true, event: e }) },
    h('span', { class: 't-row-top' },
      h('strong', {}, i.name || 'Unknown'),
      h('time', { datetime: i.createdAt, title: formatDate(i.createdAt) }, timeAgo(i.createdAt))),
    // the business line leads the second line; the list can also be filtered by it
    h('span', { class: 't-row-sub' }, h('b', { class: `t-line-${ln}` }, LINE_LABEL[ln]), [i.company, i.product && !/^(Agricultural products|Packaging)$/i.test(i.product) ? i.product : null, i.company ? null : i.email].filter(Boolean).map((x) => `, ${x}`).join('')),
    h('span', { class: 't-row-meta' },
      h('span', { class: `a-tag stage-${i.status}` }, stageLabel(i.status)),
      h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, String(sc.score), h('span', { class: 'sr-only' }, ` out of 100, ${BAND_LABEL[sc.band]}`)),
      i.emailed === false ? h('span', { class: 'a-tag warn' }, 'Email not delivered') : null,
      i.assignee ? h('span', { class: 't-owner' }, i.assignee.name) : null));
  return h('li', { class: i.status === 'new' ? 'is-new' : '', 'data-focus-scope': `row-${i.id}` }, btn);
}

function select(id, { focus, push, event } = {}) {
  selectedId = id;
  for (const b of $$('#leads .t-row')) { if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
  renderDetail();
  writeUrl();
  if (push) $('#enInbox').classList.add('is-detail');
  if (focus) {
    const hd = $('#enDetail h2');
    if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); }
    if (push && matchMedia('(max-width: 760px)').matches) scrollTo({ top: 0, behavior: scrollBehavior(event) });
  }
}
function back() {
  $('#enInbox').classList.remove('is-detail');
  const rowBtn = $(`#leads .t-row[data-id="${CSS.escape(selectedId || '')}"]`);
  if (rowBtn) { rowBtn.focus({ preventScroll: true }); rowBtn.scrollIntoView({ block: 'center' }); }
}

/* ---------- inbox: the chosen enquiry ---------- */
const fact = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
const section = (title, ...children) => h('section', { class: 't-section', 'aria-label': title }, h('h3', {}, title), ...children);

function renderDetail() {
  const box = $('#enDetail');
  const i = all.find((x) => x.id === selectedId);
  if (!i) {
    selectedId = null;
    delete box.dataset.lead;
    $('#enInbox').classList.remove('is-detail');
    box.replaceChildren(h('div', { class: 'a-empty' }, h('strong', {}, 'Choose an enquiry'), 'Its message, the buyer’s details and the reply buttons open here. Arrow keys move through the list.'));
    return;
  }
  // keep a note that is being typed when the enquiry re-renders after an action
  const typing = box.dataset.lead === i.id ? box.querySelector('[data-note]')?.value : null;
  box.dataset.lead = i.id;
  const ln = lineOfLead(i), sc = scoreOf(i), d = sc.details;
  const who = i.name || 'this enquiry';
  const digits = String(i.phone || '').replace(/[^\d+]/g, '');
  const subject = `Your ${ln === 'pack' ? 'packaging' : 'Olira'} enquiry`;
  const quoted = String(i.message || '').split('\n').map((l) => `> ${l}`).join('\n');
  const mail = `mailto:${encodeURIComponent(i.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Dear ${i.name || ''},\n\nThank you for your enquiry.\n\n\n\n${quoted}`)}`;
  const resp = firstResponseHours(i);

  const stage = confirmSelect({ options: STAGES.map((s) => [s.id, s.label]), value: i.status, label: `Stage for ${who}`, onConfirm: (v) => update(i, { status: v }, `Moved to ${stageLabel(v)}.`) });
  const note = h('textarea', { class: 'input', maxlength: '2000', 'data-note': '', 'aria-label': `Private note about ${who}`, placeholder: 'Private note, for example the price quoted or the next step' });
  note.value = typing ?? i.note ?? '';
  const saveNote = h('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Save note');
  saveNote.addEventListener('click', () => update(i, { note: note.value }, 'Note saved.'));
  const chips = [
    d.market ? ['Market', d.market.name] : null,
    d.port ? ['Port', d.port] : null,
    d.volume ? ['Volume', d.volume] : null,
    d.domain ? ['Email', d.freeMail ? 'personal address' : d.domain] : null,
  ].filter(Boolean);
  const history = (i.history || []).slice().reverse();
  const replies = (i.activity || []).filter((a) => a.type === 'reply').length;

  box.replaceChildren(...[
    backButton('Enquiries', back),
    h('header', { class: 't-detail-head', 'data-focus-scope': `head-${i.id}` },
      h('div', {}, h('h2', {}, i.name || 'Unknown'), h('p', {}, [i.company, i.email].filter(Boolean).join(', '))),
      h('div', { class: 'a-lead-meta' },
        h('span', { class: `a-tag ${ln}` }, LINE_LABEL[ln]),
        h('span', { class: `a-tag stage-${i.status}` }, stageLabel(i.status)),
        h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, String(sc.score), h('span', { class: 'sr-only' }, ` out of 100, ${BAND_LABEL[sc.band]}`)),
        i.emailed === false ? h('span', { class: 'a-tag warn', title: 'The notification email to your team failed. Reply from here.' }, 'Email not delivered') : null)),
    h('div', { class: 't-actionbar', 'data-focus-scope': `act-${i.id}` },
      i.email ? h('a', { class: 'btn btn-primary btn-sm', href: mail }, `Reply to ${i.email}`) : null,
      digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `tel:${digits}` }, `Call ${i.phone}`) : null,
      digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `https://wa.me/${digits.replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      h('div', { class: 't-stage' }, h('label', { class: 'a-stage' }, 'Stage', stage.select), stage.button)),
    section('Message',
      i.product && !/^(Agricultural products|Packaging)$/.test(i.product) ? h('p', { class: 'a-note' }, 'About: ', h('strong', { style: 'color:var(--ink)' }, i.product)) : null,
      // the port and quantity lines added by the form are shown as chips below
      h('p', { class: 'a-lead-msg' }, String(i.message || '').replace(/^(Destination port|Quantity):.*\n?/gim, '').trim() || i.message || 'No message.'),
      chips.length ? h('div', { class: 'a-chips' }, chips.map(([k, v]) => h('span', { class: 'a-chip' }, h('b', {}, k), v))) : null),
    bundleCount(i) ? section('Packing list', bundleTable(i)) : null,
    section('Buyer', h('dl', { class: 't-facts' },
      fact('Email', i.email ? h('a', { href: `mailto:${i.email}` }, i.email) : 'Not given'),
      fact('Phone', i.phone || 'Not given'),
      fact('Received', `${formatDate(i.createdAt)}, ${timeAgo(i.createdAt)}`),
      fact('First response', resp != null ? `After ${hours(resp)}` : i.status === 'new' ? `Waiting ${hours(ageHours(i))}` : 'Not recorded'),
      fact('Handled by', i.assignee ? i.assignee.name : 'Nobody yet'),
      replies ? fact('Replies from the workspace', String(replies)) : null),
      h('details', { class: 't-why' },
        h('summary', {}, `Why this scores ${sc.score}`),
        h('ul', { class: 'a-why' }, sc.checks.map((c) => h('li', { class: c.ok ? '' : 'miss' }, h('span', { class: 'pts' }, c.ok ? `+${c.pts}` : '0'), c.label))),
        h('p', { class: 'v-note' }, 'A guide from what the buyer wrote, not a verdict. A short enquiry from a known importer can still be the best lead of the month.'))),
    section('Private note', h('div', { class: 'a-note-form', 'data-focus-scope': `note-${i.id}` }, note,
      h('div', { class: 'row', style: '--gap:8px;flex-wrap:wrap' }, saveNote, i.noteAt ? h('span', { class: 'a-note' }, `Saved ${timeAgo(i.noteAt)}`) : null))),
    section('History', h('ol', { class: 'a-history' }, history.map((x) => h('li', {}, `${stageLabel(x.status)}, ${formatDate(x.at)}`)), h('li', {}, `Arrived, ${formatDate(i.createdAt)}`))),
    h('div', { class: 't-section', 'data-focus-scope': `foot-${i.id}` },
      h('div', { class: 'row', style: '--gap:8px;flex-wrap:wrap;justify-content:space-between' },
        h('a', { class: 'btn btn-secondary btn-sm', href: `/team/${ln === 'pack' ? 'packaging' : 'agriculture'}/#inbox?lead=${encodeURIComponent(i.id)}` }, 'Open in the workspace'),
        h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', onclick: () => remove(i) }, 'Delete enquiry'))),
  ].filter(Boolean));
}

async function update(i, body, ok) {
  try {
    const r = await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'POST', body });
    Object.assign(i, r.inquiry || body);
    store.invalidate('inquiries');
    const focus = captureFocus();
    if (body.note !== undefined) delete $('#enDetail').dataset.lead; // the saved note replaces what was typed
    setBadge(all);
    renderInsights();
    renderInbox();
    restoreFocus(focus);
    toast(ok);
  } catch (e) { toast(e.message, 'error'); }
}

async function remove(i) {
  const ok = await confirmDialog({ title: 'Delete this enquiry?', body: `The enquiry from ${i.name || 'this visitor'} is removed for good. Mark it Lost or Archived instead if you may need it later.` });
  if (!ok) return;
  try {
    await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'DELETE' });
    // the next enquiry in the list takes its place, as in Mail
    const ids = $$('#leads .t-row').map((b) => b.dataset.id);
    const at = ids.indexOf(i.id);
    all = all.filter((x) => x.id !== i.id);
    selectedId = ids[at + 1] || ids[at - 1] || null;
    store.invalidate('inquiries');
    setBadge(all); renderInsights(); renderInbox(); writeUrl();
    const next = selectedId && $(`#leads .t-row[data-id="${CSS.escape(selectedId)}"]`);
    (next || $('#leadSearch')).focus({ preventScroll: true });
    toast('Enquiry deleted.');
  } catch (e) { toast(e.message, 'error'); }
}

function csv() {
  const rows = filtered();
  if (!rows.length) return toast('There are no enquiries in this view to download.', 'error');
  const cols = [['createdAt', 'Date'], ['status', 'Stage'], ['line', 'Business line'], ['product', 'Product'], ['score', 'Lead score'], ['market', 'Market'], ['port', 'Destination port'], ['volume', 'Volume'], ['firstResponse', 'First response (hours)'], ['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['message', 'Message'], ['note', 'Private note'], ['emailed', 'Notification emailed'], ['bundle', 'Packing list']];
  // quote every cell, and neutralise a leading = + - @ so spreadsheets never run it as a formula
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const value = (r, k) => {
    const sc = scoreOf(r);
    if (k === 'line') return LINE_LABEL[lineOfLead(r)];
    if (k === 'status') return stageLabel(r.status);
    if (k === 'score') return sc.score;
    if (k === 'market') return sc.details.market?.name || '';
    if (k === 'port') return sc.details.port || '';
    if (k === 'volume') return sc.details.volume || '';
    if (k === 'bundle') return bundleText(r);
    if (k === 'firstResponse') { const x = firstResponseHours(r); return x == null ? '' : x.toFixed(1); }
    return r[k];
  };
  const text = [cols.map((c) => cell(c[1])).join(','), ...rows.map((r) => cols.map(([k]) => cell(value(r, k))).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `olira-enquiries-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
