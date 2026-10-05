// Company details (phones, emails, addresses) and certifications with proof.
import { $, h, api, toast, confirmDialog, save } from './api.js';
import { mayLeave, touch } from './tools.js';

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

function fail(el, msg) {
  toast(msg, 'error');
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
  el.focus();
}

/* ---------- certifications, with proof ---------- */
// Each certification carries the certificate itself (lib/certificates.js). The
// list says where each stands; the editor beside it holds the details and the file.
let certBound = false;
let certs = [];
let editingCert = null;
const certForm = () => $('#certForm');
const certField = (n) => certForm().elements.namedItem(n);

export const CERT_STATUS = {
  valid: ['On the website, with the certificate', 'ok'],
  expiring: ['Expires soon', 'warn'],
  expired: ['Expired, taken off the website', 'warn'],
  'no-proof': ['No certificate uploaded', 'warn'],
};
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export async function showCertifications() {
  if (!certBound) {
    certBound = true;
    certForm().addEventListener('submit', saveCert);
    $('#certNew').addEventListener('click', async () => { if (await mayLeave(certForm(), 'the changes to this certification')) { resetCert(); certField('name').focus(); } });
    $('#certCancel').addEventListener('click', async () => { if (await mayLeave(certForm(), 'the changes to this certification')) resetCert(); });
    $('#certDelete').addEventListener('click', () => editingCert && removeCert(editingCert));
    $('#certFile').addEventListener('change', uploadProof);
  }
  await loadCerts();
}

async function loadCerts() {
  try { certs = await api('/api/certifications'); renderCerts(); } catch (e) { toast(e.message, 'error'); }
}

function renderCerts() {
  const ul = $('#certList');
  const count = (st) => certs.filter((c) => c.status === st).length;
  const gaps = count('no-proof') + count('expired') + count('expiring');
  $('#certSummary').textContent = certs.length
    ? `${certs.length} ${certs.length === 1 ? 'certification' : 'certifications'}: ${count('valid') + count('expiring')} with the certificate on the website${gaps ? `, ${gaps} need attention` : ''}.`
    : '';
  if (!certs.length) {
    ul.replaceChildren(h('li', { class: 'a-empty', style: 'display:block' }, h('strong', {}, 'None listed'), 'The certifications are hidden on the website until you add one.'));
    return;
  }
  const order = { expired: 0, 'no-proof': 1, expiring: 2, valid: 3 };
  ul.replaceChildren(...certs.slice().sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)).map((c) => {
    const [label, tone] = CERT_STATUS[c.status] || ['', ''];
    const when = c.status === 'expiring' ? `in ${c.daysLeft} ${c.daysLeft === 1 ? 'day' : 'days'}, ${fmtDate(c.validUntil)}` : c.validUntil ? `Valid until ${fmtDate(c.validUntil)}` : 'No expiry date set';
    return h('li', { class: editingCert?.id === c.id ? 'is-editing' : '' },
      h('div', { class: 'grow' },
        h('strong', {}, c.name),
        h('span', {}, [c.issuer, c.number ? `No. ${c.number}` : ''].filter(Boolean).join(', ') || c.description || ''),
        h('span', { class: 'a-row-meta' }, h('span', { class: `a-tag ${tone === 'ok' ? 'stage-won' : 'warn'}` }, label), when,
          c.file ? h('a', { href: c.file, target: '_blank', rel: 'noopener' }, 'Open certificate') : null)),
      h('div', { class: 'a-row-actions' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Edit ${c.name}`, onclick: () => editCert(c) }, 'Edit')));
  }));
}

function showProof(file) {
  certField('file').value = file || '';
  const now = $('#certFileNow');
  now.hidden = !file;
  now.replaceChildren(...(file ? ['Certificate on file: ', h('a', { href: file, target: '_blank', rel: 'noopener' }, file.endsWith('.pdf') ? 'open the PDF' : 'open the scan'), '. Upload another to replace it.'] : []));
  $('#certDropTitle').textContent = file ? 'Replace the certificate' : 'Upload the certificate';
}

function resetCert() {
  editingCert = null;
  certForm().reset();
  certField('id').value = '';
  showProof(null);
  $('#certTitle').textContent = 'Add a certification';
  $('#certSave').textContent = 'Add certification';
  $('#certCancel').hidden = true;
  $('#certDangerZone').hidden = true;
  certForm().dispatchEvent(new Event('saved'));
  renderCerts();
}

async function editCert(c) {
  if (!(await mayLeave(certForm(), 'the changes to this certification'))) return;
  editingCert = c;
  for (const k of ['id', 'name', 'description', 'issuer', 'number', 'validFrom', 'validUntil', 'scope', 'verifyUrl']) certField(k).value = c[k] || '';
  showProof(c.file);
  $('#certTitle').textContent = `Edit ${c.name}`;
  $('#certSave').textContent = 'Save changes';
  $('#certCancel').hidden = false;
  $('#certDangerZone').hidden = false;
  certForm().dispatchEvent(new Event('saved'));
  renderCerts();
  certField('name').focus();
}

async function uploadProof(e) {
  const input = e.currentTarget, file = input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return toast('The certificate can be up to 10 MB.', 'error');
  const title = $('#certDropTitle'), was = title.textContent;
  title.textContent = 'Uploading';
  try {
    const fd = new FormData(); fd.append('file', file); fd.append('name', certField('name').value || 'certificate');
    const r = await api('/api/certifications/file', { method: 'POST', form: fd });
    showProof(r.path);
    touch(certForm());
    toast('Certificate uploaded. Save to put it on the website.');
  } catch (x) { title.textContent = was; toast(x.message, 'error'); }
}

async function saveCert(e) {
  e.preventDefault();
  const certification = Object.fromEntries(['id', 'name', 'description', 'issuer', 'number', 'validFrom', 'validUntil', 'scope', 'verifyUrl', 'file'].map((k) => [k, certField(k).value.trim()]));
  if (!certification.id) delete certification.id;
  if (!certification.name) return fail(certField('name'), 'Give the certification its name, for example "ISO 22000:2018".');
  if (certification.validFrom && certification.validUntil && certification.validUntil < certification.validFrom) return fail(certField('validUntil'), '"Valid until" is before "valid from".');
  if (certification.verifyUrl && !/^https:\/\//i.test(certification.verifyUrl)) return fail(certField('verifyUrl'), 'The register link must start with https://');
  const r = await save($('#certSave'), () => api('/api/certifications', { method: 'POST', body: { certification } }),
    certification.file ? `${certification.name} saved. Buyers can open the certificate on the website.` : `${certification.name} saved. Upload the certificate so buyers can check it.`);
  if (!r) return;
  await loadCerts();
  const saved = certs.find((c) => c.id === r.certification.id);
  certForm().dispatchEvent(new Event('saved'));
  if (saved) editCert(saved); else resetCert();
}

async function removeCert(c) {
  const ok = await confirmDialog({ title: `Delete ${c.name}?`, body: 'It is removed from the website straight away, with its certificate file.' });
  if (!ok) return;
  try {
    await api(`/api/certifications/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    toast(`${c.name} deleted.`);
    certForm().dispatchEvent(new Event('saved'));
    resetCert();
    await loadCerts();
  } catch (e) { toast(e.message, 'error'); }
}
