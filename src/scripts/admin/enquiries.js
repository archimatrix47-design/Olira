// Enquiries: pipeline analysis for the period, then the inbox where each lead
// is scored, read for market, volume and port, moved through the pipeline and
// annotated. Enquiry text comes from strangers, so it is only ever set as text.
import { $, h, api, toast, confirmDialog, formatDate, timeAgo } from './api.js';
import * as store from './store.js';
import { columns, barList, tableFor, empty } from './charts.js';
import { kpiCard, bucketsFor } from './widgets.js';
import { int, pct, hours, delta, NO_DATA } from './format.js';
import { STAGES, stageLabel, lineOf, scoreOf, BAND_LABEL, firstResponseHours, median, RESPONSE_BUCKETS, inPeriod, ageHours } from './leads.js';

let all = [];
let bound = false;
const view = () => $('[data-view="enquiries"]');
const LINE_LABEL = { agri: 'Agriculture', pack: 'Packaging' };
const OPEN = ['new', 'read', 'contacted', 'quoted'];

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

export async function show() {
  if (!bound) {
    bound = true;
    ['#leadStage', '#leadLine', '#leadSort', '#leadPeriodOnly'].forEach((s) => $(s).addEventListener('change', renderInbox));
    let t; $('#leadSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderInbox, 150); });
    $('#leadsRefresh').addEventListener('click', () => load(true));
    $('#leadsCsv').addEventListener('click', csv);
  }
  store.periodSelect(view().querySelector('[data-period]'), () => { renderInsights(); renderInbox(); });
  view().querySelector('[data-period]').value = String(store.getDays());
  await load();
}

async function load(force) {
  if (force) store.invalidate('inquiries');
  try {
    const d = await store.inquiries();
    all = Array.isArray(d?.inquiries) ? d.inquiries : [];
    setBadge(all);
    renderInsights();
    renderInbox();
    if (force) toast('Enquiries refreshed.');
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

/* ---------- insights ---------- */
function renderInsights() {
  const days = store.getDays();
  const cur = inPeriod(all, days), prev = inPeriod(all, days, days);
  const won = cur.filter((l) => l.status === 'won').length, lost = cur.filter((l) => l.status === 'lost').length;
  const winRate = won + lost ? (won / (won + lost)) * 100 : null;
  const avg = (list) => (list.length ? list.reduce((n, l) => n + scoreOf(l).score, 0) / list.length : null);
  const avgScore = avg(cur), prevAvg = avg(prev);
  const resp = median(cur.map(firstResponseHours)), prevResp = median(prev.map(firstResponseHours));
  const open = all.filter((l) => OPEN.includes(l.status)).length;

  $('#enKpis').replaceChildren(
    kpiCard({ label: 'Enquiries', value: int(cur.length), delta: delta(cur.length, prev.length), context: `Agriculture ${cur.filter((l) => lineOf(l.product) === 'agri').length}, packaging ${cur.filter((l) => lineOf(l.product) === 'pack').length}` }),
    kpiCard({ label: 'Open pipeline', value: int(open), context: `${all.filter((l) => l.status === 'new').length} new, ${all.filter((l) => l.status === 'quoted').length} quoted, across all time` }),
    kpiCard({ label: 'First response (median)', value: resp == null ? NO_DATA : hours(resp), delta: resp == null || prevResp == null ? null : delta(resp, prevResp, { higherIsBetter: false }), context: 'Arrival to first move out of New' }),
    kpiCard({ label: 'Win rate', value: winRate == null ? NO_DATA : pct(winRate, 0), context: won + lost ? `${won} won, ${lost} lost this period` : 'Mark enquiries Won or Lost to measure it' }),
    kpiCard({ label: 'Average lead score', value: avgScore == null ? NO_DATA : String(Math.round(avgScore)), delta: avgScore == null || prevAvg == null ? null : delta(avgScore, prevAvg), context: 'Out of 100, from the details buyers give' }),
  );

  // volume over time by business line
  const buckets = bucketsFor(days).map((b) => {
    const inB = all.filter((l) => { const t = Date.parse(l.createdAt); return t >= b.start && t < b.end; });
    return { label: b.label, values: [inB.filter((l) => lineOf(l.product) === 'agri').length, inB.filter((l) => lineOf(l.product) === 'pack').length] };
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

/* ---------- inbox ---------- */
function filtered() {
  const stage = $('#leadStage').value, line = $('#leadLine').value, sort = $('#leadSort').value;
  const q = $('#leadSearch').value.trim().toLowerCase();
  let list = $('#leadPeriodOnly').checked ? inPeriod(all, store.getDays()) : all.slice();
  list = list.filter((i) => (stage === 'all' || (stage === 'open' ? OPEN.includes(i.status) : i.status === stage))
    && (line === 'all' || lineOf(i.product) === line)
    && (!q || [i.name, i.company, i.email, i.phone, i.product, i.message, i.note].some((v) => String(v || '').toLowerCase().includes(q))));
  if (sort === 'oldest') list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  else if (sort === 'score') list.sort((a, b) => scoreOf(b).score - scoreOf(a).score);
  else list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return list;
}

function renderInbox() {
  const list = filtered();
  $('#leadsSummary').textContent = `${list.length} of ${all.length} ${all.length === 1 ? 'enquiry' : 'enquiries'} shown.`;
  const el = $('#leads');
  if (!list.length) {
    el.replaceChildren(h('div', { class: 'a-card a-empty' }, h('strong', {}, all.length ? 'Nothing matches' : 'No enquiries yet'),
      all.length ? ($('#leadStage').value === 'open' ? 'Every enquiry is closed or archived. Choose All stages to see them.' : 'Try another stage, business line or search.') : 'When someone sends a form on the website, it appears here.'));
    return;
  }
  el.replaceChildren(...list.map(card));
}

function card(i) {
  const line = lineOf(i.product);
  const sc = scoreOf(i), d = sc.details;
  const digits = String(i.phone || '').replace(/[^\d+]/g, '');
  const subject = `Your ${line === 'pack' ? 'packaging' : 'Olira'} enquiry`;
  const quoted = String(i.message || '').split('\n').map((l) => `> ${l}`).join('\n');
  const mail = `mailto:${encodeURIComponent(i.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Dear ${i.name || ''},\n\nThank you for your enquiry.\n\n\n\n${quoted}`)}`;
  const resp = firstResponseHours(i);
  const who = i.name || 'this enquiry';

  const stageSel = h('select', { class: 'input', 'aria-label': `Stage for ${who}` }, STAGES.map((s) => h('option', { value: s.id, selected: s.id === i.status || null }, s.label)));
  stageSel.addEventListener('change', () => update(i, { status: stageSel.value }, `Moved to ${stageLabel(stageSel.value)}.`));
  const note = h('textarea', { class: 'input', maxlength: '2000', 'aria-label': `Private note about ${who}`, placeholder: 'Private note, for example the price quoted or the next step' });
  note.value = i.note || '';
  const saveNote = h('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Save note');
  saveNote.addEventListener('click', () => update(i, { note: note.value }, 'Note saved.'));

  const chips = [
    d.market ? ['Market', d.market.name] : null,
    d.port ? ['Port', d.port] : null,
    d.volume ? ['Volume', d.volume] : null,
    d.domain ? ['Email', d.freeMail ? 'personal address' : d.domain] : null,
  ].filter(Boolean);
  const history = (i.history || []).slice().reverse();

  return h('article', { class: `a-card a-lead${i.status === 'new' ? ' is-new' : ''}`, 'aria-label': `Enquiry from ${i.name || 'unknown'}` },
    h('div', { class: 'a-lead-head' },
      h('h3', {}, i.name || 'Unknown', i.company ? h('small', {}, i.company) : null),
      h('div', { class: 'a-lead-meta' },
        h('span', { class: `a-tag ${line}` }, LINE_LABEL[line]),
        h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, String(sc.score), h('span', { class: 'sr-only' }, ` out of 100, ${BAND_LABEL[sc.band]}`)),
        i.emailed === false ? h('span', { class: 'a-tag warn', title: 'The notification email to your team failed. Reply from here.' }, 'Email not delivered') : null,
        h('time', { datetime: i.createdAt, title: formatDate(i.createdAt) }, timeAgo(i.createdAt)))),
    h('div', { class: 'a-lead-grid' },
      h('div', { style: 'display:grid;gap:12px' },
        i.product && !/^(Agricultural products|Packaging)$/.test(i.product) ? h('p', { class: 'a-note' }, 'About: ', h('strong', { style: 'color:var(--ink)' }, i.product)) : null,
        // the port and quantity lines added by the form are shown as chips below
        h('p', { class: 'a-lead-msg' }, String(i.message || '').replace(/^(Destination port|Quantity):.*\n?/gim, '').trim() || i.message || ''),
        chips.length ? h('div', { class: 'a-chips' }, chips.map(([k, v]) => h('span', { class: 'a-chip' }, h('b', {}, k), v))) : null,
        h('div', { class: 'a-lead-contact' },
          i.email ? h('a', { class: 'btn btn-primary btn-sm', href: mail }, `Reply to ${i.email}`) : null,
          digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `tel:${digits}` }, `Call ${i.phone}`) : null,
          digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `https://wa.me/${digits.replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null),
        h('details', {},
          h('summary', {}, `Why this scores ${sc.score}`),
          h('ul', { class: 'a-why' }, sc.checks.map((c) => h('li', { class: c.ok ? '' : 'miss' }, h('span', { class: 'pts' }, c.ok ? `+${c.pts}` : '0'), c.label))),
          h('p', { class: 'v-note' }, 'A guide from what the buyer wrote, not a verdict. A short enquiry from a known importer can still be the best lead of the month.'))),
      h('div', { class: 'a-lead-side' },
        h('label', { class: 'a-stage' }, 'Stage', stageSel),
        h('p', { class: 'a-note', style: 'margin:0' }, resp != null ? `First response after ${hours(resp)}` : i.status === 'new' ? `Waiting ${hours(ageHours(i))}` : 'Response time not recorded'),
        h('div', { class: 'a-note-form' }, note, h('div', { class: 'row', style: '--gap:8px;flex-wrap:wrap' }, saveNote, i.noteAt ? h('span', { class: 'a-note' }, `Saved ${timeAgo(i.noteAt)}`) : null)),
        history.length ? h('details', {}, h('summary', {}, `History (${history.length})`),
          h('ol', { class: 'a-history' }, history.map((x) => h('li', {}, `${stageLabel(x.status)}, ${formatDate(x.at)}`)), h('li', {}, `Arrived, ${formatDate(i.createdAt)}`))) : null)),
    h('div', { class: 'a-lead-foot' },
      h('span', { class: 'a-note' }, `Received ${formatDate(i.createdAt)}`),
      h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', onclick: () => remove(i) }, 'Delete')));
}

async function update(i, body, ok) {
  try {
    const r = await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'POST', body });
    Object.assign(i, r.inquiry || body);
    store.invalidate('inquiries');
    setBadge(all);
    renderInsights();
    renderInbox();
    toast(ok);
  } catch (e) { toast(e.message, 'error'); }
}

async function remove(i) {
  const ok = await confirmDialog({ title: 'Delete this enquiry?', body: `The enquiry from ${i.name || 'this visitor'} is removed for good. Mark it Lost or Archived instead if you may need it later.` });
  if (!ok) return;
  try {
    await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'DELETE' });
    all = all.filter((x) => x.id !== i.id);
    store.invalidate('inquiries');
    setBadge(all); renderInsights(); renderInbox();
    toast('Enquiry deleted.');
  } catch (e) { toast(e.message, 'error'); }
}

