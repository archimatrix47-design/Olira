// Shared by every public page: theme toggle, sticky nav, one-time section fade,
// Burayu contours, live admin data (contacts, logo, social links) and the
// enquiry forms.
import { reveal } from './reach.js';
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = (sel, r = document) => r.querySelector(sel);
export const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
export const h = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
export const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** First-party analytics event (the admin dashboard's product interest). */
export function track(body) {
  const { event, ...data } = body;
  try { window.oliraTrack?.(event, data); } catch (e) {}
}
// contact actions the admin overview reports (no personal data is sent)
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a');
  if (!a) return;
  if (a.matches('[data-contact="telegram"]')) track({ event: 'telegram' });
  else if ((a.getAttribute('href') || '').startsWith('mailto:')) track({ event: 'email' });
});

/* ---------- theme ---------- */
const root = document.documentElement;
const themeBtn = $('#themeBtn');
const isDark = () => root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
themeBtn?.setAttribute('aria-pressed', String(isDark()));
themeBtn?.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  themeBtn.setAttribute('aria-pressed', String(next === 'dark'));
  try { localStorage.setItem('olira-theme', next); } catch (e) {}
});

const nav = $('.nav');
if (nav) addEventListener('scroll', () => nav.classList.toggle('is-stuck', scrollY > 24), { passive: true });

const targets = $$('[data-fade]');
if (targets.length) {
  targets.forEach((n) => n.classList.add('fade'));
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.1 });
  targets.forEach((n) => io.observe(n));
}

/* ---------- contours: real Burayu topography (SRTM) ---------- */
const svgs = $$('svg[data-contours]');
if (svgs.length) {
  getJSON(svgs[0].dataset.contours).then((c) => {
    if (!c) return;
    for (const svg of svgs) {
      svg.setAttribute('viewBox', `0 0 ${c.size} ${c.size}`);
      if (!svg.hasAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      for (const lvl of c.levels) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', lvl.d); svg.append(p);
      }
    }
  });
}

/* ---------- live admin data ----------
   Pages are built with the data saved at build time; these calls apply anything
   the admin changed since, so no rebuild is needed. */
// Phone numbers never come through here: the public API leaves them out, and
// the call and WhatsApp icons fetch them on click (reach.js).
const salesEmail = () => ($('[data-contact="email"]')?.getAttribute('href') || 'mailto:info@oliraagroindustry.com').slice(7);
function telegramLabel(url) {
  const m = url.match(/(?:t|telegram)\.me\/([A-Za-z0-9_]{4,})/);
  return m ? `@${m[1]}` : 'Open Telegram';
}

