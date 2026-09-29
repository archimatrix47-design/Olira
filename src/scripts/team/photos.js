// Packaging workspace: product photos. The packaging (marketing) team replaces the
// image of a product on the website and places its four print corners; nothing
// else about the product changes (POST /api/team/packaging-products/:id/photo).
// An image on a transparent background (a mockup export) stands on the website
// like the other products: on the home page, in the catalogue and in the studio.
import { $, h, api, toast, busy } from '../admin/api.js';
import { prepare, render, defaultDesign } from '../mockup/engine.js';
import { defaultQuad, convex, cornerEditor } from '../admin/corners.js';

const FAMILY = { bags: 'Paper bags', food: 'Bakery and food boxes', medical: 'Medical packets', foil: 'Aluminium foil bags' };
const isCutout = (image) => /^\/uploads\/packaging\/[\w.-]+-cutout-\d+\.webp$/.test(image || '');
const say = (msg) => { const s = $('#tPhLive'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };

let items = [];
let product = null;   // the product being edited
let draft = null;     // its image, size, print corners and space above the design
let saved = '';       // the draft as last saved, to know when there is something to save
let bound = false;
let corners = null;

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    items = await api('/api/packaging-products?scope=team');
    if (!Array.isArray(items)) items = [];
    renderList();
  } catch (e) {
    if (e.status !== 401) $('#tPhList').replaceChildren(h('li', { class: 'note' }, e.message));
  }
}

function statusOf(p) {
  const img = !p.image ? 'No photo yet'
    : isCutout(p.image) || p.cutout ? 'Transparent image'
    : p.image.startsWith('/images/packaging/products/') ? 'Standard photo'
    : 'Photo with a background, not in the home page lineup';
  const area = p.image && Array.isArray(p.quad) ? 'print area placed' : p.image ? 'no print area yet' : null;
  return [img, area].filter(Boolean).join(', ');
}

function renderList() {
  const list = $('#tPhList');
  if (!items.length) { list.replaceChildren(h('li', { class: 'note' }, 'No packaging products yet. The administrator adds them in the admin panel.')); return; }
  list.replaceChildren(...items.map((p) => h('li', {},
    h('button', { type: 'button', class: `t-ph-item${product?.id === p.id ? ' is-open' : ''}`, 'aria-pressed': String(product?.id === p.id), onclick: () => open(p) },
      p.image ? h('img', { src: p.image, alt: '', width: '56', height: '56', loading: 'lazy' }) : h('span', { class: 't-ph-none', 'aria-hidden': 'true' }),
      h('span', { class: 't-ph-text' }, h('strong', {}, p.name), h('span', {}, `${FAMILY[p.family] || ''}. ${statusOf(p)}`))))));
}

const snapshot = () => JSON.stringify(draft);
function syncSave() {
  const dirty = !!draft?.image && snapshot() !== saved;
  $('#tPhSave').disabled = !dirty;
  $('#tPhSaveNote').textContent = !draft?.image ? 'Upload an image to change this product\'s photo.' : dirty ? 'Not saved yet.' : 'Saved. This is the photo on the website.';
}

function open(p) {
  product = p;
  draft = { image: p.image || null, width: p.width || null, height: p.height || null, quad: Array.isArray(p.quad) ? p.quad.map((q) => q.slice()) : null, safeTop: p.safeTop ?? 0.1 };
  saved = snapshot();
  $('#tPhTitle').textContent = p.name;
  $('#tPhSafe').value = Math.round(draft.safeTop * 100);
  $('#tPhWarn').hidden = true;
  $('#tPhEditor').hidden = false;
  syncWork();
  renderList();
  $('#tPhEditor').scrollIntoView({ block: 'nearest' });
  $('#tPhFile').focus({ preventScroll: true });
}

function close() {
  product = null; draft = null;
  $('#tPhEditor').hidden = true;
  renderList();
}

function syncWork() {
  const has = !!draft.image;
  $('#tPhWork').hidden = !has;
  if (has) {
    if (!draft.quad) draft.quad = defaultQuad();
    $('#tPhStageImg').src = draft.image;
    const cut = isCutout(draft.image);
    $('#tPhStage').classList.toggle('is-cutout', cut);
    $('#tPhPreview').classList.toggle('is-cutout', cut);
    corners.place();
    schedulePreview();
  }
  syncSave();
}

