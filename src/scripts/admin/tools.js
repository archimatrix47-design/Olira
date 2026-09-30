// What every staff tool does the same way, in the admin panel and the
// workspaces: forms know when they have unsaved changes (they say so beside
// Save, and ask before the work is left behind), Ctrl+S or Cmd+S saves, "/"
// goes to the search field, arrow keys move through a list, and on a phone the
// sections are their own screen, like Settings.
import { $, $$, confirmDialog } from './api.js';

/* ---------- unsaved changes ----------
   A form's clean state is taken the moment someone starts working in it (after
   the view has filled it in), and again whenever a view calls clean() after
   loading or saving. Anything else a form holds outside its fields (a photo, the
   print corners) is marked with touch(). */
const snapshots = new WeakMap();
const fieldsOf = (form) => [...form.elements].filter((e) => (e.name || e.id) && !['file', 'submit', 'button', 'reset', 'fieldset'].includes(e.type) && e.tagName !== 'BUTTON' && e.tagName !== 'FIELDSET');
const serialise = (form) => JSON.stringify(fieldsOf(form).map((e) => [e.name || e.id, e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value]));

export function clean(form) {
  if (!form) return;
  snapshots.set(form, serialise(form));
  form.__touched = false;
  form.removeAttribute('data-dirty');
}
export function touch(form) {
  if (!form) return;
  if (!snapshots.has(form)) snapshots.set(form, serialise(form));
  form.__touched = true;
  form.setAttribute('data-dirty', '');
}
function recheck(form) {
  if (!snapshots.has(form)) return;
  form.toggleAttribute('data-dirty', !!form.__touched || serialise(form) !== snapshots.get(form));
}
export const isDirty = (form) => !!form?.hasAttribute('data-dirty');

/** Watch a form for unsaved changes. Safe to call more than once. */
export function watch(form) {
  if (!form || form.__watched) return form;
  form.__watched = true;
  const start = () => { if (!isDirty(form)) snapshots.set(form, serialise(form)); };
  form.addEventListener('focusin', start);
  form.addEventListener('pointerdown', start, true);
  form.addEventListener('input', () => recheck(form));
  form.addEventListener('change', () => recheck(form));
  form.addEventListener('saved', () => clean(form));
  return form;
}

const visibleView = () => $('[data-view]:not([hidden])');
const dirtyIn = (scope) => (!scope ? [] : scope.matches?.('form') ? (isDirty(scope) ? [scope] : []) : $$('form[data-dirty]', scope));

/** Ask before unsaved work in `scope` is thrown away. True when it may go. */
export async function mayLeave(scope = visibleView(), what = 'your changes') {
  const dirty = dirtyIn(scope).filter((f) => !f.closest('[hidden]'));
  if (!dirty.length) return true;
  const ok = await confirmDialog({ title: 'Discard unsaved changes?', body: `If you leave now, ${what} will be lost.`, confirm: 'Discard' });
  if (ok) dirty.forEach(clean);
  return ok;
}

/* ---------- the shell ---------- */
const phone = matchMedia('(max-width: 960px)');

/**
 * Wires the behaviour every tool shares. `route` re-reads the hash. Returns
 * `menu(name)`, which the router calls first: true when the phone's list of
 * sections is showing instead of a view.
 */
export function initShell({ panel, route }) {
  // the phone's list of sections is its own screen; on a wider window the sidebar is always there
  const menu = (name) => {
    const on = name === 'menu' && phone.matches;
    document.body.classList.toggle('is-menu', on);
    if (on) for (const v of $$('[data-view]')) v.hidden = true;
    return on;
  };
  phone.addEventListener('change', () => { if (!phone.matches && document.body.classList.contains('is-menu')) route(); });

  // moving to another section with unsaved work asks first
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || panel.hidden || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const target = a.getAttribute('href').slice(1).split('?')[0];
    const current = visibleView()?.dataset.view;
    if (!current || target === current || !dirtyIn(visibleView()).length) return;
    e.preventDefault();
    if (await mayLeave()) location.hash = a.getAttribute('href');
  }, true);
  // and so does closing or reloading the page
  addEventListener('beforeunload', (e) => {
    if (!panel.hidden && dirtyIn(document).some((f) => !f.closest('[hidden]'))) { e.preventDefault(); e.returnValue = ''; }
  });

  document.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    // Ctrl+S or Cmd+S saves the form in front of you
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      const view = visibleView();
      if (!view) return;
      // only the forms that save settings or a product; never a reply, which would send an email
      const form = [e.target.closest?.('form'), ...dirtyIn(view)].find((f) => f?.__watched && !f.closest('[hidden]'));
      if (!form || !view.contains(form)) return;
      e.preventDefault();
      if (form.querySelector('[type="submit"]:not([disabled])')) form.requestSubmit();
      return;
    }
    // "/" goes to this view's search field
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const search = visibleView()?.querySelector('input[type="search"]');
      if (search && !search.closest('[hidden]')) { e.preventDefault(); search.focus(); search.select(); }
    }
  });
  return { menu };
}

/**
 * Arrow keys, Home and End move through a list of rows (Mail). `onPick(id)`
 * shows the row's item; focus stays in the list so the next arrow keeps going.
 */
export function arrowKeys(list, rowSelector, onPick) {
  list.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const rows = $$(rowSelector, list);
    const i = rows.indexOf(e.target.closest(rowSelector));
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (j === i) return;
    const id = rows[j].dataset.id;
    onPick(id);
    const again = list.querySelector(`${rowSelector}[data-id="${CSS.escape(id)}"]`) || rows[j];
    again.focus();
    again.scrollIntoView({ block: 'nearest' });
  });
}

/** The phone's one-pane-at-a-time: a back button for the detail pane. */
export function backButton(label, onBack) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'md-back';
  b.textContent = label;
  b.addEventListener('click', onBack);
  return b;
}
