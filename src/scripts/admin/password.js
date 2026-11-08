// Admin screen: changing the admin password.
import { $, api, save } from './api.js';
import { bindOnce, invalid } from './form-help.js';

/* ---------- password ---------- */
export function showSecurity() {
  bindOnce('security', () => $('#passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passForm = e.currentTarget, a = $('#newPass'), b = $('#newPass2'), err = $('#passErr');
    if (a.value.length < 12) return invalid(a, 'Use at least 12 characters.', err);
    if (a.value !== b.value) return invalid(b, 'The two passwords do not match.', err);
    err.hidden = true;
    await save(passForm.querySelector('button[type=submit]'), async () => {
      await api('/api/admin/change-password', { method: 'POST', body: { newPassword: a.value } });
      passForm.reset();
    }, 'Password changed. Use the new one next time you sign in.');
  }));
}
