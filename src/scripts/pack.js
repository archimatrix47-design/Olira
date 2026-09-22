// Packaging page: the kraft paper bag mockup studio, which is the first thing on
// the page. The bags are the packaging products managed in the admin that have a
// photo and the corners of their printable panel; the drawing itself lives in
// mockup/engine.js and is shared with the packaging team's workspace. Products
// without a photo yet are offered for a quote, and join the studio as soon as
// the admin adds one.
import { $, $$, h, prefill, track, formHooks } from './common.js';
import { SIZES, INKS, defaultDesign, prepare, render, toArtboard, clampDesign, exportImage, specLine, saveBlob, usableInStudio, onThemeChange } from './mockup/engine.js';
import { checkLogo, removeBox } from './mockup/logo-check.js';

// designer use, for the admin insights: counted once per page view except downloads and quotes
let changedOnce = false;
const noteChange = () => { if (!changedOnce) { changedOnce = true; track({ event: 'studio_change' }); } };

const canvas = $('#bagCanvas');
const ctx = canvas.getContext('2d');
const chips = $('#templateChips');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let products = [];
try { products = JSON.parse($('#packagingData')?.textContent || '[]'); } catch (e) { products = []; }
let templates = products.filter(usableInStudio);
const state = { template: templates[0]?.id || null, logoFile: null, ...defaultDesign() };

// ?handle=twisted (home page links) picks the first bag with that handle; ?bag=<id> picks one exactly
const params = new URLSearchParams(location.search);
function pickFromUrl() {
  const byId = templates.find((t) => t.id === params.get('bag'));
  const byHandle = templates.find((t) => t.handle && t.handle === params.get('handle'));
  if (byId || byHandle) state.template = (byId || byHandle).id;
}
pickFromUrl();
// a link to a bag that is quoted rather than previewed points at it in the Quote only list
{
  const want = params.get('handle') || params.get('bag');
  const product = want && products.find((p) => p.handle === want || p.id === want);
  if (product && !templates.some((t) => t.id === product.id)) {
    const btn = document.querySelector(`#quoteBags [data-product="${CSS.escape(product.id)}"]`);
    if (btn) { btn.classList.add('is-target'); requestAnimationFrame(() => btn.scrollIntoView({ block: 'center' })); }
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
  if (guides) drawGuides(B);
  canvas.parentElement.style.backgroundColor = backdrop(B);
  $('#stageInfo').textContent = specLine(t, state);
  updateSummary();
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
// the centre lines of the printable panel, drawn in perspective, only while snapping
function drawGuides(B) {
  if (!guides.x && !guides.y) return;
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#186078';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(...B.H.fwd(...a)); ctx.lineTo(...B.H.fwd(...b)); ctx.stroke(); };
  if (guides.x) line([0.5, 0.02], [0.5, 0.98]);
  if (guides.y) { const v = B.safeTop + (1 - B.safeTop) * 0.44; line([0.02, v], [0.98, v]); }
  ctx.restore();
}

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
    if (t.moq) text.append(h('span', { class: 'bagopt-desc' }, `Minimum order ${t.moq}`));
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
    draw().then(() => announce(`Preview updated. ${specLine(tpl(), state)}.`)); noteChange();
  }));
}
bindTemplateChips();

/* ---------------- quote only: products without a photo yet ---------------- */
function buildQuoteOnly() {
  const list = products.filter((p) => !usableInStudio(p));
  $('#quoteOnly').hidden = !list.length;
  $('#quoteBags').replaceChildren(...list.map((p) => {
    const b = h('button', { class: 'quote-bag', type: 'button' });
    b.dataset.product = p.id;
    if (p.handle) b.dataset.handle = p.handle;
    b.append(h('span', { class: 'bagopt-name' }, p.name));
    if (p.description) b.append(h('span', { class: 'bagopt-desc' }, p.description));
    b.append(h('span', { class: 'quote-bag-go' }, 'Quote this bag'));
    const li = h('li'); li.append(b);
    return li;
  }));
}
// The size, ink and text chosen in the studio carry over to the request, so a
// bag that cannot be previewed yet is still quoted with the visitor's choices.
function quoteMessage(name) {
  const s = SIZES[state.size];
  return `Quote for ${s.label.toLowerCase()} kraft paper bags, ${(name || '').toLowerCase()} (${s.dims}). Print: ${state.logo ? 'our logo' : 'logo to follow'}, "${state.text1}" and "${state.text2}", ${INKS[state.ink][0].toLowerCase()} ink${state.oneInk && state.logo ? ', logo in one colour' : ''}.`;
}
function goToQuote(e) {
  const instant = reduced.matches || e.detail === 0;
  $('#quote').scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
  $('#inquiry input:not([type="hidden"]):not([tabindex="-1"])')?.focus({ preventScroll: true });
}
$('#quoteBags').addEventListener('click', (e) => {
  const b = e.target.closest('.quote-bag');
  const p = b && products.find((x) => x.id === b.dataset.product);
  if (!p) return;
  const form = $('#inquiry'); if (form) form.dataset.product = 'Kraft paper bags';
  // the studio preview shows another bag, so its picture is not attached
  if (sendDesign?.checked) { sendDesign.checked = false; sendDesign.dispatchEvent(new Event('change', { bubbles: true })); }
  track({ event: 'studio_quote' });
  prefill(quoteMessage(p.name));
  goToQuote(e);
});

