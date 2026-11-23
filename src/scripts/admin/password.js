// Admin screen: changing the admin password.
import { $, api, save, setToken } from './api.js';
import { bindOnce, invalid } from './form-help.js';

/* ---------- password ---------- */
export function showSecurity() {
  bindOnce('security', () => $('#passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passForm = e.currentTarget, cur = $('#curPass'), a = $('#newPass'), b = $('#newPass2'), err = $('#passErr');
    if (!cur.value) return invalid(cur, 'Enter the current password.', err);
    if (a.value.length < 12) return invalid(a, 'Use at least 12 characters.', err);
    if (a.value !== b.value) return invalid(b, 'The two passwords do not match.', err);
    err.hidden = true;
    await save(passForm.querySelector('button[type=submit]'), async () => {
      const r = await api('/api/admin/change-password', { method: 'POST', body: { currentPassword: cur.value, newPassword: a.value } });
      if (r?.token) setToken(r.token); // older sessions have ended; this device stays signed in
      passForm.reset();
    }, 'Password changed. Any other device signed in as the admin has been signed out.');
  }));
}
