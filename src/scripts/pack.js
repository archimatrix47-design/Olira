// Packaging page: the mockup studio. Its products are the packaging products
// managed in the admin that have a photo and the corners of their printable panel
// (the print area); the drawing itself lives in mockup/engine.js and is shared
// with the packaging team's workspace. Products without a photo yet are in the
// catalogue and the packing list, and join the studio as soon as the admin adds one.
import { $, $$, h, prefill, track, formHooks } from './common.js';
import { INKS, defaultDesign, prepare, render, toArtboard, clampDesign, snapDesign, drawGuides, exportImage, specLine, saveBlob, usableInStudio, onThemeChange, sizesOf, sizeOf, singular, artworkAdvice } from './mockup/engine.js';
import { getProducts, onProducts } from './packaging-data.js';
import { checkLogo, removeBox } from './mockup/logo-check.js';

// designer use, for the admin insights: counted once per page view except downloads and quotes
let changedOnce = false;
const noteChange = () => { if (!changedOnce) { changedOnce = true; track({ event: 'studio_change' }); } };

const canvas = $('#bagCanvas');
const ctx = canvas.getContext('2d');
const chips = $('#templateChips');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let products = getProducts();
let templates = products.filter(usableInStudio);
const state = { template: templates[0]?.id || null, logoFile: null, artworkFile: null, ...defaultDesign() };

// ?handle=twisted (home page links) picks the first bag with that handle; ?bag=<id> picks one exactly
const params = new URLSearchParams(location.search);
function pickFromUrl() {
  const byId = templates.find((t) => t.id === params.get('bag'));
  const byHandle = templates.find((t) => t.handle && t.handle === params.get('handle'));
  if (byId || byHandle) state.template = (byId || byHandle).id;
}
pickFromUrl();
// a link to a product that cannot be previewed yet shows it in the catalogue instead
{
  const want = params.get('handle') || params.get('bag');
  const product = want && products.find((p) => p.handle === want || p.id === want);
  if (product && !templates.some((t) => t.id === product.id)) {
    document.dispatchEvent(new CustomEvent('catalogue:show', { detail: { id: product.id } }));
  }
}
const tpl = () => templates.find((t) => t.id === state.template) || templates[0];

/* ---------------- drawing ---------------- */
let current = null, pending = 0;
let guides = null; // { x, y } while a drag is snapped to the centre lines
async function draw() {
  const t = tpl();
  if (!t) { $('#stageInfo').textContent = 'No bags are set up yet.'; return; }
  const id = ++pending;
  const B = await prepare(t);
  if (id !== pending) return;
  current = B;
  render(ctx, B, state);
  drawGuides(ctx, B, guides, accent(), state.mode);
  canvas.parentElement.style.backgroundColor = backdrop(B);
  $('#stageInfo').textContent = specLine(t, state);
  updateSummary();
  if (state.mode === 'artwork') adviseArtwork();
}
// The frame around the fitted photo takes the colour of the photo's own edge, so
// the backdrop the bag was photographed on simply continues to the frame.
function backdrop(B) {
  if (B.edge) return B.edge;
  try {
    const g = B.photo.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, Math.round(B.ch * 0.1), 3, Math.round(B.ch * 0.5)).data;
    const sum = [0, 0, 0];
    for (let o = 0; o < d.length; o += 4) { sum[0] += d[o]; sum[1] += d[o + 1]; sum[2] += d[o + 2]; }
    const n = d.length / 4;
    B.edge = `rgb(${sum.map((v) => Math.round(v / n)).join(', ')})`;
  } catch (e) { B.edge = ''; }
  return B.edge;
}
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#186078';

const live = $('#studioStatus');
let liveTimer = 0;
function announce(msg) {
  // clear first so repeating the same sentence is still read out
  clearTimeout(liveTimer); live.textContent = '';
  liveTimer = setTimeout(() => { live.textContent = msg; }, 60);
}

