// Packaging products: the catalogue on the packaging page, looked after by the
// packaging team. Each has a group (family), its sizes, a minimum order and how
// many print colours it takes. A product with a photo and the four corners of
// its printable panel is also in the mockup studio and in Mockups here.
import { $, $$, h, api, toast, confirmDialog, busy } from '../admin/api.js';
import { prepare, render, defaultDesign } from '../mockup/engine.js';
import { scrollBehavior } from '../admin/motion.js';
import * as store from '../admin/store.js';
import { DEFAULT_QUAD, convex, cornerEditor } from '../admin/corners.js';
import { watch, clean, touch, mayLeave } from '../admin/tools.js';
import { packCompleteness, completeLine } from '../admin/completeness.js';
import { thumbUrl } from '../../../lib/thumb-url.js';

let items = [];
let bound = false;
let draft = null;
const form = () => $('#packForm');
const field = (name) => form().elements.namedItem(name);

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    items = await api('/api/packaging-products?scope=all');
    if (!Array.isArray(items)) items = [];
    if (!draft) close(); else renderList();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

const usable = (p) => !!(p.image && Array.isArray(p.quad) && p.quad.length === 4);
const FAMILY = { bags: 'Paper bags', food: 'Bakery and food boxes', medical: 'Medical packets', foil: 'Aluminium foil bags' };
const num = (n) => Number(n).toLocaleString('en-US');
/** Whole units from what was typed ("5,000"), null when blank, NaN when not a whole number. */
const unitsOf = (v) => { const t = String(v ?? '').replace(/[\s,]/g, ''); if (!t) return null; const n = Number(t); return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : NaN; };

/* ---------------- list ---------------- */
const svgIcon = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
  return s;
};
function renderList(focusId, which) {
  const list = $('#packList');
  const done = $('#packComplete');
  done.hidden = !items.length; done.textContent = completeLine(items, packCompleteness);
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'a-empty' }, h('strong', {}, 'No packaging products yet'), 'Add the first product with the form.'));
    return;
  }
  list.replaceChildren(...items.map((p, i) => h('li', { class: `a-prow${draft?.id === p.id ? ' is-editing' : ''}`, 'data-id': p.id },
    h('button', { class: 'a-prow-open', type: 'button', 'aria-label': `Edit ${p.name}`, 'aria-current': draft?.id === p.id ? 'true' : null, onclick: () => edit(p) },
    h('span', { class: 'pos', 'aria-hidden': 'true' }, String(i + 1)),
    p.image ? h('img', { src: thumbUrl(p.image, 120), alt: '', width: '52', height: '52', loading: 'lazy', style: 'object-fit:contain;background:var(--site-stage)' }) : h('span', { class: 'ph' }, 'No photo'),
    h('span', { class: 'a-prow-text' },
      h('h3', {}, p.name),
      h('p', {}, [
        FAMILY[p.family || 'bags'],
        p.minOrder ? `minimum ${num(p.minOrder)}` : 'no minimum set',
        p.site === false ? 'Hidden on the website' : null,
        usable(p) ? (p.imageDark ? 'Visitors can design it in the studio, with a dark mode photo' : 'Visitors can design it in the studio')
          : p.image ? 'Quote only on the website: place the print corners to put it in the studio' : 'Quote only on the website: add a photo to put it in the studio',
        p.team === false ? 'not in Mockups' : null,
      ].filter(Boolean).join(', ')),
      (() => { const c = packCompleteness(p); return h('p', { class: `a-missing${c.complete ? ' is-done' : ''}` }, c.complete ? 'Complete' : `Missing: ${c.missing.join(', ')}`); })())),
    h('div', { class: 'a-prow-actions' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} up`, title: 'Move up', disabled: i === 0 || null, onclick: () => move(i, -1) }, svgIcon('M12 19V5M6 11l6-6 6 6')),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} down`, title: 'Move down', disabled: i === items.length - 1 || null, onclick: () => move(i, 1) }, svgIcon('M12 5v14M6 13l6 6 6-6'))))));
  if (focusId) {
    const row = list.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    const btns = row?.querySelectorAll('.btn-icon');
    const t = btns && (which === 'up' ? btns[0] : which === 'down' ? btns[1] : null);
    (t && !t.disabled ? t : row?.querySelector('.a-prow-open'))?.focus();
  }
}

async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  const before = items.slice();
  [items[i], items[j]] = [items[j], items[i]];
  renderList(items[j].id, dir < 0 ? 'up' : 'down');
  try {
    await api('/api/team/packaging-products/order', { method: 'POST', body: { ids: items.map((p) => p.id) } });
    store.invalidate('packaging');
    $('#packLive').textContent = `${items[j].name} moved to position ${j + 1} of ${items.length}.`;
  } catch (e) { items = before; renderList(); toast(e.message, 'error'); }
}

