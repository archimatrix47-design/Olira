// Products: the agriculture page's stack, in order. The list on the left; the
// chosen product (or a new one) in the editor beside it.
import { $, h, api, toast, confirmDialog, busy, uploadImage } from './api.js';
import * as store from './store.js';
import { scrollBehavior } from './motion.js';
import { watch, clean, touch, mayLeave } from './tools.js';
import { sparkline, deltaChip, empty } from './charts.js';
import { int, decimal, delta, NO_DATA } from './format.js';

let items = [];
let editingId = null;
let mode = null; // null (nothing open), 'add' or 'edit'
let bound = false;
const form = $('#productForm');
const field = (name) => form.elements.namedItem(name);

export async function show() {
  if (!bound) { bound = true; bind(); }
  const sel = $('[data-view="products"] [data-period]');
  store.periodSelect(sel, () => renderPerformance());
  sel.value = String(store.getDays());
  await load();
  renderPerformance();
}

/* ---------- performance ---------- */
// Content completeness, out of 100: what a buyer needs to judge the product.
function contentScore(p) {
  const checks = [
    [30, !!p.image, 'photo'],
    [20, String(p.description || '').length >= 120, 'a fuller description (120 characters or more)'],
    [10, !!p.purity, 'purity'],
    [10, !!p.moq, 'minimum order'],
    [20, (p.specs || []).length >= 3, 'at least 3 key points'],
    [10, /^(sesame|pulses|spices|coffee|specialty)$/i.test(p.category || ''), 'a standard category'],
  ];
  return { score: checks.reduce((n, [pts, ok]) => n + (ok ? pts : 0), 0), missing: checks.filter(([, ok]) => !ok).map(([, , label]) => label) };
}

async function renderPerformance() {
  const box = $('#prPerformance');
  try {
    const a = await store.analytics();
    const stats = new Map((a.products || []).map((x) => [x.name, x]));
    const rows = items.map((p) => {
      const s = stats.get(p.name) || { clicks: 0, inquiries: 0, prevClicks: 0, daily: [] };
      return { p, s, c: contentScore(p) };
    }).sort((x, y) => y.s.clicks - x.s.clicks || y.s.inquiries - x.s.inquiries);
    if (!rows.length) { box.replaceChildren(empty('Add products to see how they perform.')); return; }
    const table = h('table', { class: 'a-table a-perf' },
      h('caption', { class: 'sr-only' }, 'Product performance'),
      h('thead', {}, h('tr', {}, ['Product', 'Details opened', 'Enquiries', 'Enquiries per 100 opens', 'Trend', 'Content'].map((t, i) => h('th', { scope: 'col', class: i && i < 4 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map(({ p, s, c }) => {
        const flags = [];
        if (s.clicks >= 10 && !s.inquiries) flags.push(h('span', { class: 'flag' }, 'Interest, no enquiries'));
        if (!p.image) flags.push(h('span', { class: 'flag' }, 'No photo'));
        if (!s.clicks) flags.push(h('span', { class: 'flag info' }, 'Not opened'));
        const meter = h('i'); const fill = h('b'); fill.style.width = `${c.score}%`; meter.append(fill);
        return h('tr', {},
          h('th', { scope: 'row' }, p.name, ...flags),
          h('td', { class: 'num' }, int(s.clicks), deltaChip(delta(s.clicks, s.prevClicks), true)),
          h('td', { class: 'num' }, int(s.inquiries)),
          h('td', { class: 'num' }, s.clicks ? decimal((s.inquiries / s.clicks) * 100) : NO_DATA),
          h('td', {}, s.daily?.some(Boolean) ? sparkline(s.daily, { width: 110, height: 28, label: `${p.name} opened per day` }) : h('span', { class: 'a-note' }, 'No opens')),
          h('td', {}, h('span', { class: 'v-meter', title: c.missing.length ? `Add ${c.missing.join(', ')}` : 'Complete' }, meter, `${c.score}`, h('span', { class: 'sr-only' }, c.missing.length ? ` out of 100. Missing ${c.missing.join(', ')}` : ' out of 100, complete'))));
      })));
    const incomplete = rows.filter((r) => r.c.missing.length);
    box.replaceChildren(h('div', { class: 'a-scroll' }, table),
      incomplete.length ? h('p', { class: 'v-note' }, `To strengthen: ${incomplete.slice(0, 3).map((r) => `${r.p.name} needs ${r.c.missing.join(', ')}`).join('. ')}.`) : h('p', { class: 'v-note' }, 'Every product has a photo, a full description, purity, minimum order and key points.'));
  } catch (e) { if (e.status !== 401) box.replaceChildren(empty('Performance could not load.')); }
}

async function load() {
  try {
    items = await api('/api/products');
    if (!Array.isArray(items)) items = [];
    renderList();
  } catch (e) { toast(e.message, 'error'); }
}

const iconBtn = (label, path, onclick, disabled) => h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': label, title: label, onclick, disabled },
  (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.append(p); return s; })());

function renderList(focusId, focusWhich) {
  const list = $('#productList');
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'a-empty' }, h('strong', {}, 'No products yet'), 'Add the first product with Add product.'));
    return;
  }
  list.replaceChildren(...items.map((p, i) => h('li', { class: `a-prow${p.id === editingId ? ' is-editing' : ''}`, 'data-id': p.id },
    h('button', { class: 'a-prow-open', type: 'button', 'aria-label': `Edit ${p.name}`, 'aria-current': p.id === editingId ? 'true' : null, onclick: () => edit(p) },
      h('span', { class: 'pos', 'aria-hidden': 'true' }, String(i + 1)),
      p.image ? h('img', { src: p.image, alt: '', width: '52', height: '52', loading: 'lazy' }) : h('span', { class: 'ph' }, 'No photo'),
      h('span', { class: 'a-prow-text' },
        h('h3', {}, p.name),
        h('p', {}, [p.category, p.purity && `Purity ${p.purity}`, p.moq && `Min. ${p.moq}`].filter(Boolean).join(', ')))),
    h('div', { class: 'a-prow-actions' },
      iconBtn(`Move ${p.name} up`, 'M12 19V5M6 11l6-6 6 6', () => move(i, -1), i === 0),
      iconBtn(`Move ${p.name} down`, 'M12 5v14M6 13l6 6 6-6', () => move(i, 1), i === items.length - 1)))));
  if (focusId) {
    const row = list.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    const btns = row?.querySelectorAll('.btn-icon');
    const target = btns && (focusWhich === 'up' ? btns[0] : focusWhich === 'down' ? btns[1] : null);
    (target && !target.disabled ? target : row?.querySelector('.a-prow-open'))?.focus();
  }
}

