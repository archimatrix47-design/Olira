// Certifications on the public pages (CertList.astro builds the same markup into
// the page): refreshed from the live API, so a certificate uploaded or renewed
// in the admin shows without a rebuild, and one that has just expired comes off.
// "Copy on request" fills in the enquiry form.
import { $$, h, getJSON, prefill } from './common.js';
import { askFor, certRequest } from './cert-ask.js';

const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function item(c, askHref) {
  const meta = [c.issuer ? `Issued by ${c.issuer}` : '', c.number ? `certificate no. ${c.number}` : '', c.validUntil ? `valid until ${fmt(c.validUntil)}` : ''].filter(Boolean).join(', ');
  const acts = h('span', { class: 'cert-acts' });
  if (c.file) acts.append(h('a', { href: c.file, target: '_blank', rel: 'noopener', 'aria-label': `View the ${c.name} certificate (${c.fileType === 'pdf' ? 'PDF' : 'image'}, opens in a new tab)` }, 'View certificate'));
  else acts.append(h('a', { href: askFor(askHref, c.name), 'data-ask-cert': c.name, 'aria-label': `Ask for a copy of the ${c.name} certificate` }, 'Copy on request'));
  if (c.verifyUrl) acts.append(h('a', { href: c.verifyUrl, target: '_blank', rel: 'noopener', 'aria-label': `Check ${c.name} with ${c.issuer || 'the issuer'} (opens in a new tab)` }, 'Check with the issuer'));
  const body = h('span', { class: 'cert-body' });
  if (c.description) body.append(h('span', {}, c.description));
  if (meta) body.append(h('span', { class: 'cert-meta' }, `${meta[0].toUpperCase()}${meta.slice(1)}.`));
  body.append(acts);
  const li = h('li', { class: 'cert' });
  li.append(h('b', {}, c.name), body);
  return li;
}

const lists = $$('[data-certs] ul');
if (lists.length) {
  getJSON('/api/certifications').then((all) => {
    if (!Array.isArray(all)) return;
    const shown = all.filter((c) => c.status !== 'expired');
    for (const ul of lists) {
      ul.replaceChildren(...shown.map((c) => item(c, ul.dataset.askHref || '#contact')));
      ul.closest('[data-certs]').hidden = shown.length === 0;
    }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ask-cert]');
    if (!a || !a.getAttribute('href').startsWith('#')) return;
    prefill(certRequest(a.dataset.askCert));
    // show the request where it was written (on a phone the form is long and the
    // message is far below its heading); the cursor goes there for a keyboard or mouse
    const m = document.querySelector('#message');
    if (!m) return;
    e.preventDefault();
    m.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (e.detail === 0 || matchMedia('(pointer: fine)').matches) m.focus({ preventScroll: true });
  });
}