async function remove(p) {
  const ok = await confirmDialog({ title: `Delete ${p.name}?`, body: 'It is removed from the packaging page, the mockup studio and Mockups straight away.' });
  if (!ok) return;
  try {
    await api(`/api/team/packaging-products/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    store.invalidate('packaging');
    items = items.filter((x) => x.id !== p.id);
    if (draft?.id === p.id) { clean(form()); close(); } else renderList();
    toast(`${p.name} deleted.`);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- editor ---------------- */
function bind() {
  watch(form());
  const add = async () => { if (await mayLeave($('#packEditor'))) { startAdd(); field('name').focus(); } };
  $('#packNew').addEventListener('click', add);
  $('[data-add="pack"]').addEventListener('click', add);
  $('#packCancel').addEventListener('click', async () => { if (await mayLeave($('#packEditor'))) close(); });
  $('[data-back="pack"]').addEventListener('click', async () => { if (await mayLeave($('#packEditor'))) close(); });
  $('#packDelete').addEventListener('click', () => { const p = items.find((x) => x.id === draft?.id); if (p) remove(p); });
  for (const variant of ['light', 'dark']) {
    const input = $(`#packFile-${variant}`), drop = $(`#packDrop-${variant}`);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0], variant); });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0], variant); input.value = ''; });
  }
  $('#packClearPhoto').addEventListener('click', () => { Object.assign(draft, { image: null, imageDark: null, width: null, height: null, quad: null }); touch(form()); syncPhoto(); });
  $('#packClearDark').addEventListener('click', () => { draft.imageDark = null; touch(form()); syncPhoto(); });
  $('#packSafe').addEventListener('input', (e) => { draft.safeTop = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); schedulePreview(); });
  $('#packInk').addEventListener('change', schedulePreview);
  $('#packSample').addEventListener('input', schedulePreview);
  $$('input[name="packPreviewTheme"]').forEach((r) => r.addEventListener('change', schedulePreview));
  $('#pkAddSize').addEventListener('click', () => { addSizeRow({}); touch(form()); $('#pkSizes li:last-child input').focus(); });
  $('#packResetCorners').addEventListener('click', () => { draft.quad = DEFAULT_QUAD.map((p) => p.slice()); touch(form()); placeHandles(); schedulePreview(); say('Corners reset. Drag them onto the panel.'); });
  // moving a corner is a change to save
  corners = cornerEditor($('#packStage'), $('#packPoly'), () => draft, () => { touch(form()); schedulePreview(); });
  form().addEventListener('submit', submit);
}

