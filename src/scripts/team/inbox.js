// Inbox: the team's enquiries on the left, the selected one on the right with
// everything needed to work it: accept, stage, buyer details, the client's files
// and studio design, reply by email, quote, log a call, and the timeline.
// Enquiry text comes from strangers, so it is only ever written as text.
import { $, $$, h, api, getToken, toast, confirmDialog, formatDate, timeAgo } from '../admin/api.js';
import { STAGES, scoreOf, BAND_LABEL, firstResponseHours, median, ageHours } from '../admin/leads.js';
import { hours, int } from '../admin/format.js';
import { session, leads, putLead, OPEN, CLOSED, isMine, toAccept as waiting, stageName, followupsOf } from './session.js';
import { composer } from './compose.js';
import { confirmSelect } from '../admin/stage-control.js';
import { scrollBehavior, captureFocus, restoreFocus } from '../admin/motion.js';
import { quoteBuilder } from './quote.js';

let all = [];
let bound = false;
let selectedId = null;
const pack = () => session.line === 'pack';

export async function refreshCounts() {
  try { all = await leads(); setCounts(); } catch (e) {}
}
function setCounts() {
  const toAccept = all.filter(waiting).length;
  const badge = $('[data-count="inbox"]');
  badge.hidden = !toAccept; badge.textContent = toAccept > 99 ? '99+' : String(toAccept || ''); badge.setAttribute('aria-label', `${toAccept} to accept`);
  const due = followupsOf(all).length;
  const fb = $('[data-count="followups"]');
  fb.hidden = !due; fb.textContent = String(due || ''); fb.setAttribute('aria-label', `${due} follow-ups due`);
}

export async function show({ params }) {
  if (!bound) {
    bound = true;
    $$('input[name="inboxFilter"]').forEach((r) => r.addEventListener('change', () => { renderList(); writeUrl(); }));
    $('#inboxSort').addEventListener('change', () => { renderList(); writeUrl(); });
    let t; $('#inboxSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderList(); writeUrl(); }, 200); });
    $('#inboxRefresh').addEventListener('click', () => load(true));
    // coming back to the tab after a while picks up new enquiries without a click
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !$('[data-view="inbox"]').hidden && Date.now() - loadedAt > 60000) load(true, { quiet: true });
    });
  }
  // the view is in the URL, so it can be bookmarked, shared and survives a reload
  const f = params.get('filter'), s = params.get('sort'), q = params.get('q');
  if (f && $(`input[name="inboxFilter"][value="${CSS.escape(f)}"]`)) $(`input[name="inboxFilter"][value="${CSS.escape(f)}"]`).checked = true;
  if (s && $(`#inboxSort option[value="${CSS.escape(s)}"]`)) $('#inboxSort').value = s;
  if (q != null) $('#inboxSearch').value = q;
  await load();
  const want = params.get('lead');
  if (want && all.some((l) => l.id === want)) {
    const l = all.find((x) => x.id === want);
    // a bare link (from a notification email) switches to a filter that lists the enquiry;
    // a URL that already names a filter or search is restored exactly as it was left
    if (!f && q == null && !filtered().some((x) => x.id === want)) {
      const filter = waiting(l) ? 'unassigned' : OPEN.includes(l.status) ? (isMine(l) ? 'mine' : 'open') : 'closed';
      $(`input[name="inboxFilter"][value="${filter}"]`).checked = true;
      $('#inboxSearch').value = '';
    }
    renderList();
    select(want, { focus: true });
  } else if (!selectedId && !f) {
    const mine = all.filter((l) => isMine(l) && OPEN.includes(l.status)).length;
    const toAccept = all.filter(waiting).length;
    if (!toAccept && mine) { $('input[name="inboxFilter"][value="mine"]').checked = true; renderList(); }
  }
}