function syncRadios() {
  for (const [name, val] of [['size', state.size], ['ink', state.ink], ['template', state.template]]) {
    const r = $(`input[name="${name}"][value="${CSS.escape(val || '')}"]`); if (r) r.checked = true;
  }
}
for (const name of ['size', 'ink']) {
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
function readLogo(img) {
  try { logoCheck = checkLogo(img); } catch (e) { logoCheck = null; } // an image the browser will not let us read
  advise();
  if (!advice.hidden) announce($('#logoAdviceText').textContent);
}
fixBox.addEventListener('click', async () => {
  if (!state.logo || !logoCheck) return;
  try {
    state.logo = await removeBox(state.logo, logoCheck.bg);
    readLogo(state.logo);
    draw();
    announce('The white box is removed from your logo on the preview.');
    (fixInk.hidden ? $('#oneInk') : fixInk).focus();
  } catch (e) { announce(e.message); }
});
fixInk.addEventListener('click', () => {
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
    readLogo(img);
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
  state.logo = null; state.logoFile = null; logoCheck = null; $('#logoFile').value = ''; $('#dropTitle').textContent = 'Upload a logo';
  $('#dropSub').textContent = 'PNG, JPG, SVG or WebP. Transparent PNG looks best.'; $('#removeLogo').hidden = true;
  advise(); draw(); announce('Logo removed.'); $('#logoFile').focus();
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
  let dx = drag.dx + a[0] - drag.a[0], dy = drag.dy + a[1] - drag.a[1];
  // within 2.5% of the panel width of a centre line, the design settles on it
  const snap = current.AW * 0.025;
  const sx = Math.abs(dx) < snap, sy = Math.abs(dy) < snap;
  if (sx) dx = 0;
  if (sy) dy = 0;
  // a short tick on phones as the design settles, once per line
  if (e.pointerType === 'touch' && ((sx && !guides?.x) || (sy && !guides?.y))) navigator.vibrate?.(8);
  guides = { x: sx, y: sy };
  state.dx = dx; state.dy = dy; clampDesign(current, state); draw();
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

const fileBase = () => `olira-kraft-bag-${(tpl()?.handle || tpl()?.id || 'bag').replace(/[^\w-]+/g, '')}-${state.size}-mockup`;
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
  out.textContent = `${specLine(tpl(), state)}${state.logoFile ? `, with your logo (${state.logoFile.name})` : ', no logo yet'}. A picture of the mockup is included.`;
}
formHooks.design = async () => {
  if (!current || !sendDesign?.checked) return null;
  const t = tpl();
  return {
    design: { template: t.id, templateName: t.name, size: state.size, ink: state.ink, text1: state.text1, text2: state.text2, scale: state.scale, dx: Math.round(state.dx), dy: Math.round(state.dy), oneInk: state.oneInk, hasLogo: !!state.logoFile },
    logo: state.logoFile,
    mockup: await exportImage(current, state, { type: 'png', scale: 0.8 }),
  };
};

$('#useDesign').addEventListener('click', () => {
  const form = $('#inquiry'); if (form) form.dataset.product = 'Kraft paper bags';
  if (sendDesign && !sendDesign.checked) { sendDesign.checked = true; sendDesign.dispatchEvent(new Event('change', { bubbles: true })); }
  track({ event: 'studio_quote' });
  prefill(quoteMessage(tpl()?.name));
});

/* ---------------- start ---------------- */
syncRadios();
draw().catch(() => { $('#stageInfo').textContent = 'The bag image could not load. Refresh the page to try again.'; });
document.fonts?.load('700 60px "Hanken Grotesk"').then(() => draw()).catch(() => {});
// a bag with a dark theme photo switches with the page
onThemeChange(() => draw());
// warm the other bags so switching is instant
templates.slice(0, 4).forEach((t) => { if (t.id !== state.template) prepare(t).catch(() => {}); });

// products changed in the admin since this page was built
fetch('/api/packaging-products').then((r) => (r.ok ? r.json() : null)).then((list) => {
  if (!Array.isArray(list)) return;
  const key = (arr) => JSON.stringify(arr.map((p) => [p.id, p.name, p.description, p.moq, p.handle, p.image, p.imageDark, p.quad, p.safeTop]));
  if (key(list) === key(products)) return;
  products = list;
  templates = list.filter(usableInStudio);
  if (!templates.some((t) => t.id === state.template)) state.template = templates[0]?.id || null;
  if (!changedOnce) pickFromUrl();
  buildChips();
  buildQuoteOnly();
  draw();
}).catch(() => {});
