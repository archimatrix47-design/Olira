// Reply composer: start from a template written for the team's line, send it
// from the website's mail account with the team member as Reply-To, attach
// files on the enquiry. If the website cannot send, the same email opens in the
// member's own mail app and can be logged on the timeline.
import { h, api, toast, confirmDialog } from '../admin/api.js';
import { scoreOf } from '../admin/leads.js';
import { session } from './session.js';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const signOff = () => `Kind regards,\n${session.isAdmin ? 'The Olira team' : session.user.name}\n${session.line === 'pack' ? 'Olira Packaging' : 'Olira Agro Industry'}`;
const productOf = (l) => (l.product && !/^(Agricultural products|Packaging|Kraft paper bags)$/i.test(l.product) ? l.product : session.line === 'pack' ? 'kraft paper bags' : 'our products');

// what the buyer did not tell us, phrased as questions
function missingQuestions(l) {
  const sc = scoreOf(l), gaps = new Set(sc.checks.filter((c) => !c.ok).map((c) => c.gap));
  if (session.line === 'pack') {
    const d = l.design;
    return [
      !d ? 'the bag type and size, or the dimensions you need' : null,
      gaps.has('volume') ? 'the quantity of bags' : null,
      'how many colours your print uses',
      gaps.has('destination or market') ? 'where the bags should be delivered' : null,
      'when you need them',
    ].filter(Boolean);
  }
  return [
    gaps.has('volume') ? 'the quantity you need, in metric tons' : null,
    gaps.has('destination or market') ? 'the destination port' : null,
    'the packing you prefer, for example 25 kg or 50 kg bags',
    'your preferred shipment period',
    gaps.has('specific product') ? 'the exact product and grade' : null,
  ].filter(Boolean);
}
const bullets = (list) => list.map((q) => `- ${q}`).join('\n');

export function templatesFor(l) {
  const name = first(l.name), product = productOf(l), hi = name ? `Dear ${name},` : 'Hello,';
  const hasArtwork = (l.files || []).some((f) => f.source === 'client');
  const common = {
    followup: {
      label: 'Follow up on a quote',
      subject: `Following up: ${product}`,
      body: `${hi}\n\nI am following up on our offer for ${product}. Do you have any questions, or shall we go ahead and reserve ${session.line === 'pack' ? 'production time' : 'volume'} for you?\n\n${signOff()}`,
    },
  };
  if (session.line === 'pack') {
    return {
      details: {
        label: 'Thank you, and a few details',
        subject: `Your request for ${product}`,
        body: `${hi}\n\nThank you for your request. So we can quote accurately, could you confirm:\n${bullets(missingQuestions(l))}\n\n${hasArtwork ? 'We have received your artwork and will send a mockup for your approval.' : 'Please also send your logo as a PDF, AI, EPS or SVG file so we can prepare a mockup.'}\n\n${signOff()}`,
      },
      mockup: {
        label: 'Mockup for approval',
        subject: `Mockup of your ${product}`,
        body: `${hi}\n\nPlease find attached a mockup of your bag with your design. Let us know if you would like any changes to the size, position or colours of the print, and we will update it.\n\n${signOff()}`,
      },
      quote: {
        label: 'Send the quote',
        subject: `Quote for ${product}`,
        body: `${hi}\n\nThank you for your interest. Our quote is below.\n\n[quote]\n\n${signOff()}`,
      },
      ...common,
    };
  }
  return {
    details: {
      label: 'Thank you, and a few details',
      subject: `Your enquiry about ${product}`,
      body: `${hi}\n\nThank you for your enquiry about ${product}. To prepare a price, could you confirm:\n${bullets(missingQuestions(l))}\n\nWe quote as soon as we have these details.\n\n${signOff()}`,
    },
    quote: {
      label: 'Send the quote',
      subject: `Offer for ${product}`,
      body: `${hi}\n\nThank you for your interest in ${product}. Our offer is below.\n\n[quote]\n\n${signOff()}`,
    },
    samples: {
      label: 'Offer a sample',
      subject: `Sample of ${product}`,
      body: `${hi}\n\nWe would be glad to send a sample of ${product} for your quality evaluation. Please send the delivery address and, if you have one, your courier account number.\n\n${signOff()}`,
    },
    ...common,
  };
}

