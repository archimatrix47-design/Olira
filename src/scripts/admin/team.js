// Team accounts: the people who answer enquiries in the agriculture and
// packaging workspaces. Each signs in with their own email and password.
import { $, h, api, toast, confirmDialog, busy, timeAgo } from './api.js';

let members = [];
let editingId = null;
let bound = false;
const form = () => $('#teamForm');
const TEAM = { agri: 'Agriculture', pack: 'Packaging' };

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    const r = await api('/api/admin/team');
    members = r.members || [];
    renderList();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

function renderList() {
  const ul = $('#teamList');
  const count = (role) => members.filter((m) => m.role === role && m.active).length;
  $('#teamSummary').textContent = members.length
    ? `${count('agri')} active in agriculture, ${count('pack')} active in packaging.`
    : '';
  if (!members.length) {
    ul.replaceChildren(h('li', { class: 'a-empty', style: 'display:block' }, h('strong', {}, 'No team accounts yet'), 'Until you add someone, enquiries are answered from this admin panel only.'));
    return;
  }
  const sorted = members.slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  ul.replaceChildren(...sorted.map((m) => h('li', { class: editingId === m.id ? 'is-editing' : '' },
    h('span', { class: `a-avatar ${m.role}`, 'aria-hidden': 'true' }, initials(m.name)),
    h('div', { class: 'grow' },
      h('strong', {}, m.name, m.active ? null : h('span', { class: 'a-tag warn', style: 'margin-left:8px' }, 'Switched off')),
      h('span', {}, `${m.email}`),
      h('span', { class: 'a-row-meta' }, h('span', { class: `a-tag ${m.role}` }, TEAM[m.role]), m.lastLoginAt ? `Last signed in ${timeAgo(m.lastLoginAt)}` : 'Has not signed in yet')),
    h('div', { class: 'a-row-actions' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Edit ${m.name}`, onclick: () => edit(m) }, 'Edit'),
      h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', 'aria-label': `Remove ${m.name}`, onclick: () => remove(m) }, 'Remove')))));
}
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function bind() {
  form().addEventListener('submit', submit);
  $('#teamCancel').addEventListener('click', reset);
  $('#teamGenerate').addEventListener('click', () => {
    const pw = generatePassword();
    const input = form().elements.password;
    input.type = 'text'; input.value = pw;
    $('#teamPwToggle').textContent = 'Hide'; $('#teamPwToggle').setAttribute('aria-pressed', 'true');
    input.focus(); input.select();
    toast('Password created. Copy it now and give it to the team member privately.');
  });
  $('#teamPwToggle').addEventListener('click', (e) => {
    const input = form().elements.password, showIt = input.type === 'password';
    input.type = showIt ? 'text' : 'password';
    e.currentTarget.textContent = showIt ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(showIt));
  });
  reset();
}

// 20 characters from an alphabet without look-alikes, in groups of five
function generatePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(20));
  const chars = [...bytes].map((b) => abc[b % abc.length]).join('');
  return chars.match(/.{5}/g).join('-');
}

function reset() {
  editingId = null;
  form().reset();
  $('#teamTitle').textContent = 'Add a team member';
  $('#teamSave').textContent = 'Add team member';
  $('#teamCancel').hidden = true;
  $('#teamPwHint').textContent = 'At least 12 characters. Create one and share it privately; they can change it after signing in.';
  form().elements.active.checked = true;
  renderList();
}

function edit(m) {
  editingId = m.id;
  const f = form();
  f.elements.name.value = m.name;
  f.elements.email.value = m.email;
  f.elements.role.value = m.role;
  f.elements.active.checked = m.active;
  f.elements.password.value = '';
  $('#teamTitle').textContent = `Edit ${m.name}`;
  $('#teamSave').textContent = 'Save changes';
  $('#teamCancel').hidden = false;
  $('#teamPwHint').textContent = 'Leave blank to keep the current password. A new password, a new team or switching the account off signs them out everywhere.';
  renderList();
  f.elements.name.focus();
}

async function submit(e) {
  e.preventDefault();
  const f = form();
  const member = {
    id: editingId || undefined,
    name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), role: f.elements.role.value,
    active: f.elements.active.checked, password: f.elements.password.value,
  };
  const fail = (el, msg) => { toast(msg, 'error'); el.setAttribute('aria-invalid', 'true'); el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true }); el.focus(); };
  if (!member.name) return fail(f.elements.name, 'Give the team member a name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(member.email)) return fail(f.elements.email, 'Enter their work email address. Buyers\' replies go to it.');
  if (!member.role) return fail(f.querySelector('input[name=role]'), 'Choose the Agriculture team or the Packaging team.');
  if (!editingId && member.password.length < 12) return fail(f.elements.password, 'Set a first password of at least 12 characters.');
  if (editingId && member.password && member.password.length < 12) return fail(f.elements.password, 'The new password needs at least 12 characters.');
  const done = busy($('#teamSave'));
  try {
    const r = await api('/api/admin/team', { method: 'POST', body: { member } });
    const idx = members.findIndex((m) => m.id === r.member.id);
    if (idx >= 0) members[idx] = r.member; else members.push(r.member);
    toast(idx >= 0 ? `${r.member.name} saved.` : `${r.member.name} can now sign in at /team/${r.member.role === 'pack' ? 'packaging' : 'agriculture'}/.`);
    reset();
  } catch (x) { toast(x.message, 'error'); }
  finally { done(); }
}

async function remove(m) {
  const ok = await confirmDialog({ title: `Remove ${m.name}?`, body: 'They are signed out and can no longer open the workspace. Enquiries they handled keep their name. To pause an account instead, edit it and switch it off.', confirm: 'Remove' });
  if (!ok) return;
  try {
    await api(`/api/admin/team/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    members = members.filter((x) => x.id !== m.id);
    if (editingId === m.id) reset(); else renderList();
    toast(`${m.name} removed.`);
  } catch (e) { toast(e.message, 'error'); }
}

