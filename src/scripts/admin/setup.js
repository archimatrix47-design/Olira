// Overview for the administrator: what the website needs to run well, and the
// accounts that work it. Enquiries, traffic and the catalogues belong to the
// manager and the marketing teams, so this page only points at them.
import { $, h, toast, timeAgo } from './api.js';
import * as store from './store.js';
import { statusIcon } from './widgets.js';
import { int } from './format.js';
import { certAlerts, certHealth } from './cert-alerts.js';

const view = () => $('[data-view="overview"]');

export async function show() {
  view().setAttribute('aria-busy', 'true');
  try {
    const [setup, prods, bags] = await Promise.all([store.setup(), store.products().catch(() => null), store.packaging().catch(() => null)]);
    renderAttention(setup);
    renderHealth(setup, prods, bags);
    renderAccounts(setup.team);
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  } finally {
    view().removeAttribute('aria-busy');
  }
}

const members = (team) => (team?.members || []).filter((m) => m.active !== false);

function renderAttention(setup) {
  const items = [];
  const add = (level, title, text, href, action) => items.push({ level, title, text, href, action });
  const st = setup.status;
  // null means the settings could not be read, which is not the same as "not set up"
  if (setup.email && !setup.email.smtpHost) add('high', 'Email delivery is not set up', 'Enquiries are saved, but no one is notified, buyers get no confirmation and the teams cannot send replies from their workspaces.', '#email', 'Set up');
  if (st?.undelivered30) add('high', `${st.undelivered30} ${st.undelivered30 === 1 ? 'enquiry notification' : 'enquiry notifications'} did not go out in 30 days`, 'The enquiries are safe in the workspaces. Check the mail account so the next ones arrive.', '#email', 'Check email');
  if (st?.formFails30) add('high', `Visitors saw a sending error ${st.formFails30} ${st.formFails30 === 1 ? 'time' : 'times'} in 30 days`, 'The form offered them WhatsApp, email or a call instead. Check the email settings.', '#email', 'Check email');
  const people = members(setup.team);
  if (setup.team && !people.some((m) => m.role === 'manager')) add('medium', 'No manager account', 'Nobody oversees the enquiries of both lines or hands them out. Add a person with the Manager role.', '#team', 'Add a manager');
  for (const [role, name] of [['agri', 'agriculture'], ['pack', 'packaging']]) {
    if (setup.team && !people.some((m) => m.role === role)) add('medium', `No one on the ${name} team`, `${name[0].toUpperCase()}${name.slice(1)} enquiries wait for a manager to answer them, and the ${name} catalogue has no one to keep it up to date.`, '#team', 'Add someone');
  }
  if (!setup.contacts?.phones?.length) add('medium', 'No phone number saved', 'The call and WhatsApp buttons on the website need at least one.', '#company', 'Add a number');
  for (const c of certAlerts(setup.certs)) add(c.level, c.title, c.text, '#certifications', c.level === 'high' ? 'Renew' : 'Upload');
  if (!items.length) add('ok', 'Nothing needs attention', 'Email delivery works and every role has someone on it.', null, null);
  $('#ovAttention').replaceChildren(...items.map((i) => h('li', { class: `is-${i.level}` },
    h('div', {}, h('strong', {}, i.title), h('span', {}, i.text)),
    i.href ? h('a', { class: `btn btn-sm ${i.level === 'high' ? 'btn-primary' : 'btn-secondary'}`, href: i.href }, i.action) : null)));
}

// A packaging product is one visitors can design once it has a photo and print corners.
const inStudio = (p) => !!(p.image && Array.isArray(p.quad) && p.quad.length === 4);