let loadedAt = 0;
async function load(force, { quiet } = {}) {
  const view = $('[data-view="inbox"]');
  view.setAttribute('aria-busy', 'true');
  // a skeleton only if the wait is long enough to notice, and never over data already shown
  const skel = setTimeout(() => { if (!all.length) skeleton(); }, 400);
  try {
    all = await leads(force);
    loadedAt = Date.now();
    const focus = captureFocus();
    setCounts(); renderKpis(); renderList();
    if (selectedId) renderDetail();
    restoreFocus(focus);
    if (force && !quiet) toast('Inbox refreshed.');
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { clearTimeout(skel); view.removeAttribute('aria-busy'); }
}
function skeleton() {
  $('#inboxKpis').replaceChildren(...Array.from({ length: 4 }, () => h('li', { class: 't-stat t-skel', 'aria-hidden': 'true' })));
  $('#inboxList').replaceChildren(...Array.from({ length: 5 }, () => h('li', { class: 't-skel-row', 'aria-hidden': 'true' }, h('span', { class: 't-skel' }), h('span', { class: 't-skel' }), h('span', { class: 't-skel' }))));
  $('#inboxSummary').textContent = 'Loading enquiries.';
}

function writeUrl() {
  const p = new URLSearchParams();
  const f = $('input[name="inboxFilter"]:checked').value, s = $('#inboxSort').value, q = $('#inboxSearch').value.trim();
  if (f !== 'unassigned') p.set('filter', f);
  if (s !== 'newest') p.set('sort', s);
  if (q) p.set('q', q);
  if (selectedId) p.set('lead', selectedId);
  const qs = p.toString();
  history.replaceState(null, '', `#inbox${qs ? `?${qs}` : ''}`);
}

/* ---------- numbers ---------- */
function renderKpis() {
  const mineOpen = all.filter((l) => isMine(l) && OPEN.includes(l.status));
  const toAccept = all.filter(waiting);
  const quotes = all.filter((l) => l.status === 'quoted' && (session.isAdmin || isMine(l)));
  const month = Date.now() - 30 * 86400000;
  const recent = all.filter((l) => Date.parse(l.createdAt) > month && (session.isAdmin || isMine(l)));
  const resp = median(recent.map(firstResponseHours));
  const won = all.filter((l) => l.status === 'won' && (session.isAdmin || isMine(l)) && Date.parse(l.history?.at(-1)?.at || l.createdAt) > month).length;
  const oldest = toAccept.length ? Math.max(...toAccept.map(ageHours)) : null;
  const due = followupsOf(all).length;
  // [value, label, note, overdue]; overdue is said in words, not only in colour
  const stat = (value, label, note, overdue, href) => {
    const body = [h('strong', {}, value), h('span', {}, label), note ? h('em', {}, overdue ? `Overdue, ${note}` : note) : null];
    return h('li', { class: `t-stat${overdue ? ' is-warn' : ''}` }, href ? h('a', { class: 't-stat-link', href }, ...body) : body);
  };
  $('#inboxKpis').replaceChildren(
    stat(int(toAccept.length), 'to accept', oldest != null ? `oldest ${hours(oldest)}` : null, oldest != null && oldest > 4),
    stat(int(session.isAdmin ? all.filter((l) => OPEN.includes(l.status)).length : mineOpen.length), session.isAdmin ? 'open' : 'mine, open', null, false),
    stat(int(quotes.length), 'quotes out', null, false),
    stat(int(due), due === 1 ? 'follow-up due' : 'follow-ups due', null, due > 0, '#followups'),
    h('li', { class: 't-stat t-stat-quiet' }, h('span', {}, session.isAdmin ? 'First response' : 'My first response'), resp == null ? h('em', {}, 'not enough data yet') : h('strong', {}, hours(resp)), won ? h('em', {}, `${won} won in 30 days`) : null),
  );
}

/* ---------- list ---------- */
function filtered() {
  const f = $('input[name="inboxFilter"]:checked').value, sort = $('#inboxSort').value;
  const q = $('#inboxSearch').value.trim().toLowerCase();
  const test = {
    unassigned: waiting,
    mine: (l) => isMine(l) && OPEN.includes(l.status),
    open: (l) => OPEN.includes(l.status),
    closed: (l) => CLOSED.includes(l.status),
  };
  for (const [k, fn] of Object.entries(test)) { const b = $(`[data-filter-count="${k}"]`); if (b) b.textContent = String(all.filter(fn).length); }
  let list = all.filter(test[f]).filter((l) => !q || [l.name, l.company, l.email, l.phone, l.product, l.message, l.assignee?.name].some((v) => String(v || '').toLowerCase().includes(q)));
  if (sort === 'oldest') list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  else if (sort === 'score') list.sort((a, b) => scoreOf(b).score - scoreOf(a).score);
  else list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return list;
}

function renderList() {
  const list = filtered(), ul = $('#inboxList');
  const f = $('input[name="inboxFilter"]:checked').value;
  $('#inboxSummary').textContent = `${list.length} shown of ${all.length} ${session.line === 'pack' ? 'packaging' : 'agriculture'} ${all.length === 1 ? 'enquiry' : 'enquiries'}.`;
  if (!list.length) {
    const msg = { unassigned: ['Nothing to accept', 'New enquiries from the website appear here.'], mine: ['Nothing open for you', 'Accept an enquiry in To accept to make it yours.'], open: ['No open enquiries', 'Everything has been won, lost or archived.'], closed: ['Nothing closed yet', 'Enquiries marked Won, Lost or Archived appear here.'] }[f];
    ul.replaceChildren(h('li', { class: 't-list-empty' }, h('strong', {}, msg[0]), msg[1]));
    return;
  }
  ul.replaceChildren(...list.map((l) => {
    const sc = scoreOf(l);
    const spoken = [
      [l.name || 'Unknown', l.company].filter(Boolean).join(', '),
      stageName(l.status),
      `Lead score ${sc.score}, ${BAND_LABEL[sc.band].toLowerCase()}`,
      l.assignee ? (isMine(l) ? 'Accepted by you' : `Accepted by ${l.assignee.name}`) : null,
      l.files?.length ? `${l.files.length} file${l.files.length === 1 ? '' : 's'}` : null,
      `Received ${timeAgo(l.createdAt)}`,
    ].filter(Boolean).join('. ');
    const btn = h('button', { type: 'button', class: 't-row', 'aria-label': spoken, 'aria-current': l.id === selectedId ? 'true' : null, onclick: (e) => select(l.id, { focus: true, scroll: true, event: e }) },
      h('span', { class: 't-row-top' },
        h('strong', {}, l.name || 'Unknown'),
        h('time', { datetime: l.createdAt, title: formatDate(l.createdAt) }, timeAgo(l.createdAt))),
      h('span', { class: 't-row-sub' }, [l.company, l.product && !/^(Agricultural products|Packaging)$/i.test(l.product) ? l.product : null].filter(Boolean).join(', ') || l.email),
      h('span', { class: 't-row-meta' },
        h('span', { class: `a-tag stage-${l.status}` }, stageName(l.status)),
        h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, String(sc.score), h('span', { class: 'sr-only' }, ` out of 100, ${BAND_LABEL[sc.band]}`)),
        l.assignee ? h('span', { class: 't-owner' }, isMine(l) ? 'You' : l.assignee.name) : null,
        l.files?.length ? h('span', { class: 't-files' }, `${l.files.length} file${l.files.length === 1 ? '' : 's'}`) : null,
        l.design ? h('span', { class: 't-files' }, 'Studio design') : null));
    return h('li', { class: waiting(l) ? 'is-new' : '', 'data-focus-scope': `row-${l.id}` }, btn);
  }));
}

