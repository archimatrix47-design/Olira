// Shared admin helpers: authenticated API calls, toasts, confirm dialog.
// Everything visitor- or admin-supplied is written with textContent, never as
// HTML, because enquiries contain text typed by strangers.
export const $ = (sel, r = document) => r.querySelector(sel);
export const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
export function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// Same storage key as the previous admin, so existing sessions carry over.
// The team workspaces keep their own session under another key (useTokenKey).
let TOKEN = 'adminToken';
export const useTokenKey = (key) => { TOKEN = key; };
export const getToken = () => { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); localStorage.removeItem('adminLoggedIn'); } catch (e) {} };
export const readStoredToken = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };

let onExpired = () => {};
export const whenSessionExpires = (fn) => { onExpired = fn; };

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers, body: payload }); }
  catch (e) { throw new ApiError('Could not reach the server. Check the connection and try again.', 0); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && !path.startsWith('/api/admin/login')) {
    onExpired();
    throw new ApiError('Your session has ended. Sign in again.', 401);
  }
  if (!res.ok) throw new ApiError(data?.error || `Something went wrong (${res.status}).`, res.status);
  return data;
}

export function toast(message, type = 'ok') {
  const box = $('#toasts');
  const close = h('button', { type: 'button', 'aria-label': 'Dismiss' }, 'Close');
  const t = h('div', { class: `a-toast${type === 'error' ? ' is-error' : ''}` }, h('span', {}, message), close);
  const remove = () => t.remove();
  close.addEventListener('click', remove);
  // keep the stack short so messages never cover the page
  while (box.children.length >= (innerWidth < 600 ? 1 : 3)) box.firstElementChild.remove();
  box.append(t);
  setTimeout(remove, type === 'error' ? 9000 : 4500);
}

export function confirmDialog({ title, body, confirm = 'Delete' }) {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  $('#confirmOk').textContent = confirm;
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    dlg.querySelector('button[value="cancel"]').focus();
  });
}

/** Disable a button while an action runs; returns a function that restores it. */
export function busy(btn, label = 'Saving') {
  if (!btn) return () => {};
  const text = btn.textContent;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = label;
  return () => { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = text; };
}

/** Run a save with a busy button and a toast either way. */
export async function save(btn, fn, okMessage) {
  const done = busy(btn);
  try { const r = await fn(); if (okMessage) toast(okMessage); return r; }
  catch (e) { toast(e.message, 'error'); return undefined; }
  finally { done(); }
}

export async function uploadImage(file, productId) {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('productId', productId || 'product');
  return api('/api/upload/product-image', { method: 'POST', form: fd });
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : dateFmt.format(d); };
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const units = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week']];
  let [div, name] = units[0];
  for (const u of units) if (s >= u[0]) [div, name] = u;
  if (s >= 2592000) return formatDate(iso);
  const n = Math.floor(s / div);
  return `${n} ${name}${n === 1 ? '' : 's'} ago`;
}
export const nf = new Intl.NumberFormat();
