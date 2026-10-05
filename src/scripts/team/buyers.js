// Buyers: every company (or person) that has enquired, with all of their
// enquiries, quotes and where each stands, so a returning buyer is recognised
// and the history is not split across enquiries. Built in the browser from the
// enquiries this account can already see: a team sees its own line, the manager
// both. Enquiry text comes from strangers, so it is only ever written as text.
import { $, $$, h, toast, formatDate, timeAgo } from '../admin/api.js';
import { leads, session, LINE_LABEL, stageName } from './session.js';
import { groupBuyers, summarise, money } from './buyer-groups.js';
import { arrowKeys, backButton } from '../admin/tools.js';

/* ---------------- the view ---------------- */
let buyers = [];
let selected = null;
let bound = false;
const boss = () => session.oversees;

export async function show({ params } = {}) {
  if (!bound) {
    bound = true;
    let t; $('#buyerSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderList(); writeUrl(); }, 180); });
    $('#buyerSort').addEventListener('change', () => { renderList(); writeUrl(); });
    $('#buyerLine')?.addEventListener('change', () => { renderList(); writeUrl(); });
    arrowKeys($('#buyerList'), '.t-row', (key) => select(key, { push: false }));
  }
  if (params?.get('q') != null) $('#buyerSearch').value = params.get('q');
  if (params?.get('sort') && $(`#buyerSort option[value="${CSS.escape(params.get('sort'))}"]`)) $('#buyerSort').value = params.get('sort');
  const view = $('[data-view="buyers"]');
  view.setAttribute('aria-busy', 'true');
  try {
    buyers = groupBuyers(await leads()).map(summarise);
    const want = params?.get('b');
    selected = want && buyers.some((b) => b.key === want) ? want : selected && buyers.some((b) => b.key === selected) ? selected : null;
    renderList();
    renderDetail();
    if (want && selected) panes().classList.add('is-detail');
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
  finally { view.removeAttribute('aria-busy'); }
}

const panes = () => $('[data-view="buyers"] .t-inbox');
function writeUrl() {
  const p = new URLSearchParams();
  const q = $('#buyerSearch').value.trim(), s = $('#buyerSort').value;
  if (q) p.set('q', q);
  if (s !== 'recent') p.set('sort', s);
  if (selected) p.set('b', selected);
  history.replaceState(null, '', `#buyers${p.toString() ? `?${p}` : ''}`);
}

function filtered() {
  const q = $('#buyerSearch').value.trim().toLowerCase(), sort = $('#buyerSort').value, ln = $('#buyerLine')?.value || 'all';
  let list = buyers.filter((b) => (ln === 'all' || b.lines.includes(ln)) && (!q || [b.name, b.company, b.market, ...b.people.flatMap((p) => [p.name, p.email, p.phone]), ...b.products].some((v) => String(v || '').toLowerCase().includes(q))));
  const value = (b) => Object.values(b.quoted).reduce((n, v) => n + v, 0);
  if (sort === 'enquiries') list = list.sort((a, b) => b.leads.length - a.leads.length || b.last - a.last);
  else if (sort === 'value') list = list.sort((a, b) => value(b) - value(a) || b.last - a.last);
  else if (sort === 'name') list = list.sort((a, b) => a.name.localeCompare(b.name));
  else list = list.sort((a, b) => b.last - a.last);
  return list;
}

function renderList() {
  const list = filtered(), ul = $('#buyerList');
  $('#buyerSummary').textContent = `${list.length} of ${buyers.length} ${buyers.length === 1 ? 'buyer' : 'buyers'} shown.`;
  $('#buyerCount').textContent = String(buyers.length);
  if (!list.length) {
    ul.replaceChildren(h('li', { class: 't-list-empty' }, h('strong', {}, buyers.length ? 'No buyer matches' : 'No buyers yet'), buyers.length ? 'Try another name, email or product.' : 'Everyone who sends an enquiry appears here, grouped by company.'));
    return;
  }
  ul.replaceChildren(...list.map((b) => {
    const spoken = [b.name, b.market, `${b.leads.length} ${b.leads.length === 1 ? 'enquiry' : 'enquiries'}`, b.open ? `${b.open} open` : null, b.won ? `${b.won} won` : null, `last contact ${timeAgo(new Date(b.last).toISOString())}`].filter(Boolean).join(', ');
    return h('li', {}, h('button', { type: 'button', class: 't-row', 'data-id': b.key, 'aria-label': spoken, 'aria-current': b.key === selected ? 'true' : null, onclick: (e) => select(b.key, { focus: true, event: e }) },
      h('span', { class: 't-row-top' }, h('strong', {}, b.name), h('time', { datetime: new Date(b.last).toISOString() }, timeAgo(new Date(b.last).toISOString()))),
      h('span', { class: 't-row-sub' }, [b.company && b.people[0]?.name ? b.people[0].name : null, b.market].filter(Boolean).join(', ') || b.people[0]?.email || ''),
      h('span', { class: 't-row-meta' },
        h('span', { class: 't-chip' }, `${b.leads.length} ${b.leads.length === 1 ? 'enquiry' : 'enquiries'}`),
        b.open ? h('span', { class: 't-chip' }, `${b.open} open`) : null,
        b.won ? h('span', { class: 'a-tag stage-won' }, `${b.won} won`) : null,
        boss() ? b.lines.map((ln) => h('span', { class: `a-tag ${ln}` }, LINE_LABEL[ln])) : null)));
  }));
}

function select(key, { focus, push = true } = {}) {
  selected = key;
  renderList(); renderDetail(); writeUrl();
  if (push) panes().classList.add('is-detail');
  if (focus) { const hd = $('#buyerDetail h2'); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); } }
}
function back() {
  panes().classList.remove('is-detail');
  $(`#buyerList .t-row[data-id="${CSS.escape(selected || '')}"]`)?.focus({ preventScroll: true });
}

