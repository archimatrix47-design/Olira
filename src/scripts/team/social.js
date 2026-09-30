// Both marketing workspaces: the contact links (WhatsApp, Telegram and the social
// pages) in the website's floating contact button and footer. Both teams edit
// the same links; the last save wins.
//   GET/POST /api/team/social-links
import { $, api, toast, busy } from '../admin/api.js';

const say = (msg) => { const s = $('#tSocialLive'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
let bound = false;

export async function show() {
  const form = $('#tSocialForm');
  if (!bound) { bound = true; form.addEventListener('submit', save); }
  try {
    const d = await api('/api/team/social-links');
    for (const el of form.querySelectorAll('input')) { el.value = d?.[el.name] || ''; clearError(el); }
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

function clearError(el) { el.removeAttribute('aria-invalid'); const err = $(`#${el.id}-err`); if (err) { err.hidden = true; err.textContent = ''; } }

async function save(e) {
  e.preventDefault();
  const form = e.currentTarget, body = {};
  let first = null;
  for (const el of form.querySelectorAll('input')) {
    const v = el.value.trim();
    clearError(el);
    if (v && !/^https?:\/\/\S+$/i.test(v)) {
      const err = $(`#${el.id}-err`);
      err.textContent = `Paste the full link, starting with https://`; err.hidden = false;
      el.setAttribute('aria-invalid', 'true');
      first ||= el;
    }
    body[el.name] = v;
  }
  if (first) return first.focus();
  const done = busy($('#tSocialSave'));
  try {
    const r = await api('/api/team/social-links', { method: 'POST', body });
    for (const el of form.querySelectorAll('input')) el.value = r.data?.[el.name] || '';
    form.dispatchEvent(new Event('saved')); // nothing unsaved now (tools.js)
    toast('Contact links saved. The website shows them now.');
    say('Contact links saved.');
  } catch (x) { toast(x.message, 'error'); }
  finally { done(); }
}
