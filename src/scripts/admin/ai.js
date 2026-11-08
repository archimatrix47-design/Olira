// Admin, AI access (lib/ai-access.js): the switch for AI reader accounts, the
// accounts themselves (a key shown once, removable), and the local model the
// manager asks. The admin never sees the log; "Check the connection" only asks
// the model's program which models it has, from this browser.
import { $, h, api, toast, busy, save, confirmDialog, formatDate, timeAgo } from './api.js';

let bound = false, data = null;
// the address this page was opened with: the page's security policy lets it reach only that one
let pageOrigin;
const originOf = (url) => { try { return url ? new URL(url).origin : ''; } catch (e) { return ''; } };
const KIND = { ollama: 'Ollama', openai: 'the server' };

export async function show() {
  if (!bound) { bound = true; bind(); }
  await load();
}

async function load() {
  try {
    data = await api('/api/admin/ai-access');
    if (pageOrigin === undefined) pageOrigin = originOf(data.llm?.url);
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

function render() {
  const state = $('#aiState');
  state.textContent = data.enabled ? 'On' : 'Off';
  state.classList.toggle('on', data.enabled); state.classList.toggle('off', !data.enabled);
  $('#aiEnabled').checked = data.enabled;
  const active = data.keys.filter((k) => !k.removedAt);
  $('#aiKeys').replaceChildren(active.length
    ? h('table', { class: 'a-table a-ai-table' },
      h('caption', { class: 'sr-only' }, 'Reader accounts'),
      h('thead', {}, h('tr', {}, ...['Account', 'Key', 'Created', 'Last read', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...active.map((k) => {
        const remove = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Remove');
        remove.setAttribute('aria-label', `Remove ${k.name}`);
        remove.addEventListener('click', () => removeKey(k));
        return h('tr', {}, h('td', {}, k.name), h('td', {}, h('code', {}, k.hint)), h('td', {}, formatDate(k.createdAt)), h('td', {}, k.lastReadAt ? timeAgo(k.lastReadAt) : 'Not yet'), h('td', {}, remove));
      })))
    : h('p', { class: 'hint' }, 'No accounts yet.'));
  const f = $('#aiLlmForm');
  f.elements.enabled.checked = !!data.llm.enabled;
  f.elements.kind.value = data.llm.kind || 'ollama';
  f.elements.url.value = data.llm.url || '';
  f.elements.model.value = data.llm.model || '';
  f.removeAttribute('data-dirty');
}

function bind() {
  $('#aiEnabled').addEventListener('change', async (e) => {
    const sw = e.currentTarget, on = sw.checked;
    sw.disabled = true;
    try {
      data = await api('/api/admin/ai-access', { method: 'POST', body: { enabled: on } });
      render();
      toast(on ? 'AI access is on: reader accounts can read the log.' : 'AI access is off: every reader account is refused.');
    } catch (err) { sw.checked = !on; toast(err.message, 'error'); }
    sw.disabled = false;
  });

  $('#aiKeyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#aiKeyName'), name = input.value.trim();
    if (!name) { toast('Name the account after the tool that will use it, for example Claude.', 'error'); input.focus(); return; }
    const btn = e.currentTarget.querySelector('button[type=submit]');
    const done = busy(btn, 'Creating');
    try {
      const r = await api('/api/admin/ai-access/keys', { method: 'POST', body: { name } });
      input.value = '';
      showKey(r.key);
      await load();
    } catch (err) { toast(err.message, 'error'); }
    done();
  });
  $('#aiKeyCopy').addEventListener('click', async () => {
    const v = $('#aiKeyValue');
    try { await navigator.clipboard.writeText(v.value); toast('Key copied.'); }
    catch (e) { v.select(); toast('Select the key and copy it with Ctrl+C.', 'error'); }
  });
  // the key leaves the page as soon as it is no longer needed
  $('#aiKeyDone').addEventListener('click', () => { $('#aiKeyValue').value = ''; $('#aiKeyShown').hidden = true; $('#aiKeyName').focus(); });

  const form = $('#aiLlmForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const llm = { enabled: form.elements.enabled.checked, kind: form.elements.kind.value, url: form.elements.url.value.trim(), model: form.elements.model.value.trim() };
    const r = await save(form.querySelector('button[type=submit]'), () => api('/api/admin/ai-access', { method: 'POST', body: { llm } }), 'Local model saved.');
    if (!r) return;
    data = r; render();
    // a new http address is allowed on a page only from its next load
    const next = originOf(r.llm.url);
    if (next && next !== pageOrigin && next.startsWith('http:')) {
      toast('Saved. The page reloads so it may reach the new address.');
      setTimeout(() => { location.hash = '#ai'; location.reload(); }, 1400);
    }
  });

  $('#aiLlmTest').addEventListener('click', testModel);
}

function showKey(key) {
  const box = $('#aiKeyShown');
  $('#aiKeyValue').value = key;
  $('#aiKeyHow').textContent = `The tool sends it with each request as the header "Authorization: Bearer" followed by the key, to ${location.origin}/api/ai/log (what each part means: ${location.origin}/api/ai/schema). Never put it in a web address or a document others can read.`;
  box.hidden = false;
  $('#aiKeyValue').focus(); $('#aiKeyValue').select();
}

async function removeKey(k) {
  const ok = await confirmDialog({ title: `Remove the account "${k.name}"?`, body: 'Its key stops working at once. This cannot be undone: to give the tool access again, create a new account.', confirm: 'Remove' });
  if (!ok) return;
  try { await api(`/api/admin/ai-access/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE' }); toast(`${k.name} removed. Its key no longer works.`); await load(); }
  catch (e) { toast(e.message, 'error'); }
}

/** Ask the model's program which models it has: from this browser, nothing about the website is sent. */
async function testModel() {
  const btn = $('#aiLlmTest'), out = $('#aiLlmResult');
  const llm = data?.llm;
  out.hidden = false; out.className = 'a-test-result';
  if (!llm?.url) { out.className = 'a-test-result is-error'; out.textContent = 'Save an address first.'; return; }
  if ($('#aiLlmForm').hasAttribute('data-dirty')) { out.className = 'a-test-result is-error'; out.textContent = 'Save the changes first, then check.'; return; }
  const done = busy(btn, 'Checking');
  out.textContent = `Asking ${llm.url}.`;
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(llm.kind === 'openai' ? `${llm.url}/models` : `${llm.url}/api/tags`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`It answered with status ${r.status}.`);
    const body = await r.json();
    const names = (llm.kind === 'openai' ? (body.data || []).map((m) => m.id) : (body.models || []).map((m) => m.name)).filter(Boolean);
    const has = names.some((n) => n === llm.model || n === `${llm.model}:latest`);
    out.className = `a-test-result ${has ? 'is-ok' : 'is-error'}`;
    out.textContent = names.length
      ? `Connected. Models there: ${names.slice(0, 12).join(', ')}. ${has ? `${llm.model} is ready for the manager.` : `${llm.model || 'The model named here'} is not among them: correct the name, or download it there first.`}`
      : 'Connected, but it has no models yet. Download one there first.';
  } catch (e) {
    out.className = 'a-test-result is-error';
    out.textContent = e.name === 'AbortError' || e instanceof TypeError
      ? `No answer from ${llm.url}. Check that ${KIND[llm.kind] || 'the program'} is running on this computer, that it allows this website (step 3 under How to set it up), and that the browser was allowed to reach it.`
      : e.message;
  }
  done();
}
