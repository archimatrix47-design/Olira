// Packaging products: the bags on the packaging page, managed like the
// agriculture products. A product with a white background photo and the four
// corners of its printable panel is also a bag in the mockup studio and in the
// packaging team's workspace.
import { $, $$, h, api, toast, confirmDialog, busy } from './api.js';
import { prepare, render, defaultDesign } from '../mockup/engine.js';
import { scrollBehavior } from './motion.js';

let items = [];
let bound = false;
let draft = null;
const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const DEFAULT_QUAD = [[0.15, 0.3], [0.85, 0.3], [0.85, 0.9], [0.15, 0.9]];
const form = () => $('#packForm');
const field = (name) => form().elements.namedItem(name);

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    items = await api('/api/packaging-products?scope=all');
    if (!Array.isArray(items)) items = [];
    if (!draft) reset(); else renderList();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

const usable = (p) => !!(p.image && Array.isArray(p.quad) && p.quad.length === 4);

/* ---------------- list ---------------- */
const svgIcon = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
  return s;
};
function renderList(focusId, which) {
  const list = $('#packList');
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'a-empty' }, h('strong', {}, 'No packaging products yet'), 'Add the first product with the form.'));
    return;
  }
  list.replaceChildren(...items.map((p, i) => h('li', { class: `a-prow${draft?.id === p.id ? ' is-editing' : ''}`, 'data-id': p.id },
    h('span', { class: 'pos', 'aria-hidden': 'true' }, String(i + 1)),
    p.image ? h('img', { src: p.image, alt: '', width: '64', height: '64', loading: 'lazy', style: 'object-fit:contain;background:#fff' }) : h('span', { class: 'ph' }, 'No photo'),
    h('div', {},
      h('h3', {}, p.name),
      h('p', {}, [
        p.site === false ? 'Hidden on the website' : null,
        usable(p) ? (p.imageDark ? 'In the mockup studio, with a dark mode photo' : 'In the mockup studio') : p.image ? 'Place the print corners to use it in the studio' : 'Add a photo to use it in the studio',
        p.team === false ? 'not in the packaging workspace' : null,
      ].filter(Boolean).join(', '))),
    h('div', { class: 'a-prow-actions' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} up`, title: 'Move up', disabled: i === 0 || null, onclick: () => move(i, -1) }, svgIcon('M12 19V5M6 11l6-6 6 6')),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} down`, title: 'Move down', disabled: i === items.length - 1 || null, onclick: () => move(i, 1) }, svgIcon('M12 5v14M6 13l6 6 6-6')),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Edit ${p.name}`, onclick: () => edit(p) }, 'Edit'),
      h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', 'aria-label': `Delete ${p.name}`, onclick: () => remove(p) }, 'Delete')))));
  if (focusId) {
    const row = list.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    const btns = row?.querySelectorAll('.btn-icon');
    const t = btns && (which === 'up' ? btns[0] : btns[1]);
    (t && !t.disabled ? t : row?.querySelector('.btn-secondary'))?.focus();
  }
}

async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  const before = items.slice();
  [items[i], items[j]] = [items[j], items[i]];
  renderList(items[j].id, dir < 0 ? 'up' : 'down');
  try {
    await api('/api/admin/packaging-products/order', { method: 'POST', body: { ids: items.map((p) => p.id) } });
    $('#packLive').textContent = `${items[j].name} moved to position ${j + 1} of ${items.length}.`;
  } catch (e) { items = before; renderList(); toast(e.message, 'error'); }
}

async function remove(p) {
  const ok = await confirmDialog({ title: `Delete ${p.name}?`, body: 'It is removed from the packaging page, the mockup studio and the packaging workspace straight away.' });
  if (!ok) return;
  try {
    await api(`/api/admin/packaging-products/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    items = items.filter((x) => x.id !== p.id);
    if (draft?.id === p.id) reset(); else renderList();
    toast(`${p.name} deleted.`);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- editor ---------------- */
function bind() {
  $('#packNew').addEventListener('click', () => { reset(); field('name').focus(); });
  $('#packCancel').addEventListener('click', reset);
  for (const variant of ['light', 'dark']) {
    const input = $(`#packFile-${variant}`), drop = $(`#packDrop-${variant}`);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0], variant); });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0], variant); input.value = ''; });
  }
  $('#packClearPhoto').addEventListener('click', () => { Object.assign(draft, { image: null, imageDark: null, width: null, height: null, quad: null }); syncPhoto(); });
  $('#packClearDark').addEventListener('click', () => { draft.imageDark = null; syncPhoto(); });
  $('#packSafe').addEventListener('input', (e) => { draft.safeTop = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); schedulePreview(); });
  $('#packInk').addEventListener('change', schedulePreview);
  $('#packSample').addEventListener('input', schedulePreview);
  $$('input[name="packPreviewTheme"]').forEach((r) => r.addEventListener('change', schedulePreview));
  $('#packResetCorners').addEventListener('click', () => { draft.quad = DEFAULT_QUAD.map((p) => p.slice()); placeHandles(); schedulePreview(); say('Corners reset. Drag them onto the panel.'); });
  bindCorners();
  form().addEventListener('submit', submit);
}