const fact = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
function renderDetail() {
  const box = $('#buyerDetail');
  const b = buyers.find((x) => x.key === selected);
  if (!b) { box.replaceChildren(h('div', { class: 'a-empty' }, h('strong', {}, 'Choose a buyer'), 'Their people, every enquiry and quote, and where each stands open here.')); return; }
  const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
  box.replaceChildren(
    backButton('Buyers', back),
    h('header', { class: 't-detail-head' },
      h('div', {}, h('h2', {}, b.name), h('p', {}, [b.market, b.lines.map((ln) => LINE_LABEL[ln]).join(' and ')].filter(Boolean).join(', ')),
        h('p', { class: 't-chips' },
          h('span', { class: 't-chip' }, `${b.leads.length} ${b.leads.length === 1 ? 'enquiry' : 'enquiries'}`),
          h('span', { class: 't-chip' }, `${b.open} open`),
          b.won ? h('span', { class: 'a-tag stage-won' }, `${b.won} won`) : null,
          b.lost ? h('span', { class: 't-chip' }, `${b.lost} lost`) : null))),
    h('section', { class: 't-section' }, h('h3', {}, 'People'),
      h('ul', { class: 't-people-list' }, b.people.map((p) => h('li', {},
        h('strong', {}, p.name || 'No name given'),
        p.email ? h('a', { href: `mailto:${p.email}` }, p.email) : null,
        p.phone ? h('span', { class: 't-inline' }, h('a', { href: `tel:${digits(p.phone)}` }, p.phone), digits(p.phone) ? h('a', { class: 'btn btn-ghost btn-sm', href: `https://wa.me/${digits(p.phone).replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null) : null)))),
    h('section', { class: 't-section' }, h('h3', {}, 'At a glance'),
      h('dl', { class: 't-facts' },
        fact('First enquiry', b.first ? `${formatDate(b.first)}, ${timeAgo(b.first)}` : 'Unknown'),
        fact('Last contact', timeAgo(new Date(b.last).toISOString())),
        fact('Quoted', money(b.quoted) || 'Nothing quoted yet'),
        fact('Won', money(b.wonValue) || (b.won ? `${b.won} won, value not in a quote` : 'Nothing won yet')),
        b.products.length ? fact('Asked about', b.products.join(', ')) : null,
        b.ports.length ? fact('Ports', b.ports.join(', ')) : null)),
    h('section', { class: 't-section' }, h('h3', {}, 'Enquiries'),
      h('div', { class: 'a-scroll' }, h('table', { class: 'a-table' },
        h('caption', { class: 'sr-only' }, `Enquiries from ${b.name}`),
        h('thead', {}, h('tr', {}, ['Received', 'Product', 'Stage', 'Handled by', 'Latest quote'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, b.leads.map((l) => h('tr', {},
          h('td', {}, h('a', { href: `#inbox?lead=${encodeURIComponent(l.id)}` }, formatDate(l.createdAt))),
          h('td', {}, l.product || 'Not specified'),
          h('td', {}, h('span', { class: `a-tag stage-${l.status}` }, stageName(l.status))),
          h('td', {}, l.assignee?.name || 'Nobody yet'),
          h('td', {}, l.quote ? `${l.quote.number}, ${l.quote.currency} ${Math.round(l.quote.total).toLocaleString('en-US')}` : ''))))))),
  );
}
