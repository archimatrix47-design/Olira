// A select that changes nothing until it is confirmed. Arrow keys on a closed
// <select> fire "change" on every press, so saving on change moved enquiries
// through several stages (and wrote each into the history) while someone was
// only reading the options. Choosing shows a "Move to ..." button; Enter on the
// select confirms too, Escape puts it back.
import { h } from './api.js';

export function confirmSelect({ options, value = '', label, verb = 'Move', onConfirm }) {
  const select = h('select', { class: 'input', 'aria-label': label },
    options.map(([v, text]) => h('option', { value: v, selected: v === value || null }, text)));
  const button = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', hidden: true, 'data-focus-fallback': 'select' });
  const changed = () => select.value !== value && select.value !== '';
  const sync = () => {
    button.hidden = !changed();
    if (changed()) button.textContent = `${verb} to ${select.selectedOptions[0].textContent}`;
  };
  const commit = () => {
    if (!changed()) return;
    button.disabled = true;
    onConfirm(select.value);
  };
  select.addEventListener('change', sync);
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && changed()) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape' && select.value !== value) { e.preventDefault(); select.value = value; sync(); }
  });
  button.addEventListener('click', commit);
  return { select, button };
}