function csv() {
  const rows = filtered();
  if (!rows.length) return toast('There are no enquiries in this view to download.', 'error');
  const cols = [['createdAt', 'Date'], ['status', 'Stage'], ['line', 'Business line'], ['product', 'Product'], ['score', 'Lead score'], ['market', 'Market'], ['port', 'Destination port'], ['volume', 'Volume'], ['firstResponse', 'First response (hours)'], ['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['message', 'Message'], ['note', 'Private note'], ['emailed', 'Notification emailed']];
  // quote every cell, and neutralise a leading = + - @ so spreadsheets never run it as a formula
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const value = (r, k) => {
    const sc = scoreOf(r);
    if (k === 'line') return LINE_LABEL[lineOf(r.product)];
    if (k === 'status') return stageLabel(r.status);
    if (k === 'score') return sc.score;
    if (k === 'market') return sc.details.market?.name || '';
    if (k === 'port') return sc.details.port || '';
    if (k === 'volume') return sc.details.volume || '';
    if (k === 'firstResponse') { const x = firstResponseHours(r); return x == null ? '' : x.toFixed(1); }
    return r[k];
  };
  const text = [cols.map((c) => cell(c[1])).join(','), ...rows.map((r) => cols.map(([k]) => cell(value(r, k))).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `olira-enquiries-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
