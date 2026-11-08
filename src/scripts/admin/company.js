// Admin screen: company details (phones, emails, addresses).
import { $, api, toast, save } from './api.js';
import { fail } from './form-help.js';

const form = $('#companyForm');
let bound = false;

const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export async function show({ first }) {
  if (!bound) { bound = true; form.addEventListener('submit', submit); }
  if (!first && form.hasAttribute('data-dirty')) return; // keep unsaved typing when coming back
  try {
    const d = await api('/api/contact-details');
    form.elements.phones.value = (d.phones || []).join('\n');
    form.elements.emails.value = (d.emails || []).join('\n');
    for (const el of form.querySelectorAll('[name*="."]')) {
      const [group, key] = el.name.split('.');
      el.value = d[group]?.[key] ?? '';
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function submit(e) {
  e.preventDefault();
  const phones = lines(form.elements.phones.value), emails = lines(form.elements.emails.value);
  if (!phones.length) return fail(form.elements.phones, 'Add at least one phone number. The website uses the first one for calls and WhatsApp.');
  const badEmail = emails.find((m) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m));
  if (!emails.length) return fail(form.elements.emails, 'Add at least one email address.');
  if (badEmail) return fail(form.elements.emails, `"${badEmail}" does not look like an email address.`);
  const body = { phones, emails, address: {}, office: { label: 'Head Office' }, factory: { label: 'Processing Factory' } };
  for (const el of form.querySelectorAll('[name*="."]')) {
    const [group, key] = el.name.split('.');
    const v = el.value.trim();
    if (!v) continue;
    if (key === 'lat' || key === 'lng') {
      const n = Number(v), lim = key === 'lat' ? 90 : 180;
      if (!Number.isFinite(n) || Math.abs(n) > lim) return fail(el, `${key === 'lat' ? 'Latitude' : 'Longitude'} must be a number between -${lim} and ${lim}, for example ${key === 'lat' ? '9.0366' : '38.6364'}.`);
      body[group][key] = n;
    } else body[group][key] = v;
  }
  await save(form.querySelector('button[type=submit]'), async () => {
    await api('/api/contact-details', { method: 'POST', body });
  }, 'Company details saved. The website shows them now.');
}
