// Team workspace entry: sign in, session, the section router.
// A team member's session is kept under its own key; an administrator who is
// signed in to the admin panel can open the workspace with that session.
import '../common.js'; // theme toggle and the live logo
import '../admin/motion.js'; // keyboard or pointer, for motion decisions
import { $, $$, api, useTokenKey, getToken, setToken, readStoredToken, whenSessionExpires, toast } from '../admin/api.js';
import * as inbox from './inbox.js';
import * as lists from './lists.js';
import * as account from './account.js';
import { session } from './session.js';

const LINE = document.body.dataset.line;               // 'agri' | 'pack'
const PAGE = { agri: '/team/agriculture/', pack: '/team/packaging/' };
const VIEWS = {
  inbox: inbox.show,
  followups: lists.showFollowups,
  quotes: lists.showQuotes,
  account: account.show,
};
if (LINE === 'pack') VIEWS.mockups = (opts) => import('./mockups.js').then((m) => m.show(opts));

const login = $('#teamLogin'), panel = $('#teamPanel'), signOut = $('#teamSignOut'), backToAdmin = $('#backToAdmin');
const initialised = new Set();

// the team session wins; otherwise an admin session may be used
const TEAM_KEY = 'teamToken';
const usingAdmin = !readStoredToken(TEAM_KEY) && !!readStoredToken('adminToken');
useTokenKey(usingAdmin ? 'adminToken' : TEAM_KEY);

function showLogin(message) {
  useTokenKey(TEAM_KEY);
  panel.hidden = true; signOut.hidden = true; backToAdmin.hidden = true; $('#teamUser').hidden = true;
  login.hidden = false;
  const err = $('#tLoginError');
  err.hidden = !message; err.textContent = message || '';
  $('#tPass').value = '';
  ($('#tEmail').value ? $('#tPass') : $('#tEmail')).focus();
}

async function start() {
  try {
    const me = await api('/api/team/me');
    const role = me.user.role;
    if (role !== 'admin' && role !== LINE) {
      // a member of the other team: take them to their own workspace
      location.replace(PAGE[role] + location.hash);
      return;
    }
    Object.assign(session, { user: me.user, members: me.members, line: LINE, isAdmin: role === 'admin' });
    const chip = $('#teamUser');
    chip.textContent = role === 'admin' ? 'Administrator' : me.user.name;
    chip.hidden = false;
    signOut.hidden = role === 'admin';
    backToAdmin.hidden = role !== 'admin';
    login.hidden = true; panel.hidden = false;
    route();
    inbox.refreshCounts();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { setToken(null); showLogin(); }
    else showLogin(e.message);
  }
}

let expiredShown = false;
whenSessionExpires(() => {
  if (expiredShown) return;
  expiredShown = true;
  setToken(null);
  initialised.clear();
  showLogin('Your session has ended. Sign in again to continue.');
});

function route() {
  if (panel.hidden) return;
  const [requested] = location.hash.slice(1).split('?');
  const name = VIEWS[requested] ? requested : 'inbox';
  for (const v of $$('[data-view]')) v.hidden = v.dataset.view !== name;
  for (const a of $$('[data-nav]')) { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  // on a phone the section tabs scroll sideways: keep the current one in view
  $(`[data-nav="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const first = !initialised.has(name);
  initialised.add(name);
  VIEWS[name]({ first, params: new URLSearchParams(location.hash.split('?')[1] || '') });
}
addEventListener('hashchange', () => {
  const prevView = document.querySelector('[data-view]:not([hidden])')?.dataset.view;
  route();
  const now = document.querySelector('[data-view]:not([hidden])')?.dataset.view;
  // moving to another section: focus its heading; opening a lead inside the inbox is handled there
  if (!panel.hidden && prevView !== now) { const hd = $('[data-view]:not([hidden]) h1'); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); scrollTo({ top: 0 }); } }
});

/* ---------- sign in ---------- */
$('#tTogglePass').addEventListener('click', (e) => {
  const input = $('#tPass'), showIt = input.type === 'password';
  input.type = showIt ? 'text' : 'password';
  e.currentTarget.textContent = showIt ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(showIt));
});
$('#teamLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#tEmail').value.trim(), password = $('#tPass').value, err = $('#tLoginError');
  const btn = e.currentTarget.querySelector('button[type=submit]');
  if (!email || !password) { err.textContent = 'Enter your work email and password.'; err.hidden = false; (email ? $('#tPass') : $('#tEmail')).focus(); return; }
  btn.disabled = true; btn.textContent = 'Signing in';
  try {
    const res = await fetch('/api/team/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      useTokenKey(TEAM_KEY); setToken(data.token); expiredShown = false;
      await start();
      return;
    }
    err.textContent = data.error || (res.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That email and password do not match.');
    err.hidden = false; $('#tPass').select();
  } catch (x) {
    err.textContent = 'Could not reach the server. Check the connection and try again.'; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});

signOut.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  setToken(null);
  initialised.clear();
  showLogin();
  toast('Signed out.');
});

if (getToken()) start(); else showLogin();
