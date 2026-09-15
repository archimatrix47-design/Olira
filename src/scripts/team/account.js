// My account: who is signed in, and changing the password.
import { $, h, api, setToken, toast, busy } from '../admin/api.js';
import { session } from './session.js';

let bound = false;
export function show() {
  const u = session.user;
  $('#accountProfile').replaceChildren(
    ...[['Name', u.name], ['Email', u.email || 'Not set'], ['Team', u.roleLabel]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
  const form = $('#accountPassForm');
  form.hidden = session.isAdmin;
  if (session.isAdmin) return;
  if (bound) return;
  bound = true;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('#apCurrent'), next = $('#apNew'), again = $('#apNew2'), err = $('#apErr');
    const fail = (el, msg) => { err.textContent = msg; err.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); };
    [cur, next, again].forEach((el) => el.removeAttribute('aria-invalid')); err.hidden = true;
    if (!cur.value) return fail(cur, 'Enter your current password.');
    if (next.value.length < 12) return fail(next, 'The new password needs at least 12 characters.');
    if (next.value !== again.value) return fail(again, 'The two new passwords do not match.');
    const done = busy(form.querySelector('button[type=submit]'));
    try {
      const r = await api('/api/team/password', { method: 'POST', body: { current: cur.value, next: next.value } });
      setToken(r.token);
      form.reset();
      toast('Password changed. You stay signed in here; other devices are signed out.');
    } catch (x) { fail(cur, x.message); }
    finally { done(); }
  });
}
