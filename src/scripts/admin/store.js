// Shared admin state. The period lives in the URL (#overview?days=30) so a view
// can be bookmarked or shared, and every section reads the same data for it.
import { api } from './api.js';

export const RANGES = [7, 30, 90, 365];
const cache = new Map();

export function getDays() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = Number(q.get('days'));
  return RANGES.includes(d) ? d : 30;
}
export function setDays(days) {
  const [view] = location.hash.slice(1).split('?');
  history.replaceState(null, '', `#${view || 'overview'}?days=${days}`);
  // replaceState fires no hashchange, so update the section links here too
  for (const a of document.querySelectorAll('[data-nav]')) a.setAttribute('href', `#${a.dataset.nav}?days=${days}`);
}

/** Cached for 60 seconds so moving between sections does not refetch. */
function cached(key, loader, ttl = 60000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = loader();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
export const invalidate = (prefix) => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };

export const analytics = (days = getDays()) => cached(`analytics:${days}`, () => api(`/api/analytics?days=${days}`));
export const inquiries = () => cached('inquiries', () => api('/api/admin/inquiries'), 15000);
export const products = () => cached('products', () => api('/api/products'));
export const setup = () => cached('setup', async () => {
  const safe = (p) => p.catch(() => null);
  const [certs, email, integrations, branding, social, contacts] = await Promise.all([
    safe(api('/api/certifications')), safe(api('/api/email-config')), safe(api('/api/integrations')),
    safe(api('/api/branding')), safe(api('/api/social-links')), safe(api('/api/contact-details')),
  ]);
  return { certs, email, integrations, branding, social, contacts };
});

/** A period picker bound to the URL; calls onChange(days). */
export function periodSelect(select, onChange) {
  select.value = String(getDays());
  if (select.dataset.bound) return;
  select.dataset.bound = '1';
  select.addEventListener('change', () => { setDays(Number(select.value)); onChange(Number(select.value)); });
}