/** The quote as plain text for an email body. */
export function quoteText(q) {
  if (!q) return '';
  const money = (n) => `${q.currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = q.items.map((it) => `${it.item}${it.detail ? ` (${it.detail})` : ''}: ${Number(it.qty).toLocaleString('en-US')} ${it.unit || ''} at ${money(it.price)} per ${it.unit ? it.unit.replace(/s$/i, '') : 'unit'} = ${money(it.qty * it.price)}`);
  if (q.extra) lines.push(`${q.extraLabel || 'Other charges'}: ${money(q.extra)}`);
  const t = q.terms || {};
  const terms = [
    t.incoterm ? `Terms: ${t.incoterm}${t.port ? ` ${t.port}` : ''}` : t.port ? `Delivery: ${t.port}` : null,
    t.packing ? `Packing: ${t.packing}` : null, t.shipment ? `Shipment: ${t.shipment}` : null, t.leadTime ? `Lead time: ${t.leadTime}` : null,
    t.payment ? `Payment: ${t.payment}` : null, q.validUntil ? `Valid until: ${new Date(`${q.validUntil}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : null,
  ].filter(Boolean);
  return [`Quote ${q.number}`, ...lines, `Total: ${money(q.total)}`, '', ...terms, q.notes ? `\n${q.notes}` : ''].join('\n').trim();
}

export function composer(l, { onSent, draft } = {}) {
  const tpls = templatesFor(l);
  const select = h('select', { class: 'input', 'aria-label': 'Start from a template' },
    h('option', { value: '' }, 'Start from a template'),
    Object.entries(tpls).map(([k, t]) => h('option', { value: k }, t.label)));
  const subject = h('input', { class: 'input', name: 'subject', maxlength: '200', 'aria-label': 'Subject', placeholder: 'Subject' });
  const body = h('textarea', { class: 'input', name: 'body', rows: '10', maxlength: '10000', 'aria-label': 'Email', placeholder: `Write to ${l.name || 'the buyer'}` });
  if (draft) { subject.value = draft.subject || ''; body.value = draft.body || ''; if (draft.fromTemplate) body.dataset.fromTemplate = draft.fromTemplate; }
  else { subject.value = `Re: your enquiry${l.product && !/^(Agricultural products|Packaging)$/i.test(l.product) ? ` about ${l.product}` : ''}`; }

  const apply = async () => {
    const t = tpls[select.value];
    if (!t) return;
    if (body.value.trim() && body.dataset.fromTemplate !== 'yes') {
      const ok = await confirmDialog({ title: 'Replace your email?', body: 'The template replaces what you have written so far.', confirm: 'Replace' });
      if (!ok) { select.value = ''; return; }
    }
    subject.value = t.subject;
    body.value = t.body.replace('[quote]', l.quote ? quoteText(l.quote) : '[Save a quote below, then choose "Insert the quote"]');
    body.dataset.fromTemplate = 'yes';
    body.focus();
  };
  select.addEventListener('change', apply);
  body.addEventListener('input', () => { body.dataset.fromTemplate = 'no'; });

  const files = (l.files || []);
  const attach = files.length ? h('fieldset', { class: 'a-fieldset t-attach' }, h('legend', { class: 'a-label' }, 'Attach'),
    files.map((f) => h('label', { class: 'a-check' }, h('input', { type: 'checkbox', name: 'attach', value: f.id, checked: f.kind === 'mockup' && f.source === 'team' && (Date.now() - Date.parse(f.at)) < 86400000 ? true : null }), `${f.name}`))) : null;
  const copyMe = session.user?.email ? h('label', { class: 'a-check' }, h('input', { type: 'checkbox', name: 'copyMe', checked: true }), `Send a copy to ${session.user.email}`) : null;
  const insertQuote = l.quote ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    const text = quoteText(l.quote);
    const at = body.selectionStart ?? body.value.length;
    body.value = body.value.includes('[Save a quote below') ? body.value.replace(/\[Save a quote below[^\]]*\]/, text) : `${body.value.slice(0, at)}${text}${body.value.slice(at)}`;
    body.focus();
  } }, `Insert quote ${l.quote.number}`) : null;

  const send = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send email');
  const mailApp = h('a', { class: 'btn btn-secondary', href: '#', target: '_blank', rel: 'noopener' }, 'Open in my email app');
  const status = h('p', { class: 'a-note', role: 'status', 'aria-live': 'polite' });
  const logSent = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, 'I sent it from my email app, log it');

  const form = h('form', { class: 't-compose', 'data-compose': '', novalidate: true },
    h('p', { class: 'a-note' }, `To ${l.email || 'no email address'}. ${session.user?.email ? `Replies from the buyer go to ${session.user.email}.` : 'Replies go to the company inbox.'}`),
    h('div', { class: 't-compose-row' }, select, insertQuote), subject, body, attach, copyMe,
    h('div', { class: 'a-actions' }, send, mailApp, logSent), status);

  const refreshMailto = () => { mailApp.href = `mailto:${encodeURIComponent(l.email || '')}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`; };
  [subject, body].forEach((el) => el.addEventListener('input', refreshMailto));
  refreshMailto();
  mailApp.addEventListener('click', () => { refreshMailto(); logSent.hidden = false; });
  logSent.addEventListener('click', async () => {
    try {
      const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/activity`, { method: 'POST', body: { type: 'email', text: `${subject.value}\n\n${body.value}`.slice(0, 2000) } });
      toast('Logged on the timeline.');
      onSent?.(r.inquiry);
    } catch (e) { toast(e.message, 'error'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!l.email) return toast('This enquiry has no email address. Call or message the buyer and log it below.', 'error');
    if (!subject.value.trim()) { toast('Add a subject.', 'error'); return subject.focus(); }
    if (body.value.trim().length < 10) { toast('Write the email first.', 'error'); return body.focus(); }
    if (/\[Save a quote below/.test(body.value)) { toast('Save the quote below and insert it, or remove the placeholder.', 'error'); return body.focus(); }
    send.disabled = true; send.textContent = 'Sending';
    status.textContent = 'Sending the email.';
    try {
      const attachments = [...form.querySelectorAll('input[name=attach]:checked')].map((i) => i.value);
      const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/reply`, { method: 'POST', body: { subject: subject.value, body: body.value, attachments, copyMe: form.querySelector('input[name=copyMe]')?.checked ?? false } });
      status.textContent = '';
      toast(`Email sent to ${l.email}.`);
      subject.value = ''; body.value = '';
      onSent?.(r.inquiry);
    } catch (x) {
      status.textContent = x.status === 503 || x.status === 502 ? `${x.message} Use "Open in my email app" instead, then log it.` : x.message;
      toast(x.message, 'error');
      logSent.hidden = false;
    } finally { send.disabled = false; send.textContent = 'Send email'; }
  });
  return form;
}
