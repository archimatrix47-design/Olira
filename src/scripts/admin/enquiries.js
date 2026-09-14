// Enquiries inbox: leads saved by /api/inquiry.
import { $, $$, h, api, toast, confirmDialog, formatDate, timeAgo } from './api.js';

let all = [];
let counts = { total: 0, new: 0, read: 0, archived: 0 };
let bound = false;

// The website sends "Agricultural products", "Packaging", "Kraft paper bags"
// or a product name picked on the agriculture page.
export const lineOf = (product) => (/packag|bag/i.test(product || '') ? 'pack' : 'agri');
const LINE_LABEL = { agri: 'Agriculture', pack: 'Packaging' };
const STATUS_LABEL = { new: 'New', read: 'Read', archived: 'Archived' };

export async function refreshBadge() {
  try {
    const d = await api('/api/admin/inquiries');
    setData(d);
  } catch (e) {}
}

function setData(d) {
  all = Array.isArray(d?.inquiries) ? d.inquiries : [];
  counts = { total: all.length, new: 0, read: 0, archived: 0, ...(d?.counts || {}) };
  const badge = $('#newCount');
  badge.hidden = !counts.new;
  badge.textContent = counts.new > 99 ? '99+' : String(counts.new || '');
  badge.setAttribute('aria-label', `${counts.new} new`);
  for (const b of $$('[data-count]')) b.textContent = counts[b.dataset.count] ?? 0;
}

export async function show() {
  if (!bound) {
    bound = true;
    $$('input[name="leadStatus"]').forEach((r) => r.addEventListener('change', render));
    $('#leadLine').addEventListener('change', render);
    let t; $('#leadSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 150); });
    $('#leadsRefresh').addEventListener('click', () => load(true));
    $('#leadsCsv').addEventListener('click', csv);
  }
  load();
}

async function load(announce) {
  try {
    setData(await api('/api/admin/inquiries'));
    render();
    if (announce) toast('Enquiries refreshed.');
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

function filtered() {
  const status = $('input[name="leadStatus"]:checked').value;
  const line = $('#leadLine').value;
  const q = $('#leadSearch').value.trim().toLowerCase();
  return all.filter((i) => (status === 'all' || i.status === status)
    && (line === 'all' || lineOf(i.product) === line)
    && (!q || [i.name, i.company, i.email, i.phone, i.product, i.message].some((v) => String(v || '').toLowerCase().includes(q))));
}

function render() {
  const list = filtered();
  const el = $('#leads');
  $('#leadsLive').textContent = `${list.length} ${list.length === 1 ? 'enquiry' : 'enquiries'} shown.`;
  if (!list.length) {
    const status = $('input[name="leadStatus"]:checked').value;
    el.replaceChildren(h('div', { class: 'a-card a-empty' },
      h('strong', {}, all.length ? 'Nothing matches' : 'No enquiries yet'),
      all.length ? (status === 'new' ? 'You are all caught up. Choose All to see earlier enquiries.' : 'Try another status, business line or search.') : 'When someone sends a form on the website, it appears here.'));
    return;
  }
  el.replaceChildren(...list.map(card));
}

function card(i) {
  const line = lineOf(i.product);
  const digits = String(i.phone || '').replace(/[^\d+]/g, '');
  const subject = `Your ${line === 'pack' ? 'packaging' : 'Olira'} enquiry`;
  const quoted = String(i.message || '').split('\n').map((l) => `> ${l}`).join('\n');
  const mail = `mailto:${encodeURIComponent(i.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Dear ${i.name || ''},\n\nThank you for your enquiry.\n\n\n\n${quoted}`)}`;

  const actions = [];
  if (i.status !== 'read') actions.push(h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => setStatus(i, 'read') }, i.status === 'archived' ? 'Move to read' : 'Mark as read'));
  if (i.status !== 'new') actions.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setStatus(i, 'new') }, 'Mark as new'));
  if (i.status !== 'archived') actions.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setStatus(i, 'archived') }, 'Archive'));

  return h('article', { class: `a-card a-lead${i.status === 'new' ? ' is-new' : ''}`, 'aria-label': `Enquiry from ${i.name || 'unknown'}` },
    h('div', { class: 'a-lead-head' },
      h('h3', {}, i.name || 'Unknown', i.company ? h('small', {}, i.company) : null),
      h('div', { class: 'a-lead-meta' },
        h('span', { class: `a-tag ${line}` }, LINE_LABEL[line]),
        h('span', { class: 'a-tag' }, STATUS_LABEL[i.status] || i.status),
        i.emailed === false ? h('span', { class: 'a-tag warn', title: 'The notification email to your team failed. Reply from here.' }, 'Email not delivered') : null,
        h('time', { datetime: i.createdAt, title: formatDate(i.createdAt) }, timeAgo(i.createdAt)))),
    i.product && !/^(Agricultural products|Packaging)$/.test(i.product) ? h('p', { class: 'a-note' }, 'About: ', h('strong', { style: 'color:var(--ink)' }, i.product)) : null,
    h('p', { class: 'a-lead-msg' }, i.message || ''),
    h('div', { class: 'a-lead-contact' },
      i.email ? h('a', { class: 'btn btn-primary btn-sm', href: mail }, `Reply to ${i.email}`) : null,
      digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `tel:${digits}` }, `Call ${i.phone}`) : null,
      digits ? h('a', { class: 'btn btn-secondary btn-sm', href: `https://wa.me/${digits.replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null),
    h('div', { class: 'a-lead-foot' },
      h('div', { class: 'row', style: '--gap:6px;flex-wrap:wrap' }, actions),
      h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', onclick: () => remove(i) }, 'Delete')));
}

async function setStatus(i, status) {
  try {
    await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'POST', body: { status } });
    i.status = status;
    setData({ inquiries: all, counts: recount() });
    render();
    toast(`Marked as ${STATUS_LABEL[status].toLowerCase()}.`);
  } catch (e) { toast(e.message, 'error'); }
}

async function remove(i) {
  const ok = await confirmDialog({ title: 'Delete this enquiry?', body: `The enquiry from ${i.name || 'this visitor'} is removed for good. Archive it instead if you may need it later.` });
  if (!ok) return;
  try {
    await api(`/api/admin/inquiries/${encodeURIComponent(i.id)}`, { method: 'DELETE' });
    all = all.filter((x) => x.id !== i.id);
    setData({ inquiries: all, counts: recount() });
    render();
    toast('Enquiry deleted.');
  } catch (e) { toast(e.message, 'error'); }
}

function recount() {
  const c = { total: all.length, new: 0, read: 0, archived: 0 };
  for (const i of all) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}

function csv() {
  const rows = filtered();
  if (!rows.length) return toast('There are no enquiries in this view to download.', 'error');
  const cols = [['createdAt', 'Date'], ['status', 'Status'], ['line', 'Business line'], ['product', 'Product'], ['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['message', 'Message'], ['emailed', 'Notification emailed']];
  // quote every cell, and neutralise leading = + - @ so spreadsheets never run it as a formula
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const text = [cols.map((c) => cell(c[1])).join(','), ...rows.map((r) => cols.map(([k]) => cell(k === 'line' ? LINE_LABEL[lineOf(r.product)] : r[k])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `olira-enquiries-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
