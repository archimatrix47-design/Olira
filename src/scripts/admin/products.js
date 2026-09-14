// Products: the agriculture page's stack, in order.
import { $, h, api, toast, confirmDialog, busy, uploadImage } from './api.js';

let items = [];
let editingId = null;
let bound = false;
const form = $('#productForm');
const field = (name) => form.elements.namedItem(name);

export async function show() {
  if (!bound) { bound = true; bind(); }
  await load();
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
    list.replaceChildren(h('li', { class: 'a-empty' }, h('strong', {}, 'No products yet'), 'Add the first product with the form.'));
    return;
  }
  list.replaceChildren(...items.map((p, i) => h('li', { class: `a-prow${p.id === editingId ? ' is-editing' : ''}`, 'data-id': p.id },
    h('span', { class: 'pos', 'aria-hidden': 'true' }, String(i + 1)),
    p.image ? h('img', { src: p.image, alt: '', width: '64', height: '64', loading: 'lazy' }) : h('span', { class: 'ph' }, 'No photo'),
    h('div', {},
      h('h3', {}, p.name),
      h('p', {}, [p.category, p.purity && `Purity ${p.purity}`, p.moq && `Min. ${p.moq}`].filter(Boolean).join(', '))),
    h('div', { class: 'a-prow-actions' },
      iconBtn(`Move ${p.name} up`, 'M12 19V5M6 11l6-6 6 6', () => move(i, -1), i === 0),
      iconBtn(`Move ${p.name} down`, 'M12 5v14M6 13l6 6 6-6', () => move(i, 1), i === items.length - 1),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => edit(p), 'aria-label': `Edit ${p.name}` }, 'Edit'),
      h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', onclick: () => remove(p), 'aria-label': `Delete ${p.name}` }, 'Delete')))));
  if (focusId) {
    const row = list.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    const btns = row?.querySelectorAll('.btn-icon');
    const target = btns && (focusWhich === 'up' ? btns[0] : btns[1]);
    (target && !target.disabled ? target : row?.querySelector('.btn-secondary'))?.focus();
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
  $('#productNew').addEventListener('click', () => { reset(); field('name').focus(); });
  $('#productCancel').addEventListener('click', reset);
  for (const n of ['name', 'category']) field(n).addEventListener('input', preview);

  const file = $('#pImage'), drop = $('#pDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) upload(file.files[0]); });
  $('#pImageClear').addEventListener('click', () => { field('image').value = ''; preview(); });

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
    const specs = field('specs').value.split('\n').map((s) => s.trim()).filter(Boolean);
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
      reset();
      renderList(saved.id);
    } catch (x) { toast(x.message, 'error'); }
    finally { done(); }
  });
  reset();
}

async function upload(fileObj) {
  if (!/^image\/(jpeg|png|webp)$/.test(fileObj.type)) return toast('Choose a JPG, PNG or WebP photo.', 'error');
  if (fileObj.size > 10 * 1024 * 1024) return toast('That photo is over 10 MB. Export a smaller copy.', 'error');
  const drop = $('#pDrop strong'), label = drop.textContent;
  drop.textContent = 'Uploading';
  try {
    const r = await uploadImage(fileObj, editingId || field('name').value || 'product');
    field('image').value = r.path;
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

function edit(p) {
  editingId = p.id;
  field('id').value = p.id;
  field('name').value = p.name || '';
  field('category').value = p.category || '';
  field('purity').value = p.purity || '';
  field('moq').value = p.moq || '';
  field('description').value = p.description || '';
  field('specs').value = (p.specs || []).join('\n');
  field('image').value = p.image || '';
  $('#editorTitle').textContent = `Edit ${p.name}`;
  $('#productSave').textContent = 'Save changes';
  $('#productCancel').hidden = false;
  clearErrors(); preview(); renderList();
  $('.a-editor').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  field('name').focus({ preventScroll: true });
}

function reset() {
  editingId = null;
  form.reset();
  field('id').value = ''; field('image').value = '';
  $('#editorTitle').textContent = 'Add product';
  $('#productSave').textContent = 'Save product';
  $('#productCancel').hidden = true;
  clearErrors(); preview();
  if (items.length) renderList();
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
    if (editingId === p.id) reset();
    renderList();
    toast(`${p.name} deleted.`);
  } catch (e) { toast(e.message, 'error'); }
}
