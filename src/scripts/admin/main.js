// Admin entry: sign in, sign out and the section router (#overview, ...).
import '../common.js'; // theme toggle and the live logo
import { $, $$, api, getToken, setToken, whenSessionExpires, toast } from './api.js';
import * as overview from './overview.js';
import * as enquiries from './enquiries.js';
import * as products from './products.js';
import * as company from './company.js';
import * as settings from './settings.js';
import * as traffic from './traffic.js';
import * as store from './store.js';

const VIEWS = {
  overview: overview.show,
  traffic: traffic.show,
  enquiries: enquiries.show,
  products: products.show,
  company: company.show,
  certifications: company.showCertifications,
  logo: settings.showLogo,
  social: settings.showSocial,
  email: settings.showEmail,
  marketing: settings.showMarketing,
  security: settings.showSecurity,
};
const initialised = new Set();

const loginView = $('#loginView'), panel = $('#panel'), signOut = $('#signOut');

function showLogin(message) {
  panel.hidden = true; signOut.hidden = true; loginView.hidden = false;
  const err = $('#loginError');
  err.hidden = !message; err.textContent = message || '';
  $('#password').value = '';
  $('#password').focus();
}
function showPanel() {
  loginView.hidden = true; panel.hidden = false; signOut.hidden = false;
  route();
  enquiries.refreshBadge();
}

let expiredShown = false;
whenSessionExpires(() => {
  if (expiredShown) return;
  expiredShown = true;
  setToken(null);
  showLogin('Your session has ended. Sign in again to continue.');
});

function route() {
  if (panel.hidden) return;
  const requested = location.hash.slice(1).split('?')[0];
  const name = VIEWS[requested] ? requested : 'overview';
  // links keep the chosen period when moving between sections
  for (const a of $$('[data-nav]')) a.setAttribute('href', `#${a.dataset.nav}?days=${store.getDays()}`);
  for (const v of $$('[data-view]')) v.hidden = v.dataset.view !== name;
  for (const a of $$('[data-nav]')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $(`[data-nav="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const first = !initialised.has(name);
  initialised.add(name);
  VIEWS[name]({ first });
}
// charts are drawn at their real width, so redraw (from cache) after a real resize
let lastWidth = innerWidth, resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (Math.abs(innerWidth - lastWidth) > 40) { lastWidth = innerWidth; route(); } }, 250);
});
addEventListener('hashchange', () => {
  route();
  // move focus to the section heading so keyboard and screen reader users land in it
  if (!panel.hidden) { const hd = $('[data-view]:not([hidden]) h1'); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); scrollTo({ top: 0 }); } }
});

/* ---------- sign in ---------- */
$('#togglePass').addEventListener('click', (e) => {
  const input = $('#password'), show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(show));
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#password'), err = $('#loginError'), btn = e.currentTarget.querySelector('button[type=submit]');
  if (!input.value) { err.textContent = 'Enter the admin password.'; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  btn.disabled = true; btn.textContent = 'Signing in';
  try {
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      setToken(data.token); expiredShown = false; input.removeAttribute('aria-invalid');
      showPanel();
      return;
    }
    err.textContent = res.status === 429 ? (data.error || 'Too many attempts. Wait a few minutes and try again.')
      : res.status === 503 ? (data.error || 'Sign in is unavailable right now.')
      : res.status === 403 ? 'This sign in was blocked because it came from an unexpected address.'
      : 'That password is not right. Check it and try again.';
    err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.select();
  } catch (x) {
    err.textContent = 'Could not reach the server. Check the connection and try again.'; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

signOut.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  setToken(null);
  initialised.clear();
  showLogin();
  toast('Signed out.');
});

/* ---------- restore a session ---------- */
(async () => {
  if (!getToken()) return showLogin();
  try {
    const res = await fetch('/api/admin/verify', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) showPanel(); else { setToken(null); showLogin(); }
  } catch (e) { showLogin('Could not reach the server. Check the connection and try again.'); }
})();
