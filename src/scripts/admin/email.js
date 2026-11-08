// Admin screen: the mail account the site sends from, and a test message.
import { $, api, save } from './api.js';
import { bindOnce, invalid } from './form-help.js';

export async function showEmail() {
  const form = $('#emailForm');
  bindOnce('email', () => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n) => form.elements[n].value.trim();
    for (const [n, msg] of [['smtpHost', 'Enter the SMTP server, for example smtp.gmail.com.'], ['smtpPort', 'Enter the port, usually 587.'], ['smtpUser', 'Enter the sending account email.'], ['recipientEmail', 'Enter where enquiries should be sent.']]) {
      if (!v(n)) return invalid(form.elements[n], msg);
    }
    if (!/^\d{2,5}$/.test(v('smtpPort'))) return invalid(form.elements.smtpPort, 'The port is a number, usually 587 or 465.');
    const body = { smtpHost: v('smtpHost'), smtpPort: v('smtpPort'), smtpUser: v('smtpUser'), smtpPassword: form.elements.smtpPassword.value, recipientEmail: v('recipientEmail'), fromName: v('fromName') };
    await save(form.querySelector('button[type=submit]'), async () => {
      await api('/api/email-config', { method: 'POST', body });
      form.elements.smtpPassword.value = '';
      loadEmail();
    }, 'Email settings saved.');
  }));
  bindOnce('emailTest', () => $('#emailTest').addEventListener('click', testEmail));
  loadEmail();
}

/* the saved settings, tried for real: the mail server's answer is shown as it is */
async function testEmail() {
  const btn = $('#emailTest'), out = $('#emailTestResult');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending';
  out.hidden = false; out.className = 'a-test-result'; out.textContent = 'Sending a test email with the saved settings.';
  try {
    const r = await api('/api/admin/email-test', { method: 'POST', body: {} });
    out.className = 'a-test-result is-ok';
    out.textContent = `Sent to ${r.to}. Check that inbox: if it arrived, enquiries will too. If it is not there in a few minutes, look in spam.`;
  } catch (e) {
    out.className = 'a-test-result is-error';
    out.textContent = e.status === 400 ? e.message : `It did not send. The mail server answered: ${e.message}`;
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Send a test email';
  }
}
async function loadEmail() {
  const form = $('#emailForm'), state = $('#emailState');
  try {
    const c = await api('/api/email-config');
    for (const n of ['smtpHost', 'smtpPort', 'smtpUser', 'recipientEmail', 'fromName']) form.elements[n].value = c?.[n] ?? '';
    const ok = c?.smtpHost && c?.smtpUser && c?.recipientEmail;
    state.className = `a-status ${ok ? 'on' : 'off'}`;
    state.textContent = ok ? `Sending to ${c.recipientEmail}` : 'Not set up';
  } catch (e) {
    state.className = 'a-status off';
    state.textContent = 'Not set up';
  }
}
