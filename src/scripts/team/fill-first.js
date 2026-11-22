// "Fill in first" on a team's products screen: the incomplete products visitors
// opened most in the last 30 days, each with what it still misses, so the team fills
// in what buyers actually look at before the rest. The opens come from the team's
// own insights (/api/team/insights, keyed by product name); without any opens the
// least complete products are listed instead.
import { h, api } from '../admin/api.js';
import { int } from '../../../lib/format.js';

let seen = null, seenAt = 0;
async function opensByName() {
  if (seen && Date.now() - seenAt < 5 * 60000) return seen;
  const a = await api('/api/team/insights?days=30').catch(() => null);
  seen = new Map((a?.products || []).map((p) => [p.name, p]));
  seenAt = Date.now();
  return seen;
}

/** Fill `box` with up to three incomplete products, the most opened first; onOpen(product) opens one to edit. */
export async function fillFirst(box, { items, check, onOpen }) {
  if (!box) return;
  const opens = await opensByName();
  const todo = items
    .map((p) => ({ p, c: check(p), o: opens.get(p.name) || { opens: 0, enquiries: 0 } }))
    .filter((x) => !x.c.complete)
    .sort((a, b) => b.o.opens - a.o.opens || b.o.enquiries - a.o.enquiries || a.c.score - b.c.score)
    .slice(0, 3);
  box.hidden = !todo.length;
  if (!todo.length) { box.replaceChildren(); return; }
  const anyOpened = todo.some((x) => x.o.opens);
  box.replaceChildren(
    h('h3', {}, 'Fill in first'),
    h('p', { class: 'a-note' }, anyOpened
      ? 'The products visitors opened most in the last 30 days that still miss something: buyers see these first.'
      : 'No product was opened in the last 30 days, so these are the least complete.'),
    h('ol', {}, todo.map(({ p, c, o }) => h('li', {},
      h('span', { class: 'grow' },
        h('strong', {}, p.name),
        h('span', {}, `${o.opens ? `Opened ${int(o.opens)} time${o.opens === 1 ? '' : 's'}, ${int(o.enquiries)} enquir${o.enquiries === 1 ? 'y' : 'ies'}. ` : ''}Missing: ${c.missing.join(', ')}`)),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => onOpen(p) }, 'Open')))));
}