const say = (msg) => { const s = $('#packStatus'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };

/** Show the editor (or, with nothing open, its empty state), and on a phone the editor alone. */
function showEditor(open) {
  $('#packEmpty').hidden = open;
  form().hidden = !open;
  $('#packPanes').classList.toggle('is-detail', open);
}

function blank() {
  draft = { id: null, image: null, imageDark: null, width: null, height: null, quad: null, safeTop: 0.1 };
  form().reset();
  field('site').checked = true; field('team').checked = true;
  setSizes([]);
  $('#packSafe').value = 10;
  clearErrors();
}

function startAdd() {
  blank();
  $('#packTitle').textContent = 'Add packaging product';
  $('#packSave').textContent = 'Save product';
  $('#packDangerZone').hidden = true;
  syncPhoto();
  showEditor(true);
  clean(form());
  renderList();
}

/** Nothing open: the editor shows how to start. */
function close() {
  const was = draft?.id;
  blank();
  draft = null;
  showEditor(false);
  clean(form());
  renderList(was || undefined);
}

function fill(p) {
  draft = { id: p.id, image: p.image || null, imageDark: p.imageDark || null, width: p.width || null, height: p.height || null, quad: p.quad ? p.quad.map((q) => q.slice()) : null, safeTop: p.safeTop ?? 0.1 };
  field('name').value = p.name || '';
  field('handle').value = p.handle || '';
  field('description').value = p.description || '';
  field('family').value = p.family || 'bags';
  field('minOrder').value = p.minOrder ? num(p.minOrder) : '';
  field('printColours').value = Number.isInteger(p.printColours) ? String(p.printColours) : '';
  setSizes(p.sizes || []);
  field('specs').value = (p.specs || []).join('\n');
  field('site').checked = p.site !== false;
  field('team').checked = p.team !== false;
  $('#packSafe').value = Math.round((p.safeTop ?? 0.1) * 100);
  $('#packTitle').textContent = p.name;
  $('#packSave').textContent = 'Save changes';
  $('#packDangerZone').hidden = false;
  clearErrors();
  syncPhoto();
  showEditor(true);
  clean(form());
}

async function edit(p) {
  if (draft?.id === p.id) { field('name').focus(); return; }
  if (!(await mayLeave($('#packEditor')))) return;
  fill(p);
  renderList();
  $('#packEditor').scrollTop = 0;
  if (matchMedia('(max-width: 760px)').matches) scrollTo({ top: 0, behavior: scrollBehavior() });
  else $('#packEditor').scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  field('name').focus({ preventScroll: true });
}

// a transparent image (a mockup export) stands on the site's stage colour and needs no dark photo
const isCutout = (image) => /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$|\/cutouts\//.test(image || '');

function syncPhoto() {
  const has = !!draft.image, cut = has && isCutout(draft.image);
  const lightImg = $('#packImg-light'), darkImg = $('#packImg-dark');
  lightImg.hidden = !has; if (has) lightImg.src = draft.image; else lightImg.removeAttribute('src');
  darkImg.hidden = !draft.imageDark; if (draft.imageDark) darkImg.src = draft.imageDark; else darkImg.removeAttribute('src');
  $('#packClearPhoto').hidden = !has;
  $('#packClearDark').hidden = !draft.imageDark;
  $('#packDarkWrap').hidden = !has || cut;
  $('#packStage').classList.toggle('is-cutout', cut);
  $('#packPreview').classList.toggle('is-cutout', cut);
  $('#packStudio').hidden = !has;
  $('#packWarn').hidden = true;
  if (has) {
    if (!draft.quad) draft.quad = DEFAULT_QUAD.map((p) => p.slice());
    $('#packStageImg').src = draft.image;
    placeHandles();
    schedulePreview();
  }
}

async function upload(file, variant) {
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) return toast('Choose a JPG, PNG or WebP photo.', 'error');
  if (file.size > 15 * 1024 * 1024) return toast('The photo can be up to 15 MB.', 'error');
  if (variant === 'dark' && !draft.image) return toast('Add the white background photo first.', 'error');
  const label = $(`#packDrop-${variant} strong`), text = label.textContent;
  label.textContent = 'Uploading';
  const fd = new FormData();
  fd.append('image', file);
  fd.append('variant', variant);
  fd.append('name', field('name').value || 'bag');
  if (variant === 'dark') fd.append('light', draft.image);
  try {
    const r = await api('/api/team/packaging-products/image', { method: 'POST', form: fd });
    touch(form());
    if (variant === 'light') {
      const changedShape = draft.width && Math.abs(r.width / r.height - draft.width / draft.height) > 0.01;
      Object.assign(draft, { image: r.path, width: r.width, height: r.height });
      if (!draft.quad || changedShape) draft.quad = DEFAULT_QUAD.map((p) => p.slice());
      // a dark photo was checked against the old shot, so it goes with it
      draft.imageDark = null;
      syncPhoto();
      if (r.warning) { $('#packWarn').textContent = r.warning; $('#packWarn').hidden = false; }
      toast(r.cutout ? 'Transparent image uploaded: it stands on the site like the other cut-outs and needs no dark photo. Place the four print corners, then save.' : 'Photo uploaded. Place the four print corners, then save.');
    } else {
      draft.imageDark = r.path;
      syncPhoto();
      toast('Dark mode photo added. It is used when a visitor has dark mode on.');
    }
    say(variant === 'light' ? 'Photo ready. Place the four corners.' : 'Dark mode photo ready.');
  } catch (e) { toast(e.message, 'error'); }
  finally { label.textContent = text; }
}

/* ---------------- corners ---------------- */
let corners = null;
const placeHandles = () => corners?.place();

let previewTimer = 0;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(drawPreview, 90); }
async function drawPreview() {
  if (!draft?.image || !draft.quad) return;
  const canvas = $('#packPreview'), msg = $('#packPreviewMsg');
  if (!convex(draft.quad)) { msg.textContent = 'The corners cross over. Put them in order: top left, top right, bottom right, bottom left.'; msg.hidden = false; return; }
  msg.hidden = true;
  const dark = $('input[name="packPreviewTheme"]:checked')?.value === 'dark';
  try {
    const B = await prepare({ image: draft.image, imageDark: draft.imageDark, quad: draft.quad, safeTop: draft.safeTop }, { dark });
    const text = $('#packSample').value.trim() || 'YOUR BRAND';
    render(canvas.getContext('2d'), B, { ...defaultDesign(), ink: $('#packInk').value, text1: text.slice(0, 18) });
  } catch (e) { msg.textContent = e.message; msg.hidden = false; }
}

function clearErrors() {
  for (const n of ['name', 'description']) { field(n).removeAttribute('aria-invalid'); $(`#pk${n === 'name' ? 'Name' : 'Desc'}Err`).hidden = true; }
  field('minOrder').removeAttribute('aria-invalid'); $('#pkMinErr').hidden = true;
}

