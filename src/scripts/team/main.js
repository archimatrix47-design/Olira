// Team workspace entry: session and the section router. Signing in happens once
// at /team/, which opens the workspace the account is on.
// A team member's session is kept under its own key; an administrator who is
// signed in to the admin panel can open either workspace with that session.
import '../common.js'; // theme toggle and the live logo
import '../admin/motion.js'; // keyboard or pointer, for motion decisions
import { $, $$, api, useTokenKey, getToken, setToken, readStoredToken, whenSessionExpires } from '../admin/api.js';
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

/** Hide the workspace and show the small card in its place. */
function showGate(note, label, onAction) {
  panel.hidden = true; signOut.hidden = true; backToAdmin.hidden = true; $('#teamUser').hidden = true;
  login.hidden = false;
  $('#teamGateNote').textContent = note;
  const action = $('#teamGateAction');
  action.textContent = label;
  action.onclick = onAction ? (e) => { e.preventDefault(); onAction(); } : null;
}

// Signing in lives at /team/, which sends the member straight back to the
// workspace their account is on. This page only ever hands over.
function toSignIn(reason) {
  useTokenKey(TEAM_KEY);
  showGate('Taking you to sign in.', 'Sign in');
  const q = new URLSearchParams({ next: location.pathname + location.hash });
  if (reason) q.set('m', reason);
  location.replace(`/team/?${q}`);
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
    // Only a rejected session sends them back to sign in. A network blip keeps
    // the session and offers another go, instead of logging them out.
    if (e.status === 401 || e.status === 403) { setToken(null); toSignIn(); }
    else showGate(e.message, 'Try again', () => location.reload());
  }
}

let expiredShown = false;
whenSessionExpires(() => {
  if (expiredShown) return;
  expiredShown = true;
  setToken(null);
  initialised.clear();
  toSignIn('expired');
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

signOut.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  setToken(null);
  initialised.clear();
  showGate('Signing you out.', 'Sign in');
  location.replace('/team/?m=signedout');
});

if (getToken()) start(); else toSignIn();
