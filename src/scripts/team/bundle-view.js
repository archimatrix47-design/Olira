// A lead's packing list (the products, sizes, quantities and print colours the
// visitor sent together), as a table. Shared by the team inbox and the admin's
// enquiries, so both show it the same way.
import { h } from '../admin/api.js';

const num = (n) => Number(n).toLocaleString('en-US');
const print = (c) => (c === 0 ? 'Plain' : Number.isInteger(c) ? `${c} colour${c === 1 ? '' : 's'}` : 'To discuss');

export const bundleCount = (l) => (Array.isArray(l?.bundle) ? l.bundle.length : 0);

/** One line of text per item, for exports and email quotes. */
export const bundleText = (l) => (l.bundle || []).map((b) => `${b.name}${b.size ? `, ${b.size}` : ''}${b.dims ? ` (${b.dims})` : ''}: ${num(b.qty)}, ${print(b.colours).toLowerCase()} print`).join('; ');

export function bundleTable(l) {
  const rows = (l.bundle || []).map((b) => h('tr', {},
    h('td', {}, h('strong', {}, b.name), b.size ? h('span', { class: 'a-note' }, ` ${b.size}${b.dims ? `, ${b.dims}` : ''}`) : null),
    h('td', { class: 'num' }, num(b.qty)),
    h('td', {}, print(b.colours)),
    h('td', { class: 'a-note' }, b.minOrder ? `min ${num(b.minOrder)}` : '')));
  return h('div', { class: 'a-bundle' },
    h('table', {},
      h('caption', { class: 'sr-only' }, 'Packing list sent with this enquiry'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col', class: 'num' }, 'Quantity'), h('th', { scope: 'col' }, 'Print'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Minimum order')))),
      h('tbody', {}, rows)));
}