/* ---------------- sizes ---------------- */
let sizeSeq = 0;
function addSizeRow(s) {
  const n = ++sizeSeq;
  const input = (name, label, value, attrs = {}) => h('input', { class: 'input', name: `${name}-${n}`, 'aria-label': label, value: value ?? '', autocomplete: 'off', ...attrs });
  const removeRow = (e) => { const row = e.currentTarget.closest('li'); const next = row.nextElementSibling || row.previousElementSibling; row.remove(); touch(form()); (next?.querySelector('input') || $('#pkAddSize')).focus(); };
  const li = h('li', { 'data-size-id': s.id || '' },
    input('sizeLabel', 'Size name', s.label, { maxlength: '40', placeholder: 'Medium' }),
    input('sizeW', 'Width in cm', s.w, { inputmode: 'decimal', maxlength: '6' }),
    input('sizeD', 'Depth in cm', s.d, { inputmode: 'decimal', maxlength: '6' }),
    input('sizeH', 'Height in cm', s.h, { inputmode: 'decimal', maxlength: '6' }),
    input('sizeMin', 'Minimum order for this size', s.minOrder ? num(s.minOrder) : '', { inputmode: 'numeric', maxlength: '12', placeholder: 'As product' }),
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Remove this size', title: 'Remove', onclick: removeRow }, svgIcon('M6 6l12 12M18 6L6 18')));
  $('#pkSizes').append(li);
}
function setSizes(list) { $('#pkSizes').replaceChildren(); list.forEach(addSizeRow); }
function readSizes() {
  const out = [];
  for (const li of $$('#pkSizes li')) {
    const [label, w, d, hgt, min] = $$('input', li).map((i) => i.value.trim());
    if (!label && !w && !d && !hgt && !min) continue;
    const dim = (v) => (v ? Number(v.replace(',', '.')) : null);
    const m = unitsOf(min);
    if (!label) return { error: 'Give every size a name, for example Medium.', el: $('input', li) };
    if ([w, d, hgt].some((v) => v && !(dim(v) > 0 && dim(v) <= 500))) return { error: `The measurements of ${label} must be centimetres, up to 500.`, el: $$('input', li)[1] };
    if (Number.isNaN(m)) return { error: `The minimum for ${label} must be a whole number of units.`, el: $$('input', li)[4] };
    out.push({ id: li.dataset.sizeId || undefined, label, w: dim(w), d: dim(d), h: dim(hgt), minOrder: m });
  }
  return { sizes: out };
}

async function submit(e) {
  e.preventDefault();
  const name = field('name').value.trim(), description = field('description').value.trim();
  const errs = [[field('name'), $('#pkNameErr'), !name && 'Give the product a name.'], [field('description'), $('#pkDescErr'), !description && 'Add a short description for the packaging page.']];
  let first = null;
  for (const [input, err, msg] of errs) {
    err.hidden = !msg; err.textContent = msg || '';
    if (msg) { input.setAttribute('aria-invalid', 'true'); first ||= input; } else input.removeAttribute('aria-invalid');
  }
  if (first) return first.focus();
  const minOrder = unitsOf(field('minOrder').value);
  if (Number.isNaN(minOrder)) { $('#pkMinErr').textContent = 'Enter a whole number of units, for example 5,000, or leave it blank.'; $('#pkMinErr').hidden = false; field('minOrder').setAttribute('aria-invalid', 'true'); return field('minOrder').focus(); }
  const sz = readSizes();
  if (sz.error) { toast(sz.error, 'error'); return sz.el?.focus(); }
  const specs = field('specs').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (specs.length > 12) return toast('Keep the key points to 12 lines or fewer.', 'error');
  if (draft.image && !convex(draft.quad)) { toast('The print corners cross over. Put them in order: top left, top right, bottom right, bottom left.', 'error'); return $('#packStage [data-corner="0"]').focus(); }
  const product = {
    id: draft.id || undefined, name, description, handle: field('handle').value.trim(), specs,
    family: field('family').value, minOrder, sizes: sz.sizes, printColours: field('printColours').value === '' ? null : Number(field('printColours').value),
    image: draft.image, imageDark: draft.imageDark, width: draft.width, height: draft.height, quad: draft.image ? draft.quad : null, safeTop: draft.safeTop,
    site: field('site').checked, team: field('team').checked,
  };
  const done = busy($('#packSave'));
  try {
    const r = await api('/api/team/packaging-products', { method: 'POST', body: { product } });
    store.invalidate('packaging');
    const idx = items.findIndex((p) => p.id === r.product.id);
    if (idx >= 0) items[idx] = r.product; else items.push(r.product);
    toast(idx >= 0 ? `${r.product.name} saved. The packaging page shows the change now.` : `${r.product.name} added to the packaging page.`);
    done();
    // the saved product stays open, as it now is on the website
    fill(r.product);
    renderList(r.product.id);
  } catch (x) { toast(x.message, 'error'); done(); }
}
