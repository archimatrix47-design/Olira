// Small helpers the admin's settings forms share.
import { toast } from './api.js';

const once = new Set();
/** Run fn the first time a screen opens, never again. */
export const bindOnce = (key, fn) => { if (!once.has(key)) { once.add(key); fn(); } };
/** Mark a field as wrong, say why, and put the cursor there. */
export function invalid(el, msg, errEl) {
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); if (errEl) errEl.hidden = true; }, { once: true });
  if (errEl) { errEl.textContent = msg; errEl.hidden = false; } else toast(msg, 'error');
  el.focus();
}

/** The same for a form that keeps its own message: say why, and put the cursor there. */
export function fail(el, msg) {
  toast(msg, 'error');
  el.setAttribute('aria-invalid', 'true');
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
  el.focus();
}