/* ---------------- bags: the admin's photographed products ---------------- */
function buildChips() {
  // common.js h() takes text, not children, so the pieces are joined by hand
  chips.replaceChildren(...templates.map((t) => {
    const input = h('input', { type: 'radio', name: 'template', value: t.id });
    if (t.handle) input.dataset.handle = t.handle;
    input.checked = t.id === state.template;
    const text = h('span', { class: 'bagopt-text' });
    text.append(h('span', { class: 'bagopt-name' }, t.name));
    if (t.description) text.append(h('span', { class: 'bagopt-desc' }, t.description));
    if (t.minOrder) text.append(h('span', { class: 'bagopt-desc' }, `Minimum order ${Number(t.minOrder).toLocaleString('en-US')}`));
    const card = h('span', { class: 'bagopt-card' });
    card.append(h('img', { class: 'bagopt-photo', src: t.image, alt: '', width: '56', height: '56', loading: 'lazy', decoding: 'async' }), text);
    const label = h('label', { class: 'bagopt' });
    label.append(input, card);
    return label;
  }));
  bindTemplateChips();
}
function bindTemplateChips() {
  $$('input[name="template"]', chips).forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    state.template = r.value; state.dx = 0; state.dy = 0;
    buildSizes();
    draw().then(() => announce(`Preview updated. ${specLine(tpl(), state)}.`)); noteChange();
  }));
}
bindTemplateChips();

// The size, ink and text chosen in the studio carry over to the request.
function quoteMessage(p) {
  const sz = sizeOf(p, state.size);
  if (state.mode === 'artwork') return `Quote for ${sz.label.toLowerCase()} ${singular(p?.name || 'kraft paper bags')}s${sz.dims ? ` (${sz.dims})` : ''}. Print: ${state.artworkFile ? `our full artwork (${state.artworkFile.name})` : 'full artwork to follow'}, in full colour.`;
  return `Quote for ${sz.label.toLowerCase()} ${singular(p?.name || 'kraft paper bags')}s${sz.dims ? ` (${sz.dims})` : ''}. Print: ${state.logo ? 'our logo' : 'logo to follow'}, "${state.text1}" and "${state.text2}", ${INKS[state.ink][0].toLowerCase()} ink${state.oneInk && state.logo ? ', logo in one colour' : ''}.`;
}

/* ---------------- sizes: the chosen product's own ---------------- */
function buildSizes() {
  const t = tpl(), row = $('#sizeChips');
  if (!t || !row) return;
  const sizes = sizesOf(t);
  if (!sizes.some((s) => s.id === state.size)) state.size = (sizes.find((s) => s.id === 'medium') || sizes[0]).id;
  row.replaceChildren(...sizes.map((s) => {
    const input = h('input', { type: 'radio', name: 'size', value: s.id });
    input.checked = s.id === state.size;
    const card = h('span', { class: 'sizeopt-card' });
    if (s.w && s.h) { const box = h('span', { class: 'size-box', 'aria-hidden': 'true' }); box.style.setProperty('--w', s.w); box.style.setProperty('--h', s.h); card.append(box); }
    card.append(h('span', { class: 'size-name' }, s.label));
    if (s.dims) card.append(h('span', { class: 'size-dims' }, s.dims));
    const label = h('label', { class: 'sizeopt' }); label.append(input, card);
    input.addEventListener('change', () => { if (!input.checked) return; state.size = s.id; draw(); announce(`Preview updated. ${specLine(tpl(), state)}.`); noteChange(); });
    return label;
  }));
}

function syncRadios() {
  for (const [name, val] of [['size', state.size], ['ink', state.ink], ['template', state.template]]) {
    const r = $(`input[name="${name}"][value="${CSS.escape(val || '')}"]`); if (r) r.checked = true;
  }
}
for (const name of ['ink']) {
  $$(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    state[name] = r.value;
    draw(); announce(`Preview updated. ${specLine(tpl(), state)}.`); noteChange();
  }));
}
$('#text1').addEventListener('input', (e) => { state.text1 = e.target.value; draw(); noteChange(); });
$('#text2').addEventListener('input', (e) => { state.text2 = e.target.value; draw(); });
$('#scale').addEventListener('input', (e) => { state.scale = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); draw(); });
$('#scale').addEventListener('change', (e) => announce(`Design size ${e.target.value}%.`));
$('#oneInk').addEventListener('change', (e) => { state.oneInk = e.target.checked; draw(); advise(); announce(e.target.checked ? 'Logo printed in the ink colour.' : 'Logo printed in its own colours.'); });

