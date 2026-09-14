// Logo, social links, email delivery, marketing tags and password.
import { $, $$, api, toast, save } from './api.js';

const once = new Set();
const bindOnce = (key, fn) => { if (!once.has(key)) { once.add(key); fn(); } };
function invalid(el, msg, errEl) {
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); if (errEl) errEl.hidden = true; }, { once: true });
  if (errEl) { errEl.textContent = msg; errEl.hidden = false; } else toast(msg, 'error');
  el.focus();
}

/* ---------- logo ---------- */
export async function showLogo() {
  bindOnce('logo', () => {
    const file = $('#logoFile'), drop = $('#logoDrop');
    const pick = (f) => {
      if (!f) return;
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) { toast('Choose a PNG, JPG, WebP or SVG file.', 'error'); return; }
      if (f.size > 10 * 1024 * 1024) { toast('That file is over 10 MB.', 'error'); return; }
      const dt = new DataTransfer(); dt.items.add(f); file.files = dt.files;
      $('#logoPreview').src = URL.createObjectURL(f);
      $('#logoPreviewBox').hidden = false;
      $('#logoDropTitle').textContent = f.name;
    };
    file.addEventListener('change', () => pick(file.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

    $('#logoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const logoForm = e.currentTarget, f = file.files[0];
      if (!f) return toast('Choose a logo file first.', 'error');
      const fd = new FormData(); fd.append('logo', f);
      await save(logoForm.querySelector('button[type=submit]'), async () => {
        await api('/api/upload/logo', { method: 'POST', form: fd });
        logoForm.reset();
        $('#logoPreviewBox').hidden = true; $('#logoDropTitle').textContent = 'Choose or drop a file';
        await loadLogo();
      }, 'Logo saved. The website shows it now.');
    });
    $('#logoReset').addEventListener('click', (e) => save(e.currentTarget, async () => {
      await api('/api/branding', { method: 'POST', body: { logo: null } });
      await loadLogo();
    }, 'The original logo is back on the website.'));
  });
  loadLogo();
}
async function loadLogo() {
  try {
    const b = await api('/api/branding');
    const custom = b?.logo;
    $('#logoCurrent').src = custom ? `${custom}?t=${Date.now()}` : '/logo.png';
    $('#logoSource').textContent = custom ? 'An uploaded logo is in use.' : 'The original logo that ships with the website is in use.';
    $('#logoReset').hidden = !custom;
    $$('img[data-brand-logo]').forEach((img) => { img.src = custom || '/logo.png'; });
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- social ---------- */
export async function showSocial() {
  const form = $('#socialForm');
  bindOnce('social', () => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const el of form.querySelectorAll('input')) {
      const v = el.value.trim();
      if (v && !/^https?:\/\/\S+$/i.test(v)) return invalid(el, `${el.labels[0].textContent} must be a full link starting with https://`, $('#socialErr'));
      body[el.name] = v;
    }
    $('#socialErr').hidden = true;
    await save(form.querySelector('button[type=submit]'), () => api('/api/social-links', { method: 'POST', body }), 'Social links saved.');
  }));
  try {
    const d = await api('/api/social-links');
    for (const el of form.querySelectorAll('input')) el.value = d?.[el.name] || '';
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- email ---------- */
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
  loadEmail();
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

/* ---------- marketing ---------- */
export async function showMarketing() {
  bindOnce('marketing', () => {
    $('#gaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, id = f.elements.measurementId.value.trim().toUpperCase();
      if (id && !/^G-[A-Z0-9]{10}$/.test(id)) return invalid(f.elements.measurementId, 'A Measurement ID looks like G-ABC123DEF4 (G, a dash and 10 letters or digits).');
      await save(f.querySelector('button[type=submit]'), async () => {
        await api('/api/integrations/analytics', { method: 'POST', body: { measurementId: id, propertyId: f.elements.propertyId.value.trim() } });
        loadMarketing();
      }, id ? 'Google Analytics is on.' : 'Google Analytics is off.');
    });
    $('#adsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, id = f.elements.conversionId.value.trim();
      if (id && !/^\d{10}$/.test(id)) return invalid(f.elements.conversionId, 'A Conversion ID is 10 digits.');
      const value = f.elements.conversionValue.value.trim();
      if (value && !(Number(value) >= 0)) return invalid(f.elements.conversionValue, 'The value is a number, for example 10.');
      await save(f.querySelector('button[type=submit]'), async () => {
        await api('/api/integrations/ads', { method: 'POST', body: { conversionId: id, conversionLabel: f.elements.conversionLabel.value.trim(), conversionValue: value || 10 } });
        loadMarketing();
      }, id ? 'Google Ads conversions are on.' : 'Google Ads conversions are off.');
    });
  });
  loadMarketing();
}
async function loadMarketing() {
  try {
    const c = await api('/api/integrations');
    const ga = $('#gaForm').elements, ads = $('#adsForm').elements;
    ga.measurementId.value = c?.analytics?.measurementId || '';
    ga.propertyId.value = c?.analytics?.propertyId || '';
    ads.conversionId.value = c?.ads?.conversionId || '';
    ads.conversionLabel.value = c?.ads?.conversionLabel || '';
    ads.conversionValue.value = c?.ads?.conversionValue ?? '';
    const set = (el, on, text) => { el.className = `a-status ${on ? 'on' : ''}`; el.textContent = text; };
    set($('#gaState'), !!ga.measurementId.value, ga.measurementId.value ? `On, ${ga.measurementId.value}` : 'Off');
    set($('#adsState'), !!ads.conversionId.value, ads.conversionId.value ? 'On' : 'Off');
  } catch (e) { toast(e.message, 'error'); }
}

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