function bind() {
  corners = cornerEditor($('#tPhStage'), $('#tPhPoly'), () => draft, () => { schedulePreview(); syncSave(); });
  $('#tPhCancel').addEventListener('click', close);
  $('#tPhReset').addEventListener('click', () => { draft.quad = defaultQuad(); corners.place(); schedulePreview(); syncSave(); say('Corners reset. Drag them onto the front panel.'); });
  $('#tPhSafe').addEventListener('input', (e) => { draft.safeTop = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); schedulePreview(); syncSave(); });
  $('#tPhSample').addEventListener('input', schedulePreview);
  const input = $('#tPhFile'), drop = $('#tPhDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); input.value = ''; });
  $('#tPhEditor').addEventListener('submit', save);
}

async function upload(file) {
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) return toast('Choose a PNG, WebP or JPG image.', 'error');
  if (file.size > 15 * 1024 * 1024) return toast('The image can be up to 15 MB.', 'error');
  const label = $('#tPhDrop strong'), text = label.textContent;
  label.textContent = 'Uploading';
  const fd = new FormData();
  fd.append('image', file);
  fd.append('variant', 'light');
  fd.append('name', product?.name || 'product');
  try {
    const r = await api('/api/team/packaging-products/image', { method: 'POST', form: fd });
    // a new image has its own framing: the corners start again
    Object.assign(draft, { image: r.path, width: r.width, height: r.height, quad: defaultQuad() });
    // a photo with a background works in the catalogue and the studio, but only a
    // transparent image can stand in the home page lineup: say so before saving
    const note = r.cutout ? '' : [r.warning, 'This image has a background, so it is shown as a photo in the catalogue and the studio, and the product leaves the home page lineup. A transparent PNG or WebP of the product stands on the website like the others.'].filter(Boolean).join(' ');
    $('#tPhWarn').textContent = note; $('#tPhWarn').hidden = !note;
    syncWork();
    toast(r.cutout ? 'Transparent image uploaded. Place the four print corners, then save.' : 'Photo uploaded. Place the four print corners, then save.');
    say('Image ready. Place the four corners on the front panel.');
    $('#tPhStage [data-corner="0"]').focus({ preventScroll: true });
  } catch (e) { toast(e.message, 'error'); }
  finally { label.textContent = text; }
}

let timer = 0;
function schedulePreview() { clearTimeout(timer); timer = setTimeout(drawPreview, 90); }
async function drawPreview() {
  if (!draft?.image || !draft.quad) return;
  const canvas = $('#tPhPreview'), msg = $('#tPhPreviewMsg');
  if (!convex(draft.quad)) { msg.textContent = 'The corners cross over. Put them in order: top left, top right, bottom right, bottom left.'; msg.hidden = false; return; }
  msg.hidden = true;
  try {
    const B = await prepare({ image: draft.image, quad: draft.quad, safeTop: draft.safeTop }, { dark: false });
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); // a transparent image: clear, or frames pile up
    render(ctx, B, { ...defaultDesign(), text1: ($('#tPhSample').value.trim() || 'YOUR BRAND').slice(0, 18).toUpperCase(), text2: '', placeholder: false });
    if (isCutout(draft.image)) { // keep the print on the product itself, as the website does
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(B.photo, 0, 0); ctx.restore();
    }
  } catch (e) { msg.textContent = e.message; msg.hidden = false; }
}

async function save(e) {
  e.preventDefault();
  if (!draft?.image) return;
  if (!convex(draft.quad)) { toast('The print corners cross over. Put them in order: top left, top right, bottom right, bottom left.', 'error'); return $('#tPhStage [data-corner="0"]').focus(); }
  const done = busy($('#tPhSave'));
  try {
    const r = await api(`/api/team/packaging-products/${encodeURIComponent(product.id)}/photo`, { method: 'POST', body: { image: draft.image, width: draft.width, height: draft.height, quad: draft.quad, safeTop: draft.safeTop } });
    Object.assign(product, r.product);
    saved = snapshot();
    renderList();
    syncSave();
    toast(`${product.name}: photo saved. The website shows it now.`);
    say(`${product.name} photo saved.`);
  } catch (x) { toast(x.message, 'error'); }
  finally { done(); }
}
