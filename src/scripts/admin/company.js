// Company details (phones, emails, addresses) and certifications.
import { $, h, api, toast, confirmDialog, save, uploadImage } from './api.js';

const form = $('#companyForm');
let bound = false;

const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export async function show({ first }) {
  if (!bound) { bound = true; form.addEventListener('submit', submit); }
  if (!first && form.dataset.dirty) return; // keep unsaved typing when coming back
  try {
    const d = await api('/api/contact-details');
    form.elements.phones.value = (d.phones || []).join('\n');
    form.elements.emails.value = (d.emails || []).join('\n');
    for (const el of form.querySelectorAll('[name*="."]')) {
      const [group, key] = el.name.split('.');
      el.value = d[group]?.[key] ?? '';
    }
    delete form.dataset.dirty;
    form.addEventListener('input', () => { form.dataset.dirty = '1'; }, { once: true });
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
    delete form.dataset.dirty;
    form.addEventListener('input', () => { form.dataset.dirty = '1'; }, { once: true });
  }, 'Company details saved. The website shows them now.');
}

function fail(el, msg) {
  toast(msg, 'error');
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
  el.focus();
}

/* ---------- certifications ---------- */
let certBound = false;
export async function showCertifications() {
  if (!certBound) { certBound = true; $('#certForm').addEventListener('submit', addCert); }
  loadCerts();
}

async function loadCerts() {
  try { renderCerts(await api('/api/certifications')); } catch (e) { toast(e.message, 'error'); }
}

function renderCerts(list) {
  const ul = $('#certList');
  if (!Array.isArray(list) || !list.length) {
    ul.replaceChildren(h('li', { class: 'a-empty', style: 'display:block' }, h('strong', {}, 'None listed'), 'The certifications line is hidden on the website until you add one.'));
    return;
  }
  ul.replaceChildren(...list.map((c) => h('li', {},
    c.image ? h('img', { src: c.image, alt: '' }) : null,
    h('div', { class: 'grow' }, h('strong', {}, c.name), h('span', {}, c.description || '')),
    h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', 'aria-label': `Delete ${c.name}`, onclick: () => removeCert(c) }, 'Delete'))));
}

async function addCert(e) {
  e.preventDefault();
  const f = e.currentTarget, name = f.elements.name.value.trim(), description = f.elements.description.value.trim();
  if (!name) return fail(f.elements.name, 'Give the certification a name.');
  if (!description) return fail(f.elements.description, 'Add a short description, for example what the standard covers.');
  const file = $('#certImage').files[0];
  await save(f.querySelector('button[type=submit]'), async () => {
    let image = null;
    if (file) image = (await uploadImage(file, `cert-${name}`)).path;
    await api('/api/certifications', { method: 'POST', body: { certification: { name, description, image } } });
    f.reset();
    await loadCerts();
  }, `${name} added.`);
}

async function removeCert(c) {
  const ok = await confirmDialog({ title: `Delete ${c.name}?`, body: 'It is removed from the agriculture page straight away.' });
  if (!ok) return;
  try {
    await api(`/api/certifications/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    toast(`${c.name} deleted.`);
    loadCerts();
  } catch (e) { toast(e.message, 'error'); }
}