/* ---------------- the logo, and the printer's check on it ---------------- */
const advice = $('#logoAdvice'), fixBox = $('#logoFixBox'), fixInk = $('#logoFixInk');
let logoCheck = null;
// what the check found in the file as uploaded, and whether its box was removed on
// the preview; both go to the packaging team with the design
let uploadCheck = '', boxRemoved = false;
// One problem at a time, most serious first: a box around the logo, then a logo
// too pale to show on kraft. Each comes with the fix the studio can apply.
function advise() {
  const c = state.logo && logoCheck;
  const boxed = !!(c && c.boxed);
  const pale = !!(c && !c.boxed && c.light && !state.oneInk);
  advice.hidden = !boxed && !pale;
  fixBox.hidden = !boxed;
  fixInk.hidden = !pale;
  $('#logoAdviceText').textContent = boxed
    ? 'Your logo sits on a white box. Printed on kraft, the box shows as a pale patch around it.'
    : pale ? 'Your logo is very light. On kraft paper it will hardly show.' : '';
}
function readLogo(img, uploaded) {
  try { logoCheck = checkLogo(img); } catch (e) { logoCheck = null; } // an image the browser will not let us read
  advise();
  if (uploaded) {
    uploadCheck = logoCheck?.boxed ? 'boxed' : logoCheck?.light ? 'light' : '';
    boxRemoved = false;
    if (uploadCheck) track({ event: 'studio_logo_warn' });
  }
  if (!advice.hidden) announce($('#logoAdviceText').textContent);
}
fixBox.addEventListener('click', async () => {
  if (!state.logo || !logoCheck) return;
  try {
    state.logo = await removeBox(state.logo, logoCheck.bg);
    boxRemoved = true;
    track({ event: 'studio_logo_fix' });
    readLogo(state.logo);
    draw();
    announce('The white box is removed from your logo on the preview.');
    (fixInk.hidden ? $('#oneInk') : fixInk).focus();
  } catch (e) { announce(e.message); }
});
fixInk.addEventListener('click', () => {
  track({ event: 'studio_logo_fix' });
  const box = $('#oneInk');
  box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
  box.focus();
});