function select(id, { focus, scroll, event } = {}) {
  selectedId = id;
  renderList();
  renderDetail();
  writeUrl();
  const d = $('#leadDetail');
  if (scroll && matchMedia('(max-width: 1100px)').matches) d.scrollIntoView({ block: 'start', behavior: scrollBehavior(event) });
  if (focus) { const hd = $('h2', d); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: !scroll }); } }
}

/* ---------- detail ---------- */
async function update(lead, body, ok) {
  try {
    const r = await api(`/api/team/inquiries/${encodeURIComponent(lead.id)}`, { method: 'POST', body });
    replace(r.inquiry);
    if (ok) toast(ok);
    return r.inquiry;
  } catch (e) {
    if (e.status === 409) { toast(e.message, 'error'); load(true); } else toast(e.message, 'error');
    return null;
  }
}
export function replace(rec) {
  putLead(rec);
  const i = all.findIndex((x) => x.id === rec.id);
  if (i >= 0) all[i] = rec; else all.unshift(rec);
  const focus = captureFocus();
  setCounts(); renderKpis(); renderList();
  if (selectedId === rec.id) renderDetail();
  restoreFocus(focus);
}

const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function renderDetail() {
  const box = $('#leadDetail');
  const l = all.find((x) => x.id === selectedId);
  if (!l) { box.replaceChildren(h('div', { class: 'a-empty' }, h('strong', {}, 'Choose an enquiry'), 'Its details, files and reply tools open here.')); return; }
  // keep what someone is typing when the enquiry re-renders after an action
  const keep = captureDrafts(box, l.id);
  const sc = scoreOf(l), d = sc.details;
  const who = l.name || 'this buyer';
  const mine = isMine(l);
  const digits = String(l.phone || '').replace(/[^\d+]/g, '');

  const ownerBar = h('div', { class: 't-owner-bar', 'data-focus-scope': `owner-${l.id}` },
    !l.assignee && OPEN.includes(l.status) && !session.isAdmin
      ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => update(l, { assign: 'me' }, `You accepted the enquiry from ${who}.`) }, 'Accept this enquiry')
      : h('p', { class: 'a-note' }, l.assignee ? (mine ? 'You accepted this enquiry.' : `Accepted by ${l.assignee.name}.`) : session.isAdmin ? 'Not accepted by anyone yet.' : 'Closed.'),
    mine || (session.isAdmin && l.assignee) ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
      const ok = await confirmDialog({ title: 'Release this enquiry?', body: `It goes back to To accept so someone else on the team can take it.`, confirm: 'Release' });
      if (ok) update(l, { assign: 'none' }, 'Released. It is back in To accept.');
    } }, 'Release') : null,
    session.isAdmin ? assignSelect(l) : null,
    (() => {
      const stage = confirmSelect({ options: STAGES.map((s) => [s.id, s.label]), value: l.status, label: `Stage for ${who}`, onConfirm: (v) => update(l, { status: v }, `Moved to ${stageName(v)}.`) });
      return h('div', { class: 't-stage' }, h('label', { class: 'a-stage' }, 'Stage', stage.select), stage.button);
    })());

  const facts = h('dl', { class: 't-facts' },
    fact('Email', l.email ? h('a', { href: `mailto:${l.email}` }, l.email) : 'Not given'),
    fact('Phone', l.phone ? h('span', { class: 't-inline' }, h('a', { href: `tel:${digits}` }, l.phone), digits ? h('a', { class: 'btn btn-ghost btn-sm', href: `https://wa.me/${digits.replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null) : 'Not given'),
    fact('Asked about', l.product || 'Not specified'),
    d.market ? fact('Market', `${d.market.name}, from the ${d.market.from}`) : null,
    d.port ? fact(pack() ? 'Delivery' : 'Destination port', d.port) : null,
    d.volume ? fact('Quantity', d.volume) : null,
    fact('Received', `${formatDate(l.createdAt)}, ${timeAgo(l.createdAt)}`));

  const parts = [
    h('header', { class: 't-detail-head', 'data-focus-scope': `head-${l.id}` },
      h('div', {},
        h('h2', {}, l.name || 'Unknown'),
        h('p', {}, [l.company, l.email].filter(Boolean).join(', '))),
      h('div', { class: 'a-lead-meta' },
        h('span', { class: `a-tag stage-${l.status}` }, stageName(l.status)),
        h('span', { class: `a-score ${sc.band}`, title: BAND_LABEL[sc.band] }, `${sc.score}`, h('span', { class: 'sr-only' }, ` out of 100, ${BAND_LABEL[sc.band]}`)),
        l.emailed === false ? h('span', { class: 'a-tag warn', title: 'The notification email failed. The enquiry is safe here.' }, 'Notification not delivered') : null)),
    ownerBar,
    jumpBar(l),
    section('Buyer', facts,
      h('details', { class: 't-why' }, h('summary', {}, `Why the lead scores ${sc.score}`),
        h('ul', { class: 'a-why' }, sc.checks.map((c) => h('li', { class: c.ok ? '' : 'miss' }, h('span', { class: 'pts' }, c.ok ? `+${c.pts}` : '0'), c.label))))),
    section('Message', h('p', { class: 'a-lead-msg' }, String(l.message || '').trim() || 'No message.')),
  ];
  if (l.design) parts.push(section('Design from the studio', designSummary(l)));
  if (pack() || l.files?.length) parts.push(section('Files', filesPanel(l)));
  parts.push(
    section('Reply by email', composer(l, { onSent: replace, draft: keep.reply })),
    section('Quote', quoteBuilder(l, { onSaved: replace, draft: keep.quote })),
    section('Log a call, message or note', logForm(l, keep.log)),
    section('Timeline', timeline(l)),
  );
  if (session.isAdmin) parts.push(h('p', { class: 'a-note t-admin-note' }, 'You are viewing this workspace as the administrator. Delete enquiries from the admin panel.'));
  box.replaceChildren(...parts);
}

function captureDrafts(box, id) {
  if (box.dataset.lead !== id) { box.dataset.lead = id; return {}; }
  const val = (sel) => box.querySelector(sel)?.value;
  return {
    reply: box.querySelector('[data-compose]') ? { subject: val('[data-compose] [name=subject]'), body: val('[data-compose] [name=body]'), fromTemplate: box.querySelector('[data-compose] [name=body]').dataset.fromTemplate } : null,
    quote: box.querySelector('[data-quote]')?.__draft?.() || null,
    log: { type: val('[data-log] [name=type]'), text: val('[data-log] [name=text]') },
  };
}

const fact = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
const secId = (title) => `sec-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
function jumpBar(l) {
  const targets = [
    ['Reply', 'Reply by email', '[data-compose] [name=body]'],
    ['Quote', 'Quote', '.t-quote > summary'],
    ...(pack() || l.files?.length ? [['Files', 'Files', null]] : []),
    ['Log contact', 'Log a call, message or note', '[data-log] [name=text]'],
    ['Timeline', 'Timeline', null],
  ];
  return h('nav', { class: 't-jump', 'aria-label': 'Jump to', 'data-focus-scope': `jump-${l.id}` }, targets.map(([label, title, focusSel]) => h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    onclick: (event) => {
      const sec = document.getElementById(secId(title))?.closest('section');
      if (!sec) return;
      if (title === 'Quote') { const d = sec.querySelector('details'); if (d) d.open = true; }
      sec.scrollIntoView({ block: 'start', behavior: scrollBehavior(event) });
      const target = (focusSel && sec.querySelector(focusSel)) || sec.querySelector('h3');
      if (target) { if (target.tagName === 'H3') target.tabIndex = -1; target.focus({ preventScroll: true }); }
    },
  }, label)));
}
function section(title, ...children) {
  const id = secId(title);
  return h('section', { class: 't-section', 'aria-labelledby': id, 'data-focus-scope': `${id}-${selectedId}` }, h('h3', { id }, title), ...children);
}

function assignSelect(l) {
  const members = session.members.filter((m) => m.role === session.line);
  if (!members.length) return null;
  const hand = confirmSelect({
    options: [['', 'Hand to a team member'], ...members.map((m) => [m.id, m.name])],
    value: l.assignee?.id || '', label: 'Hand this enquiry to', verb: 'Hand',
    onConfirm: (v) => update(l, { assign: v }, 'Handed over.'),
  });
  return h('div', { class: 't-stage' }, hand.select, hand.button);
}

function designSummary(l) {
  const d = l.design;
  const chips = [
    ['Bag', d.templateName || d.template], ['Size', d.size], ['Ink', d.ink],
    d.text1 ? ['Main text', d.text1] : null, d.text2 ? ['Second line', d.text2] : null,
    ['Logo', d.hasLogo ? 'Sent, see Files' : 'Not sent'], d.oneInk ? ['Logo colour', 'In the ink colour'] : null,
  ].filter(Boolean);
  const wrap = h('div', { class: 't-design' }, h('div', { class: 'a-chips' }, chips.map(([k, v]) => h('span', { class: 'a-chip' }, h('b', {}, k), v))));
  if (pack()) wrap.append(h('a', { class: 'btn btn-secondary btn-sm', href: `#mockups?lead=${encodeURIComponent(l.id)}` }, 'Open in Mockups'));
  return wrap;
}

/* ---------- files ---------- */
const previewable = (f) => /^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type);
async function fileBlob(l, f) {
  const res = await fetch(`/api/team/inquiries/${encodeURIComponent(l.id)}/files/${encodeURIComponent(f.id)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (res.status === 401) throw Object.assign(new Error('Your session has ended. Sign in again.'), { status: 401 });
  if (!res.ok) throw new Error('The file could not be downloaded.');
  return res.blob();
}
export { fileBlob };

function filesPanel(l) {
  const files = l.files || [];
  const grid = h('ul', { class: 't-file-grid' });
  for (const f of files) {
    const thumb = h('span', { class: 't-thumb', 'aria-hidden': 'true' }, f.ext ? f.ext.toUpperCase() : 'FILE');
    if (previewable(f)) fileBlob(l, f).then((b) => { const url = URL.createObjectURL(b); const img = h('img', { src: url, alt: '' }); img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 1000); thumb.replaceChildren(img); }).catch(() => {});
    const dl = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Download ${f.name}` }, 'Download');
    dl.addEventListener('click', async () => {
      try {
        const b = await fileBlob(l, f);
        const a = h('a', { href: URL.createObjectURL(b), download: f.name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) { toast(e.message, 'error'); }
    });
    const canRemove = f.source !== 'client' || session.isAdmin;
    grid.append(h('li', { class: 't-file' }, thumb,
      h('div', { class: 't-file-body' },
        h('strong', {}, f.name),
        h('span', {}, `${{ artwork: 'Artwork', logo: 'Logo', mockup: 'Mockup', quote: 'Quote', document: 'Document' }[f.kind] || 'File'}, ${bytes(f.size)}, ${f.source === 'client' ? 'from the client' : `added by ${f.by?.name || 'the team'}`}`)),
      h('div', { class: 't-file-actions' }, dl,
        canRemove ? h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => removeFile(l, f) }, 'Remove') : null)));
  }
  const input = h('input', { type: 'file', id: `addFile-${l.id}`, class: 'sr-only', accept: '.pdf,.ai,.eps,.svg,.png,.jpg,.jpeg,.webp' });
  input.addEventListener('change', async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('Files can be up to 15 MB.', 'error');
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'document');
    try { const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/files`, { method: 'POST', form: fd }); replace(r.inquiry); toast(`${file.name} added.`); }
    catch (e) { toast(e.message, 'error'); }
  });
  const add = h('label', { class: 'btn btn-secondary btn-sm', for: `addFile-${l.id}` }, 'Add a file');
  const note = l.filesRejected?.length ? h('p', { class: 'a-warn' }, `The client also tried to send ${l.filesRejected.length} file${l.filesRejected.length === 1 ? '' : 's'} that could not be accepted: ${l.filesRejected.join(', ')}. Ask them to email it.`) : null;
  return h('div', { class: 't-files-panel' },
    files.length ? grid : h('p', { class: 'a-note' }, pack() ? 'No files yet. The client can attach artwork to the quote form, and mockups you save appear here.' : 'No files on this enquiry.'),
    note, h('div', { class: 'row', style: '--gap:8px' }, input, add));
}

async function removeFile(l, f) {
  const ok = await confirmDialog({ title: `Remove ${f.name}?`, body: 'It is deleted from the enquiry. Emails already sent with it are not affected.', confirm: 'Remove' });
  if (!ok) return;
  try {
    const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
    replace(r.inquiry); toast(`${f.name} removed.`);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- log ---------- */
const LOG_TYPES = [['call', 'Phone call'], ['whatsapp', 'WhatsApp or Telegram'], ['email', 'Email from my own mailbox'], ['meeting', 'Meeting'], ['note', 'Private note']];
function logForm(l, keep = {}) {
  const type = h('select', { class: 'input', name: 'type', 'aria-label': 'What happened' }, LOG_TYPES.map(([v, t]) => h('option', { value: v, selected: keep?.type === v || null }, t)));
  const text = h('textarea', { class: 'input', name: 'text', maxlength: '2000', rows: '3', 'aria-label': 'What was said or agreed', placeholder: 'What was said or agreed, and the next step' });
  if (keep?.text) text.value = keep.text;
  const save = h('button', { class: 'btn btn-secondary', type: 'submit' }, 'Save to the timeline');
  const form = h('form', { class: 't-log', 'data-log': '', novalidate: true }, h('div', { class: 't-log-row' }, type), text, h('div', { class: 'a-actions' }, save,
    h('span', { class: 'a-note' }, 'A call, message or email moves a new enquiry to Contacted.')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!text.value.trim()) { toast(type.value === 'note' ? 'Write the note first.' : 'Add a line about what was discussed.', 'error'); return text.focus(); }
    save.disabled = true;
    try {
      const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/activity`, { method: 'POST', body: { type: type.value, text: text.value } });
      text.value = '';
      replace(r.inquiry);
      toast('Saved to the timeline.');
    } catch (x) { toast(x.message, 'error'); }
    finally { save.disabled = false; }
  });
  return form;
}