async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  const before = items.slice();
  [items[i], items[j]] = [items[j], items[i]];
  const moved = items[j];
  renderList(moved.id, dir < 0 ? 'up' : 'down');
  try {
    await api('/api/products/order', { method: 'POST', body: { ids: items.map((p) => p.id) } });
    $('#productLive').textContent = `${moved.name} moved to position ${j + 1} of ${items.length}.`;
  } catch (e) {
    items = before; renderList();
    toast(e.message, 'error');
  }
}

/* ---------- editor ---------- */
function bind() {
  watch(form);
  const add = async () => { if (await mayLeave($('#productEditor'))) { startAdd(); field('name').focus(); } };
  $('#productNew').addEventListener('click', add);
  $('[data-add="product"]').addEventListener('click', add);
  $('#productCancel').addEventListener('click', async () => { if (await mayLeave($('#productEditor'))) close(); });
  $('[data-back="product"]').addEventListener('click', async () => { if (await mayLeave($('#productEditor'))) close(); });
  $('#productDelete').addEventListener('click', () => { const p = items.find((x) => x.id === editingId); if (p) remove(p); });
  for (const n of ['name', 'category']) field(n).addEventListener('input', preview);

  const file = $('#pImage'), drop = $('#pDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) upload(file.files[0]); });
  $('#pImageClear').addEventListener('click', () => { field('image').value = ''; field('image').dispatchEvent(new Event('change', { bubbles: true })); preview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = field('name').value.trim(), description = field('description').value.trim();
    const errs = [[field('name'), $('#pNameErr'), !name && 'Give the product a name.'], [field('description'), $('#pDescErr'), !description && 'Add a short description for the product details.']];
    let first = null;
    for (const [input, err, msg] of errs) {
      err.hidden = !msg; err.textContent = msg || '';
      if (msg) { input.setAttribute('aria-invalid', 'true'); first ||= input; } else input.removeAttribute('aria-invalid');
    }
    if (first) return first.focus();
    const specs = field('specs').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (specs.length > 20) return toast('Keep the key points to 20 lines or fewer.', 'error');
    // the server files a new product under a slug of its name; never overwrite another product that way
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!editingId && items.some((p) => p.id === slug)) {
      field('name').setAttribute('aria-invalid', 'true');
      $('#pNameErr').textContent = 'A product with this name already exists. Edit that one, or choose another name.';
      $('#pNameErr').hidden = false;
      return field('name').focus();
    }
    const product = {
      id: editingId || undefined, name, description,
      category: field('category').value.trim() || 'General',
      purity: field('purity').value.trim(), moq: field('moq').value.trim(),
      specs, image: field('image').value || null,
    };
    const done = busy($('#productSave'));
    try {
      const r = await api('/api/products', { method: 'POST', body: { product } });
      const saved = r.product;
      const idx = items.findIndex((p) => p.id === saved.id);
      if (idx >= 0) items[idx] = saved; else items.push(saved);
      toast(idx >= 0 ? `${saved.name} saved.` : `${saved.name} added at the end of the stack.`);
      done();
      // the saved product stays open, as it now is on the website
      fill(saved);
      renderList(saved.id);
      store.invalidate('products'); renderPerformance();
    } catch (x) { toast(x.message, 'error'); done(); }
  });
  close();
}