function loadLogo(file) {
  const sub = $('#dropSub');
  if (!file || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { sub.textContent = 'Please choose a PNG, JPG, SVG or WebP image.'; announce(sub.textContent); return; }
  if (file.size > 8 * 1024 * 1024) { sub.textContent = 'That file is over 8 MB. Try a smaller export.'; announce(sub.textContent); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    state.logo = img; state.logoFile = file;
    $('#dropTitle').textContent = file.name; sub.textContent = 'Choose or drop another file to replace it.';
    $('#removeLogo').hidden = false; draw(); announce(`Logo added: ${file.name}. It is on the bag preview.`);
    readLogo(img, true);
    track({ event: 'studio_logo' });
  };
  img.onerror = () => { sub.textContent = 'That image could not be read. Try a PNG.'; announce(sub.textContent); URL.revokeObjectURL(url); };
  img.src = url;
}
$('#logoFile').addEventListener('change', (e) => loadLogo(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => loadLogo(e.dataTransfer.files[0]));
$('#removeLogo').addEventListener('click', () => {
  state.logo = null; state.logoFile = null; logoCheck = null; uploadCheck = ''; boxRemoved = false; $('#logoFile').value = ''; $('#dropTitle').textContent = 'Upload a logo';
  $('#dropSub').textContent = 'PNG, JPG, SVG or WebP. Transparent PNG looks best.'; $('#removeLogo').hidden = true;
  advise(); draw(); announce('Logo removed.'); $('#logoFile').focus();
});

/* ---------------- full artwork: a finished design printed across the print area ---------------- */
function setMode(mode, { say = true } = {}) {
  state.mode = mode;
  for (const part of $$('.mode-part')) part.hidden = part.dataset.mode !== mode;
  // each way of designing starts centred at its natural size
  state.dx = 0; state.dy = 0; state.scale = 1;
  const sc = $('#scale'); sc.value = 100; sc.setAttribute('aria-valuetext', '100 percent');
  draw();
  if (say) announce(mode === 'artwork' ? 'Full artwork. Upload a finished design to see it across the print area.' : 'Logo and text.');
  noteChange();
}
$$('input[name="designMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setMode(r.value); }));
$$('input[name="artFit"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  state.fit = r.value; state.dx = 0; state.dy = 0; draw();
  announce(r.value === 'contain' ? 'The whole artwork is shown inside the print area.' : 'The artwork fills the print area.');
}));

function adviseArtwork() {
  if (!current || !tpl()) return;
  const a = artworkAdvice(tpl(), current, state);
  $('#artHint').textContent = `The print area on this ${singular(tpl().name)} is ${a.shape}. ${a.size}`.trim();
  const box = $('#artAdvice');
  box.hidden = !a.warnings.length;
  $('#artAdviceText').textContent = a.warnings.join(' ');
}

const ART_MAX = 10 * 1024 * 1024; // the most a quote request accepts for one file
function loadArtwork(file) {
  const sub = $('#artSub');
  if (!file) return;
  if (file.type === 'application/pdf') {
    sub.textContent = 'A PDF cannot be previewed here yet. Export the page as a PNG or JPG to see it on the bag; you can attach the PDF itself to your quote request.';
    announce(sub.textContent); return;
  }
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { sub.textContent = 'Please choose a PNG, JPG, WebP or SVG image of your design.'; announce(sub.textContent); return; }
  if (file.size > ART_MAX) { sub.textContent = 'That file is over 10 MB. Export a smaller copy to preview and send it.'; announce(sub.textContent); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    state.artwork = img; state.artworkFile = file; state.dx = 0; state.dy = 0;
    $('#artTitle').textContent = file.name; sub.textContent = 'Choose or drop another file to replace it.';
    $('#removeArt').hidden = false;
    draw().then(() => announce(`Artwork added: ${file.name}. It is on the preview.${$('#artAdvice').hidden ? '' : ` ${$('#artAdviceText').textContent}`}`));
    track({ event: 'studio_artwork' });
    noteChange();
  };
  img.onerror = () => { sub.textContent = 'That image could not be read. Try a PNG or JPG.'; announce(sub.textContent); URL.revokeObjectURL(url); };
  img.src = url;
}
$('#artFile').addEventListener('change', (e) => loadArtwork(e.target.files[0]));
{
  const artDrop = $('#artDrop');
  ['dragenter', 'dragover'].forEach((ev) => artDrop.addEventListener(ev, (e) => { e.preventDefault(); artDrop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => artDrop.addEventListener(ev, (e) => { e.preventDefault(); artDrop.classList.remove('is-over'); }));
  artDrop.addEventListener('drop', (e) => loadArtwork(e.dataTransfer.files[0]));
}
$('#removeArt').addEventListener('click', () => {
  state.artwork = null; state.artworkFile = null; $('#artFile').value = '';
  $('#artTitle').textContent = 'Upload your artwork';
  $('#artSub').textContent = 'A finished design, the whole page: PNG, JPG, WebP or SVG, up to 10 MB.';
  $('#removeArt').hidden = true;
  draw(); announce('Artwork removed.'); $('#artFile').focus();
});

/* moving the design: drag on the bag, arrow keys on the preview, or the buttons */
function move(x, y, say) { state.dx += x; state.dy += y; if (current) clampDesign(current, state); draw(); if (say) announce(say); }

// The preview is fitted inside a fixed frame (object-fit: contain), so a pointer
// position is mapped through the fitted picture, not the whole element.
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = r.left + (r.width - canvas.width * s) / 2, oy = r.top + (r.height - canvas.height * s) / 2;
  return [(e.clientX - ox) / s, (e.clientY - oy) / s];
};
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!current) return;
  const p = toCanvas(e);
  if (!ctx.isPointInPath(current.poly, p[0], p[1])) return;
  drag = { a: toArtboard(current, ...p), dx: state.dx, dy: state.dy };
  canvas.setPointerCapture(e.pointerId); canvas.classList.add('is-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const a = toArtboard(current, ...toCanvas(e));
  const s = snapDesign(current, drag.dx + a[0] - drag.a[0], drag.dy + a[1] - drag.a[1]);
  // a short tick on phones as the design settles, once per line
  if (e.pointerType === 'touch' && ((s.x && !guides?.x) || (s.y && !guides?.y))) navigator.vibrate?.(8);
  guides = { x: s.x, y: s.y };
  state.dx = s.dx; state.dy = s.dy; clampDesign(current, state); draw();
});
const endDrag = () => {
  if (!drag) return;
  const centred = guides && guides.x && guides.y;
  drag = null; guides = null; canvas.classList.remove('is-dragging');
  draw();
  announce(centred ? 'Design centred on the bag.' : 'Design moved.');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 60 : 15;
  const m = { ArrowLeft: [-step, 0, 'left'], ArrowRight: [step, 0, 'right'], ArrowUp: [0, -step, 'up'], ArrowDown: [0, step, 'down'] }[e.key];
  if (!m) return;
  e.preventDefault(); move(m[0], m[1], `Design moved ${m[2]}.`);
});
$$('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
  const dir = b.dataset.nudge;
  const m = { left: [-30, 0], right: [30, 0], up: [0, -30], down: [0, 30] }[dir];
  move(m[0], m[1], `Design moved ${dir}.`);
}));
$('#resetPos').addEventListener('click', () => { state.dx = 0; state.dy = 0; draw(); announce('Design centred on the bag.'); });

