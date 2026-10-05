// The month against its targets, one card per line: the manager's dashboard
// (both lines, and the form to set them) and each team's Insights (its own line).
import { h, api, toast } from '../admin/api.js';
import { progress } from './targets-progress.js';
import { LINE_LABEL } from './session.js';

const n = (v) => Number(v || 0).toLocaleString('en-US');

function meter(label, r, unit = '') {
  const shown = r.target == null ? 'No target set' : `${n(r.done)}${unit} of ${n(r.target)}${unit}`;
  const pace = r.target == null ? '' : r.done >= r.target ? 'Reached' : r.onPace ? 'On pace' : `Behind pace: about ${n(Math.ceil(r.expected))}${unit} by today`;
  const bar = h('i', { 'aria-hidden': 'true' }), fill = h('b');
  fill.style.width = `${Math.min(100, Math.round((r.share || 0) * 100))}%`;
  bar.append(fill);
  return h('div', { class: `t-target${r.target == null ? ' is-unset' : r.done >= r.target ? ' is-done' : r.onPace ? '' : ' is-behind'}` },
    h('div', { class: 't-target-head' }, h('span', {}, label), h('strong', {}, shown)),
    bar,
    pace ? h('small', {}, pace) : null);
}

/** One card per line in `box`. `targets` from /api/team/targets; `leads` this account's enquiries. */
export function renderTargets(box, { targets, leads, lines, onEdit }) {
  const cards = lines.map((line) => {
    const t = targets?.[line] || {};
    const p = progress(leads, t, line);
    const wonUnit = ` ${p.wonValue.currency}`;
    return h('div', { class: 't-targets-line' },
      h('h3', {}, `${LINE_LABEL[line]}, ${p.month.name}`),
      meter('Enquiries received', p.enquiries),
      meter('Quotes sent', p.quotes),
      meter('Value won', p.wonValue, wonUnit),
      p.wonValue.otherCurrency ? h('p', { class: 'a-note' }, `${p.wonValue.otherCurrency} won enquiry${p.wonValue.otherCurrency === 1 ? ' was' : 's were'} quoted in another currency and ${p.wonValue.otherCurrency === 1 ? 'is' : 'are'} not in this sum.`) : null);
  });
  box.replaceChildren(h('div', { class: 't-targets' }, ...cards), onEdit ? h('div', { class: 'a-actions' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: onEdit }, 'Set targets')) : null);
}

/** The manager's form: both lines, saved together. */
export function targetsForm(box, { targets, onSaved, onCancel }) {
  const field = (line, key, label, attrs = {}) => {
    const id = `tg-${line}-${key}`;
    const input = h('input', { class: 'input', id, name: `${line}.${key}`, inputmode: 'numeric', autocomplete: 'off', placeholder: 'No target', ...attrs });
    input.value = targets?.[line]?.[key] ?? '';
    return h('div', { class: 'a-field' }, h('label', { for: id }, label), input);
  };
  const currency = (line) => {
    const id = `tg-${line}-currency`;
    const sel = h('select', { class: 'input', id, name: `${line}.currency` }, ['USD', 'EUR', 'ETB'].map((c) => h('option', { value: c, selected: (targets?.[line]?.currency || (line === 'pack' ? 'ETB' : 'USD')) === c || null }, c)));
    return h('div', { class: 'a-field' }, h('label', { for: id }, 'Currency'), sel);
  };
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const form = h('form', { class: 't-targets-form', novalidate: true },
    ...['agri', 'pack'].map((line) => h('fieldset', { class: 'a-fieldset' }, h('legend', { class: 'a-label' }, `${LINE_LABEL[line]}, each month`),
      field(line, 'enquiries', 'Enquiries received'), field(line, 'quotes', 'Quotes sent'), field(line, 'wonValue', 'Value won'), currency(line))),
    err,
    h('div', { class: 'a-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save targets'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onCancel }, 'Cancel')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (name) => form.elements[name].value.replace(/[\s,]/g, '');
    const body = { targets: Object.fromEntries(['agri', 'pack'].map((line) => [line, { enquiries: val(`${line}.enquiries`), quotes: val(`${line}.quotes`), wonValue: val(`${line}.wonValue`), currency: form.elements[`${line}.currency`].value }])) };
    const bad = [...form.querySelectorAll('input')].find((i) => i.value.trim() && !/^\d[\d,\s]*$/.test(i.value.trim()));
    if (bad) { err.textContent = 'Targets are whole numbers, or blank for no target.'; err.hidden = false; bad.setAttribute('aria-invalid', 'true'); bad.focus(); return; }
    try {
      const r = await api('/api/team/targets', { method: 'POST', body });
      toast('Targets saved. The dashboard and the teams\' Insights use them now.');
      onSaved(r.targets);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  box.replaceChildren(form);
  form.querySelector('input')?.focus();
}