/* ---------- timeline ---------- */
function timeline(l) {
  const items = [{ at: l.createdAt, title: 'Enquiry arrived from the website', text: null }];
  for (const x of l.history || []) items.push({ at: x.at, title: `Moved to ${stageName(x.status)}${x.by ? ` by ${x.by.name}` : ''}` });
  const label = { accepted: 'Accepted', released: 'Released', assigned: 'Handed to', reply: 'Email sent', call: 'Phone call', whatsapp: 'WhatsApp or Telegram', email: 'Email from own mailbox', meeting: 'Meeting', note: 'Note', quote: 'Quote saved', file: 'File added' };
  for (const a of l.activity || []) {
    const by = a.by ? ` by ${a.by.name}` : '';
    if (a.type === 'reply') items.push({ at: a.at, title: `Email sent${by}: ${a.subject}`, text: a.text, extra: a.attachments?.length ? `Attached: ${a.attachments.map((x) => x.name).join(', ')}` : null, kind: 'reply' });
    else if (a.type === 'assigned') items.push({ at: a.at, title: `Handed to ${a.text}${by}` });
    else if (a.type === 'released') items.push({ at: a.at, title: `Released${by}` });
    else if (a.type === 'quote') items.push({ at: a.at, title: `Quote ${a.number || ''} saved${by}`, text: a.text, kind: 'quote' });
    else if (a.type === 'file') items.push({ at: a.at, title: `File added${by}`, text: a.text });
    else if (a.type !== 'accepted') items.push({ at: a.at, title: `${label[a.type] || a.type}${by}`, text: a.text, kind: a.type === 'note' ? 'note' : 'contact' });
    else items.push({ at: a.at, title: `Accepted${by}` });
  }
  if (l.note) items.push({ at: l.noteAt || l.createdAt, title: 'Note from the admin panel', text: l.note, kind: 'note' });
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return h('ol', { class: 't-timeline' }, items.map((it) => h('li', { class: it.kind ? `is-${it.kind}` : '' },
    h('div', { class: 't-tl-head' }, h('strong', {}, it.title), h('time', { datetime: it.at, title: formatDate(it.at) }, timeAgo(it.at))),
    it.text ? (it.kind === 'reply' ? h('details', {}, h('summary', {}, 'Show the email'), h('p', { class: 't-tl-text' }, it.text)) : h('p', { class: 't-tl-text' }, it.text)) : null,
    it.extra ? h('p', { class: 'a-note' }, it.extra) : null)));
}
