// "What fits" on a packaging product's page (UX-8). The page is built with the sizes'
// "holds" as they were at the last deploy; the team can set, change or clear them
// since (a form or a spreadsheet import), so the live update (pd-live.js) adds the
// row after Sizes, changes it, or removes it. Values are only ever set as text.

/** Show value as the "What fits" row of the specification sheet, or remove the row when value is empty. */
export function showFits(value, doc = document) {
  const dd = doc.querySelector('[data-fact="fits"]');
  if (!value) { dd?.closest('.spec-row')?.remove(); return; }
  if (dd) { if (dd.textContent !== value) dd.textContent = value; return; }
  const sizes = doc.querySelector('.spec-row[data-row="sizes"]');
  if (!sizes) return;
  const row = doc.createElement('div'); row.className = 'spec-row'; row.dataset.row = 'fits';
  const dt = doc.createElement('dt'); dt.textContent = 'What fits';
  const v = doc.createElement('dd'); v.className = 'v'; v.dataset.fact = 'fits'; v.textContent = value;
  const d = doc.createElement('dd'); d.className = 'd'; d.textContent = 'From the packaging team';
  row.append(dt, v, d);
  sizes.after(row);
}
