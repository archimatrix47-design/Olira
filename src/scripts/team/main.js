// Workspace entry: session and the section router. Signing in happens once at
// /team/, which opens the workspace the account's role belongs to: the
// agriculture team, the packaging team, or the manager. The administrator's
// session does not open a workspace; the admin panel is for running the site.
import '../common.js'; // theme toggle and the live logo
import '../admin/motion.js'; // keyboard or pointer, for motion decisions
import { $, $$, api, useTokenKey, getToken, setToken, whenSessionExpires } from '../admin/api.js';
import * as inbox from './inbox.js';
import * as lists from './lists.js';
import * as account from './account.js';
import * as store from '../admin/store.js';
import { session } from './session.js';
import { initShell, watch } from '../admin/tools.js';

const LINE = document.body.dataset.line;               // 'agri' | 'pack' | 'manager'
const PAGE = { agri: '/team/agriculture/', pack: '/team/packaging/', manager: '/team/manager/' };
const VIEWS = {
  inbox: inbox.show,
  followups: lists.showFollowups,
  quotes: lists.showQuotes,
  account: account.show,
  buyers: (opts) => import('./buyers.js').then((m) => m.show(opts)),
};
if (LINE === 'manager') {
  Object.assign(VIEWS, {
    dashboard: (opts) => import('./manager/dashboard.js').then((m) => m.show(opts)),
    pipeline: (opts) => import('./manager/pipeline.js').then((m) => m.show(opts)),
    people: (opts) => import('./manager/people.js').then((m) => m.show(opts)),
    report: (opts) => import('./manager/report.js').then((m) => m.show(opts)),
    traffic: (opts) => import('./manager/traffic.js').then((m) => m.show(opts)),
    products: (opts) => import('./manager/products.js').then((m) => m.show(opts)),
  });
} else {
  VIEWS.social = () => import('./social.js').then((m) => m.show());
  VIEWS.partners = () => import('./partners.js').then((m) => m.show());
}
if (LINE === 'agri') VIEWS.products = (opts) => import('./agri-products.js').then((m) => m.show(opts));
if (LINE === 'pack') {
  VIEWS.products = (opts) => import('./pack-products.js').then((m) => m.show(opts));
  VIEWS.mockups = (opts) => import('./mockups.js').then((m) => m.show(opts));
  VIEWS.minimums = () => import('./minimums.js').then((m) => m.show());
}
const HOME = LINE === 'manager' ? 'dashboard' : 'inbox';

const login = $('#teamLogin'), panel = $('#teamPanel'), signOut = $('#teamSignOut');
const initialised = new Set();
const shell = initShell({ panel, route: () => route() });
// every settings form and editor says when it has unsaved changes
$$('#teamPanel form.a-form, #teamPanel form.t-min').forEach(watch);

const TEAM_KEY = 'teamToken';
useTokenKey(TEAM_KEY);

/** Hide the workspace and show the small card in its place. */
function showGate(note, label, onAction) {
  panel.hidden = true; signOut.hidden = true; $('#teamUser').hidden = true;
  login.hidden = false;
  $('#teamGateNote').textContent = note;
  const action = $('#teamGateAction');
  action.textContent = label;
  action.onclick = onAction ? (e) => { e.preventDefault(); onAction(); } : null;
}

// Signing in lives at /team/, which sends the person straight back to the
// workspace their account is on. This page only ever hands over.
function toSignIn(reason) {
  showGate('Taking you to sign in.', 'Sign in');
  const q = new URLSearchParams({ next: location.pathname + location.hash });
  if (reason) q.set('m', reason);
  location.replace(`/team/?${q}`);
}

async function start() {
  try {
    const me = await api('/api/team/me');
    const role = me.user.role;
    if (role !== LINE) {
      // another role's page, for example a link from a notification email:
      // open the same place in the workspace this account belongs to
      if (PAGE[role] && location.pathname !== PAGE[role]) { location.replace(PAGE[role] + location.hash); return; }
      if (!PAGE[role]) { setToken(null); toSignIn(); return; }
      // already on the right page but it does not say which workspace it is: stop, never loop
      showGate('This workspace could not start. Reload the page.', 'Reload', () => location.reload());
      return;
    }
    Object.assign(session, { user: me.user, members: me.members, line: LINE, oversees: role === 'manager' });
    const chip = $('#teamUser');
    chip.textContent = me.user.name;
    chip.hidden = false;
    signOut.hidden = false;
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
  // the manager's numbers keep the chosen period when moving between sections
  if (LINE === 'manager') for (const a of $$('[data-nav]')) a.setAttribute('href', `#${a.dataset.nav}?days=${store.getDays()}`);
  // on a phone, the list of sections
  if (shell.menu(requested)) return;
  const name = VIEWS[requested] ? requested : HOME;
  for (const v of $$('[data-view]')) v.hidden = v.dataset.view !== name;
  for (const a of $$('[data-nav]')) { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  // on a phone the section tabs scroll sideways: keep the current one in view
  $(`[data-nav="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const first = !initialised.has(name);
  initialised.add(name);
  VIEWS[name]({ first, params: new URLSearchParams(location.hash.split('?')[1] || '') });
}
// charts are drawn at their real width, so redraw (from cache) after a real resize
let lastWidth = innerWidth, resizeTimer;
if (LINE === 'manager') addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const now = document.querySelector('[data-view]:not([hidden])')?.dataset.view;
    if (Math.abs(innerWidth - lastWidth) > 40 && ['dashboard', 'report', 'traffic', 'people', 'products'].includes(now)) { lastWidth = innerWidth; route(); }
  }, 250);
});
addEventListener('hashchange', () => {
  const prevView = document.querySelector('[data-view]:not([hidden])')?.dataset.view || 'menu';
  route();
  const now = document.querySelector('[data-view]:not([hidden])')?.dataset.view || 'menu';
  // moving to another section: focus its heading; opening a lead inside the inbox is handled there
  if (!panel.hidden && prevView !== now) {
    const hd = now === 'menu' ? $('.a-nav-link[aria-current="page"]') || $('.a-nav-link') : $('[data-view]:not([hidden]) h1');
    if (hd) { if (hd.tagName === 'H1') hd.tabIndex = -1; hd.focus({ preventScroll: true }); scrollTo({ top: 0 }); }
  }
});

signOut.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  setToken(null);
  initialised.clear();
  showGate('Signing you out.', 'Sign in');
  location.replace('/team/?m=signedout');
});

if (getToken()) start(); else toSignIn();
