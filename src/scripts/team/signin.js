// The single sign in for both marketing workspaces.
// The server returns the member's role, set by the administrator on the account,
// and that decides which workspace opens. Nobody has to know which link to pick.
import '../common.js'; // theme toggle and the live logo
import '../admin/motion.js'; // keyboard or pointer, for motion decisions
import { $, api, useTokenKey, setToken, readStoredToken } from '../admin/api.js';

const PAGE = { agri: '/team/agriculture/', pack: '/team/packaging/' };
const TEAM_KEY = 'teamToken';

const form = $('#teamLoginForm'), choice = $('#adminChoice'), busy = $('#signinBusy'), err = $('#tLoginError');
const q = new URLSearchParams(location.search);

/** Where a workspace sent us back from, honoured only when the role may open it. */
function destination(role) {
  const next = q.get('next');
  const safe = next && next.startsWith('/team/') && !next.startsWith('//');
  if (safe && (role === 'admin' || next.startsWith(PAGE[role]))) return next;
  return PAGE[role] || '/admin/#enquiries';
}

function showForm(message) {
  busy.hidden = true; choice.hidden = true; form.hidden = false;
  err.hidden = !message; err.textContent = message || '';
  ($('#tEmail').value ? $('#tPass') : $('#tEmail')).focus();
}
/** A calm line above the fields: signing out is not an error. */
function showNote(text) {
  const note = $('#signinNote');
  note.hidden = !text; note.textContent = text || '';
}
function showChoice() {
  busy.hidden = true; form.hidden = true; choice.hidden = false;
  choice.querySelector('a').focus();
}

const startMessage = q.get('m') === 'expired' ? 'Your session has ended. Sign in again to continue.' : '';
if (q.get('m') === 'signedout') showNote('You are signed out.');

/* ---------- already signed in? then this page is a pass through ---------- */
async function resume() {
  if (readStoredToken(TEAM_KEY)) {
    useTokenKey(TEAM_KEY);
    try {
      const me = await api('/api/team/me');
      location.replace(destination(me.user.role));
      return;
    } catch (e) {
      setToken(null); // the token is stale, fall through to the form
    }
  }
  // an administrator signed in to the admin panel may open either workspace
  if (readStoredToken('adminToken')) { showChoice(); return; }
  showForm(startMessage);
}
useTokenKey(TEAM_KEY);
resume();

$('#notMe').addEventListener('click', () => showForm(''));

/* ---------- sign in ---------- */
$('#tTogglePass').addEventListener('click', (e) => {
  const input = $('#tPass'), showIt = input.type === 'password';
  input.type = showIt ? 'text' : 'password';
  e.currentTarget.textContent = showIt ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(showIt));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#tEmail').value.trim(), password = $('#tPass').value;
  const btn = form.querySelector('button[type=submit]');
  if (!email || !password) {
    err.textContent = 'Enter your work email and password.'; err.hidden = false;
    (email ? $('#tPass') : $('#tEmail')).focus();
    return;
  }
  btn.disabled = true; btn.textContent = 'Signing in';
  try {
    const res = await fetch('/api/team/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      useTokenKey(TEAM_KEY); setToken(data.token);
      // straight into the workspace the administrator put this account on
      location.replace(destination(data.member?.role));
      return;
    }
    err.textContent = data.error || (res.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That email and password do not match.');
    err.hidden = false; $('#tPass').select();
  } catch (x) {
    err.textContent = 'Could not reach the server. Check the connection and try again.'; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});