const say = (msg) => { const s = $('#packStatus'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };

function reset() {
  draft = { id: null, image: null, imageDark: null, width: null, height: null, quad: null, safeTop: 0.1 };
  form().reset();
  field('site').checked = true; field('team').checked = true;
  $('#packTitle').textContent = 'Add packaging product';
  $('#packSave').textContent = 'Save product';
  $('#packCancel').hidden = true;
  $('#packSafe').value = 10;
  clearErrors();
  syncPhoto();
  renderList();
}

function edit(p) {
  draft = { id: p.id, image: p.image || null, imageDark: p.imageDark || null, width: p.width || null, height: p.height || null, quad: p.quad ? p.quad.map((q) => q.slice()) : null, safeTop: p.safeTop ?? 0.1 };
  field('name').value = p.name || '';
  field('handle').value = p.handle || '';
  field('description').value = p.description || '';
  field('moq').value = p.moq || '';
  field('specs').value = (p.specs || []).join('\n');
  field('site').checked = p.site !== false;
  field('team').checked = p.team !== false;
  $('#packSafe').value = Math.round((p.safeTop ?? 0.1) * 100);
  $('#packTitle').textContent = `Edit ${p.name}`;
  $('#packSave').textContent = 'Save changes';
  $('#packCancel').hidden = false;
  clearErrors();
  syncPhoto();
  renderList();
  $('.a-pack-editor').scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  field('name').focus({ preventScroll: true });
}

function syncPhoto() {
  const has = !!draft.image;
  const lightImg = $('#packImg-light'), darkImg = $('#packImg-dark');
  lightImg.hidden = !has; if (has) lightImg.src = draft.image; else lightImg.removeAttribute('src');
  darkImg.hidden = !draft.imageDark; if (draft.imageDark) darkImg.src = draft.imageDark; else darkImg.removeAttribute('src');
  $('#packClearPhoto').hidden = !has;
  $('#packClearDark').hidden = !draft.imageDark;
  $('#packDarkWrap').hidden = !has;
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
    const r = await api('/api/admin/packaging-products/image', { method: 'POST', form: fd });
    if (variant === 'light') {
      const changedShape = draft.width && Math.abs(r.width / r.height - draft.width / draft.height) > 0.01;
      Object.assign(draft, { image: r.path, width: r.width, height: r.height });
      if (!draft.quad || changedShape) draft.quad = DEFAULT_QUAD.map((p) => p.slice());
      if (changedShape || (draft.imageDark && changedShape)) draft.imageDark = null;
      syncPhoto();
      if (r.warning) { $('#packWarn').textContent = r.warning; $('#packWarn').hidden = false; }
      toast('Photo uploaded. Place the four print corners, then save.');
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
let dragging = -1;
function placeHandles() {
  const stage = $('#packStage');
  stage.style.aspectRatio = `${draft.width || 1} / ${draft.height || 1}`;
  $$('[data-corner]', stage).forEach((b) => {
    const i = +b.dataset.corner, [x, y] = draft.quad[i];
    b.style.left = `${x * 100}%`; b.style.top = `${y * 100}%`;
    b.setAttribute('aria-label', `${CORNERS[i]} print corner, ${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down. Arrow keys move it.`);
  });
  $('#packPoly').setAttribute('points', draft.quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
}
function bindCorners() {
  const stage = $('#packStage');
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const toFrac = (e) => { const r = stage.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]; };
  $$('[data-corner]', stage).forEach((b) => {
    b.addEventListener('pointerdown', (e) => { dragging = +b.dataset.corner; b.setPointerCapture(e.pointerId); b.classList.add('is-dragging'); e.preventDefault(); });
    b.addEventListener('pointermove', (e) => { if (dragging !== +b.dataset.corner) return; draft.quad[dragging] = toFrac(e); placeHandles(); });
    const end = () => { if (dragging < 0) return; dragging = -1; b.classList.remove('is-dragging'); schedulePreview(); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.002;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const i = +b.dataset.corner;
      draft.quad[i] = [clamp(draft.quad[i][0] + d[0]), clamp(draft.quad[i][1] + d[1])];
      placeHandles(); schedulePreview();
    });
  });
}

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
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (!z || (sign && Math.sign(z) !== sign)) return false;
    sign = Math.sign(z);
  }
  return true;
}

function clearErrors() {
  for (const n of ['name', 'description']) { field(n).removeAttribute('aria-invalid'); $(`#pk${n === 'name' ? 'Name' : 'Desc'}Err`).hidden = true; }
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
  const specs = field('specs').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (specs.length > 12) return toast('Keep the key points to 12 lines or fewer.', 'error');
  if (draft.image && !convex(draft.quad)) { toast('The print corners cross over. Put them in order: top left, top right, bottom right, bottom left.', 'error'); return $('#packStage [data-corner="0"]').focus(); }
  const product = {
    id: draft.id || undefined, name, description, handle: field('handle').value.trim(), moq: field('moq').value.trim(), specs,
    image: draft.image, imageDark: draft.imageDark, width: draft.width, height: draft.height, quad: draft.image ? draft.quad : null, safeTop: draft.safeTop,
    site: field('site').checked, team: field('team').checked,
  };
  const done = busy($('#packSave'));
  try {
    const r = await api('/api/admin/packaging-products', { method: 'POST', body: { product } });
    const idx = items.findIndex((p) => p.id === r.product.id);
    if (idx >= 0) items[idx] = r.product; else items.push(r.product);
    toast(idx >= 0 ? `${r.product.name} saved. The packaging page shows the change now.` : `${r.product.name} added to the packaging page.`);
    reset();
    renderList(r.product.id);
  } catch (x) { toast(x.message, 'error'); }
  finally { done(); }
}