async function upload(fileObj) {
  if (!/^image\/(jpeg|png|webp)$/.test(fileObj.type)) return toast('Choose a JPG, PNG or WebP photo.', 'error');
  if (fileObj.size > 10 * 1024 * 1024) return toast('That photo is over 10 MB. Export a smaller copy.', 'error');
  const drop = $('#pDrop strong'), label = drop.textContent;
  drop.textContent = 'Uploading';
  try {
    const r = await uploadImage(fileObj, editingId || field('name').value || 'product');
    field('image').value = r.path;
    touch(form);
    preview();
    toast('Photo uploaded. Save the product to use it.');
  } catch (e) { toast(e.message, 'error'); }
  finally { drop.textContent = label; $('#pImage').value = ''; }
}

function preview() {
  const fig = $('#pPreview'), img = fig.querySelector('img'), path = field('image').value;
  img.hidden = !path; if (path) img.src = path; else img.removeAttribute('src');
  fig.querySelector('.ph').hidden = !!path;
  fig.querySelector('[data-preview-name]').textContent = field('name').value.trim() || 'Product name';
  fig.querySelector('[data-preview-cat]').textContent = field('category').value.trim() || 'Category';
  $('#pImageClear').hidden = !path;
}

/** Show the editor (or, with nothing open, its empty state), and on a phone the editor alone. */
function showEditor(open) {
  $('#productEmpty').hidden = open;
  form.hidden = !open;
  $('#productPanes').classList.toggle('is-detail', open);
}

function fill(p) {
  mode = 'edit';
  editingId = p.id;
  field('id').value = p.id;
  field('name').value = p.name || '';
  field('category').value = p.category || '';
  field('purity').value = p.purity || '';
  field('moq').value = p.moq || '';
  field('description').value = p.description || '';
  field('specs').value = (p.specs || []).join('\n');
  field('image').value = p.image || '';
  $('#editorTitle').textContent = p.name;
  $('#productSave').textContent = 'Save changes';
  $('#productDangerZone').hidden = false;
  clearErrors(); preview();
  showEditor(true);
  clean(form);
}

async function edit(p) {
  if (editingId === p.id && mode === 'edit') { field('name').focus(); return; }
  if (!(await mayLeave($('#productEditor')))) return;
  fill(p);
  renderList();
  $('#productEditor').scrollTop = 0;
  if (matchMedia('(max-width: 760px)').matches) scrollTo({ top: 0, behavior: scrollBehavior() });
  else $('#productEditor').scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  field('name').focus({ preventScroll: true });
}

function startAdd() {
  mode = 'add';
  editingId = null;
  form.reset();
  field('id').value = ''; field('image').value = '';
  $('#editorTitle').textContent = 'Add product';
  $('#productSave').textContent = 'Save product';
  $('#productDangerZone').hidden = true;
  clearErrors(); preview();
  showEditor(true);
  clean(form);
  if (items.length) renderList();
}

/** Nothing open: the editor shows how to start. */
function close() {
  const was = editingId;
  mode = null;
  editingId = null;
  form.reset();
  field('id').value = ''; field('image').value = '';
  clearErrors(); preview();
  showEditor(false);
  clean(form);
  if (items.length) renderList(was || undefined);
}
function clearErrors() {
  for (const id of ['pNameErr', 'pDescErr']) { $(`#${id}`).hidden = true; }
  field('name').removeAttribute('aria-invalid'); field('description').removeAttribute('aria-invalid');
}

async function remove(p) {
  const ok = await confirmDialog({ title: `Delete ${p.name}?`, body: 'It is removed from the agriculture page straight away. This cannot be undone.' });
  if (!ok) return;
  try {
    await api(`/api/products/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    items = items.filter((x) => x.id !== p.id);
    if (editingId === p.id) { clean(form); close(); } else renderList();
    toast(`${p.name} deleted.`);
    store.invalidate('products'); renderPerformance();
  } catch (e) { toast(e.message, 'error'); }
}