function setLink(sel, href, text) {
  for (const a of $$(sel)) {
    a.href = href;
    const t = a.querySelector('span:last-child') || a;
    if (text != null) t.textContent = text;
  }
}
Promise.all([getJSON('/api/contact-details'), getJSON('/api/social-links')]).then(([d, social]) => {
  if (d) {
    const email = d.emails?.[0];
    if (email) setLink('[data-contact="email"]', `mailto:${email}`, email);
    if (d.address) {
      const a = d.address;
      for (const el of $$('[data-contact="address"] span:last-child')) {
        el.replaceChildren(a.line2 || '', h('br'), [a.line1, a.city].filter(Boolean).join(', '));
      }
    }
    if (d.office) $$('[data-contact="office-short"]').forEach((n) => { n.textContent = [d.office.name, d.office.city].filter(Boolean).join(', '); });
  }
  if (social) {
    const tg = /^https:\/\/\S+$/.test(social.telegram || '') ? social.telegram : '';
    for (const a of $$('[data-contact="telegram"]')) {
      a.hidden = !tg;
      if (tg) { a.href = tg; a.setAttribute('aria-label', `Olira on Telegram ${telegramLabel(tg)}`); }
    }
    const labels = { facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube' };
    const links = Object.entries(labels).filter(([k]) => /^https?:\/\//.test(social[k] || ''));
    for (const navEl of $$('[data-social]')) {
      navEl.replaceChildren(...links.map(([k, label]) => h('a', { href: social[k], target: '_blank', rel: 'noopener' }, label)));
      navEl.hidden = links.length === 0;
    }
  }
});

getJSON('/api/branding').then((b) => {
  if (b?.logo) $$('img[data-brand-logo]').forEach((img) => { img.src = b.logo; });
});

/* ---------- enquiry forms ----------
   Progressive: without JavaScript the form posts to a mailto: action and the
   browser's own required-field checks apply. With JavaScript it validates
   field by field, posts JSON to data-endpoint, announces the result in a live
   region, and if sending fails keeps the visitor's text and offers phone,
   WhatsApp and email with the message already filled in. */
export function prefill(msg) { const m = $('#message'); if (m) { m.value = msg; m.dispatchEvent(new Event('input')); } }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

function checkField(el) {
  const v = el.value.trim();
  if (el.name === 'website') return '';
  if (el.required && !v) return el.dataset.msgRequired || 'This field is required.';
  if (el.type === 'email' && v && !EMAIL.test(v)) return 'Enter an email address like name@company.com.';
  if (el.type === 'tel' && v && !PHONE.test(v)) return 'Enter a phone number with country code, for example +971 50 123 4567.';
  if (el.name === 'message' && v && v.length < 10) return 'Add a little more detail, at least 10 characters.';
  return '';
}
function showError(el, msg) {
  const err = document.getElementById(`${el.id}-error`);
  if (msg) { el.setAttribute('aria-invalid', 'true'); if (err) { err.textContent = msg; err.hidden = false; } }
  else { el.removeAttribute('aria-invalid'); if (err) { err.textContent = ''; err.hidden = true; } }
}

for (const form of $$('form[data-endpoint]')) {
  form.noValidate = true;
  const fields = $$('input:not([type=hidden]), select, textarea', form).filter((el) => el.name && el.name !== 'website');
  const status = $('.form-status', form), fail = $('.form-fail', form), btn = $('button[type=submit]', form);
  const btnText = btn.textContent;

  form.addEventListener('focusin', () => track({ event: 'form_start' }), { once: true });
  fields.forEach((el) => {
    el.addEventListener('blur', () => { if (el.value.trim()) showError(el, checkField(el)); });
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid')) showError(el, checkField(el)); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = ''; status.classList.remove('is-ok'); fail.hidden = true;
    let first = null;
    for (const el of fields) { const msg = checkField(el); showError(el, msg); if (msg && !first) first = el; }
    if (first) { status.textContent = 'Please check the highlighted fields.'; track({ event: 'form_invalid' }); first.focus(); return; }

    const data = Object.fromEntries(new FormData(form));
    if (data.website) { status.textContent = 'Thank you. Your request has been sent.'; form.reset(); return; }
    const extra = [data.port && `Destination port: ${data.port.trim()}`, data.qty && `Quantity: ${data.qty.trim()}`].filter(Boolean).join('\n');
    const payload = {
      name: data.name.trim(), email: data.email.trim(), company: (data.company || '').trim(), phone: (data.phone || '').trim(),
      // a product picked on the page is recorded, so the admin dashboard can attribute the lead
      product: form.dataset.product || form.dataset.line,
      message: `${extra ? extra + '\n\n' : ''}${data.message.trim()}`, website: '',
    };

    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending';
    status.textContent = 'Sending your request.';
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(form.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.classList.add('is-ok');
      status.textContent = 'Thank you. Your request is in and our team will reply within 24 hours.';
      form.reset(); delete form.dataset.product;
      try { window.gtag('event', 'form_submission', { form_name: 'inquiry', product: payload.product }); window.trackConversion({ product: payload.product }); } catch (err) {}
    } catch (err) {
      const body = `${payload.product} enquiry from ${payload.name}${payload.company ? ', ' + payload.company : ''}\n\n${payload.message}`;
      track({ event: 'form_fail' });
      $('[data-fail="mail"]', fail).href = `mailto:${salesEmail()}?subject=${encodeURIComponent(payload.product + ' enquiry')}&body=${encodeURIComponent(body)}`;
      // the numbers are fetched only now, after a failed send (see reach.js)
      const waLink = $('[data-fail="wa"]', fail), telLink = $('[data-fail="tel"]', fail);
      waLink.hidden = true; telLink.hidden = true;
      fail.hidden = false;
      try {
        const c = await reveal();
        if (c.whatsapp) {
          // WhatsApp documents %20-style encoding for text=; URLSearchParams would write + for spaces
          const wa = new URL(c.whatsapp.href); wa.search = '';
          waLink.href = `${wa.href}?text=${encodeURIComponent(body)}`; waLink.hidden = false;
        }
        if (c.phones?.[0]) { telLink.href = c.phones[0].href; telLink.hidden = false; }
      } catch (x) { /* email stays available */ }
      status.textContent = 'Sending failed. Your details are still in the form.';
    } finally {
      clearTimeout(timer);
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = btnText;
    }
  });
}