function renderHealth(setup, prods, bags) {
  const list = prods || [];
  const withPhoto = list.filter((p) => p.image).length;
  const shown = bags || [];
  const withPackPhoto = shown.filter((p) => p.image).length, designable = shown.filter(inStudio).length;
  const team = (name) => `The ${name} team looks after this in its workspace`;
  // [status, title, text, link to fix it here, or null when it is someone else's work]
  const rows = [
    setup.email === null
      ? ['optional', 'Email delivery', 'Could not check just now. Open Email delivery to see the settings', '#email']
      : [setup.email.smtpHost ? 'ok' : 'todo', 'Email delivery', setup.email.smtpHost ? `Enquiries go to ${setup.email.recipientEmail}, with copies to the teams` : 'Not set up, so nobody is notified', '#email'],
    [setup.contacts?.phones?.length ? 'ok' : 'todo', 'Phone numbers', setup.contacts?.phones?.length ? `${setup.contacts.phones.length} phone ${setup.contacts.phones.length === 1 ? 'number' : 'numbers'} for the call and WhatsApp buttons` : 'No phone number saved', '#company'],
    [...certHealth(setup.certs), '#certifications'],
    [setup.branding?.logo ? 'ok' : 'optional', 'Logo', setup.branding?.logo ? 'Your uploaded logo is in use' : 'The original logo is in use. Upload a sharper one any time', '#logo'],
    [setup.integrations?.analytics?.measurementId ? 'ok' : 'optional', 'Google Analytics', setup.integrations?.analytics?.measurementId ? 'Connected' : 'Optional. The manager\'s built-in traffic numbers work without it', '#marketing'],
    [list.length && withPhoto === list.length ? 'ok' : 'todo', 'Agriculture product photos', `${withPhoto} of ${list.length} products have a photo. ${team('agriculture')}`, null],
    bags === null
      ? ['optional', 'Packaging catalogue', `Could not check just now. ${team('packaging')}`, null]
      : [shown.length && withPackPhoto === shown.length ? 'ok' : 'todo', 'Packaging catalogue photos', !shown.length ? `No packaging products on the website. ${team('packaging')}` : `${withPackPhoto} of ${shown.length} products have a photo; ${designable} can be designed in the mockup studio. ${team('packaging')}`, null],
    [setup.social?.whatsapp || setup.social?.telegram ? 'ok' : 'optional', 'Contact links', setup.social?.whatsapp || setup.social?.telegram ? `${[setup.social.whatsapp ? 'WhatsApp' : '', setup.social.telegram ? 'Telegram' : ''].filter(Boolean).join(' and ')} set. The marketing teams look after these` : 'WhatsApp uses the main phone. The marketing teams can add Telegram and social pages', null],
  ];
  $('#ovHealth').replaceChildren(...rows.filter(Boolean).map(([kind, title, text, href]) => h('li', {}, statusIcon(kind),
    h('div', {}, h('strong', {}, title, h('span', { class: 'sr-only' }, kind === 'ok' ? ', done' : kind === 'todo' ? ', needs doing' : ', optional')), h('span', {}, text, href && kind !== 'ok' ? ' ' : null, href && kind !== 'ok' ? h('a', { href }, kind === 'todo' ? 'Fix' : 'Set up') : null)))));
}

function renderAccounts(team) {
  const box = $('#ovAccounts');
  if (!team) { box.replaceChildren(h('div', {}, h('dt', {}, 'Accounts'), h('dd', {}, 'Could not load just now'))); return; }
  const people = members(team);
  const last = (role) => people.filter((m) => m.role === role && m.lastLoginAt).map((m) => m.lastLoginAt).sort().at(-1);
  const fact = (dt, n, role) => h('div', {}, h('dt', {}, dt), h('dd', {}, int(n), h('small', {}, last(role) ? `Last sign in ${timeAgo(last(role))}` : n ? 'Nobody has signed in yet' : 'None yet')));
  box.replaceChildren(
    fact('Managers', people.filter((m) => m.role === 'manager').length, 'manager'),
    fact('Agriculture team', people.filter((m) => m.role === 'agri').length, 'agri'),
    fact('Packaging team', people.filter((m) => m.role === 'pack').length, 'pack'),
    h('div', {}, h('dt', {}, 'Switched off'), h('dd', {}, int((team.members || []).length - people.length), h('small', {}, h('a', { href: '#team' }, 'Manage staff accounts')))),
  );
}
