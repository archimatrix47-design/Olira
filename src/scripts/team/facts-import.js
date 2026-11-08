// The catalogue's facts as a spreadsheet, for the packaging and agriculture teams
// (UX-2): "Download as a spreadsheet" saves what the site knows (blank cells are
// what is missing); "Import a filled spreadsheet" reads the file, shows every change
// and every row the server refused, and saves only on "Save these changes". The
// server checks the file with the same rules as the forms (lib/facts-csv.js).
import { $, h, api, toast, busy, getToken } from '../admin/api.js';

const blank = (v) => v === null || v === undefined || v === '';
const cellOf = (v) => h('td', blank(v) ? { class: 'is-blank' } : {}, blank(v) ? 'blank' : String(v));

/**
 * Wire one screen: download and import buttons, the hidden file input, the preview
 * box. onSaved runs after a successful import, to reload the screen.
 */
export function mountFactsImport({ download, upload, filename, downloadBtn, importBtn, fileInput, preview, onSaved }) {
  if (!downloadBtn || !importBtn || !fileInput || !preview) return;
  downloadBtn.addEventListener('click', async () => {
    const done = busy(downloadBtn);
    try {
      const r = await fetch(download, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new Error('The spreadsheet could not be made. Try again.');
      const url = URL.createObjectURL(await r.blob());
      const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Spreadsheet downloaded. Fill in the blank cells, keep the columns as they are, then import it.');
    } catch (e) { toast(e.message, 'error'); }
    done();
  });
  importBtn.addEventListener('click', () => fileInput.click());
  let text = '';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 300_000) return toast('That file is over 300 KB. Import the spreadsheet you downloaded here.', 'error');
    text = await file.text();
    try { render(await api(upload, { method: 'POST', body: { csv: text, apply: false } }), file.name); }
    catch (e) { toast(e.message, 'error'); }
  });

  function render(r, name) {
    const n = r.changes.length, bad = r.errors.length;
    const products = new Set(r.changes.map((c) => c.product)).size;
    const title = h('h2', { class: 'a-label' }, `Import from ${name}`);
    const summary = h('p', {}, bad
      ? `${bad} row${bad === 1 ? '' : 's'} cannot be imported. Nothing is saved until every row can be: correct the file and import it again.`
      : n ? `${n} change${n === 1 ? '' : 's'} to ${products} product${products === 1 ? '' : 's'}. Check them, then save.` : 'This file changes nothing: every value is the same as on the site.');
    const parts = [title, summary];
    if (bad) parts.push(h('ul', { class: 'a-import-errors' }, ...r.errors.slice(0, 50).map((e) => h('li', {}, `Row ${e.line}: ${e.message}`))));
    if (n) {
      const table = h('table', { class: 'a-table' },
        h('thead', {}, h('tr', {}, ...['Product', 'Size', 'What', 'Now', 'New'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...r.changes.slice(0, 300).map((c) => h('tr', {}, h('td', {}, c.product), h('td', {}, c.sizeLabel || c.size || 'Whole product'), h('td', {}, c.field), cellOf(c.from), cellOf(c.to)))));
      parts.push(h('div', { class: 'a-scroll' }, table));
      if (n > 300) parts.push(h('p', { class: 'hint' }, `And ${n - 300} more.`));
    }
    const actions = h('div', { class: 'a-actions' });
    if (n && !bad) {
      const save = h('button', { class: 'btn btn-primary', type: 'button' }, `Save ${n} change${n === 1 ? '' : 's'}`);
      save.addEventListener('click', async () => {
        const done = busy(save);
        try {
          const out = await api(upload, { method: 'POST', body: { csv: text, apply: true } });
          if (!out.applied) throw new Error('Nothing was saved. Import the file again to see why.');
          preview.hidden = true; preview.replaceChildren();
          toast(`${n} change${n === 1 ? '' : 's'} saved. The website shows them now.`);
          await onSaved?.();
        } catch (e) { toast(e.message, 'error'); done(); }
      });
      actions.append(save);
    }
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button' }, n && !bad ? 'Cancel' : 'Close');
    cancel.addEventListener('click', () => { preview.hidden = true; preview.replaceChildren(); importBtn.focus(); });
    actions.append(cancel);
    parts.push(actions);
    preview.replaceChildren(...parts);
    preview.hidden = false;
    preview.scrollIntoView({ block: 'start', behavior: 'smooth' });
    title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true });
  }
}