const fileBase = () => `olira-${(tpl()?.handle || tpl()?.id || 'bag').replace(/[^\w-]+/g, '')}-${state.size}-mockup`;
$('#download').addEventListener('click', async () => {
  if (!current) return;
  try {
    saveBlob(await exportImage(current, state, { type: 'png' }), `${fileBase()}.png`);
    announce('Mockup image downloaded.');
    track({ event: 'studio_download' });
  } catch (e) { announce(e.message); }
});

/* ---------------- sending the design with a quote request ---------------- */
const sendDesign = $('[data-send-design]');
function updateSummary() {
  const out = $('[data-design-summary]');
  if (!out || !tpl()) return;
  const what = state.mode === 'artwork'
    ? (state.artworkFile ? `, with your artwork (${state.artworkFile.name})` : ', no artwork yet')
    : (state.logoFile ? `, with your logo (${state.logoFile.name})` : ', no logo yet');
  out.textContent = `${specLine(tpl(), state)}${what}. A picture of the mockup is included.`;
}
formHooks.design = async () => {
  if (!current || !sendDesign?.checked) return null;
  const t = tpl();
  return {
    design: { template: t.id, templateName: t.name, size: state.size, ink: state.ink, text1: state.text1, text2: state.text2, scale: state.scale, dx: Math.round(state.dx), dy: Math.round(state.dy), oneInk: state.oneInk, hasLogo: !!state.logoFile, logoCheck: state.logoFile ? uploadCheck : '', boxRemoved: !!state.logoFile && boxRemoved,
      mode: state.mode, fit: state.fit, hasArtwork: state.mode === 'artwork' && !!state.artworkFile },
    // only the files the chosen design uses
    logo: state.mode === 'brand' ? state.logoFile : null,
    artwork: state.mode === 'artwork' ? state.artworkFile : null,
    mockup: await exportImage(current, state, { type: 'png', scale: 0.8 }),
  };
};

$('#useDesign').addEventListener('click', () => {
  const form = $('#inquiry'); if (form) form.dataset.product = tpl()?.name || 'Packaging';
  if (sendDesign && !sendDesign.checked) { sendDesign.checked = true; sendDesign.dispatchEvent(new Event('change', { bubbles: true })); }
  track({ event: 'studio_quote' });
  prefill(quoteMessage(tpl()));
});

// "Design it in the studio" on a catalogue panel picks that product here
document.addEventListener('studio:pick', (e) => {
  const t = templates.find((x) => x.id === e.detail?.id);
  if (!t) return;
  state.template = t.id; state.dx = 0; state.dy = 0;
  syncRadios(); buildSizes(); draw().then(() => announce(`Preview updated. ${specLine(tpl(), state)}.`));
  noteChange();
});

/* ---------------- start ---------------- */
buildSizes();
syncRadios();
draw().catch(() => { $('#stageInfo').textContent = 'The bag image could not load. Refresh the page to try again.'; });
document.fonts?.load('700 60px "Hanken Grotesk"').then(() => draw()).catch(() => {});
// a bag with a dark theme photo switches with the page
onThemeChange(() => draw());
// warm the other bags so switching is instant
templates.slice(0, 4).forEach((t) => { if (t.id !== state.template) prepare(t).catch(() => {}); });

// products changed in the admin since this page was built
onProducts((list) => {
  products = list;
  templates = list.filter(usableInStudio);
  if (!templates.some((t) => t.id === state.template)) state.template = templates[0]?.id || null;
  if (!changedOnce) pickFromUrl();
  buildChips();
  buildSizes();
  draw();
});
