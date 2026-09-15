// Packaging page: the kraft paper bag mockup studio.
// The bags are the packaging products managed in the admin that have a photo and
// the corners of their printable panel; the drawing itself lives in
// mockup/engine.js and is shared with the packaging team's workspace.
import { $, $$, h, prefill, track, formHooks } from './common.js';
import { SIZES, INKS, defaultDesign, prepare, render, toArtboard, clampDesign, exportImage, specLine, saveBlob, usableInStudio, onThemeChange } from './mockup/engine.js';

// designer use, for the admin insights: counted once per page view except downloads and quotes
let changedOnce = false;
const noteChange = () => { if (!changedOnce) { changedOnce = true; track({ event: 'studio_change' }); } };

const canvas = $('#bagCanvas');
const ctx = canvas.getContext('2d');
const chips = $('#templateChips');

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
// a link to a bag that is not in the studio yet (no photo) lands on its line in Formats instead
{
  const want = params.get('handle') || params.get('bag');
  const product = want && products.find((p) => p.handle === want || p.id === want);
  if (product && !templates.some((t) => t.id === product.id)) {
    const cell = document.querySelector(`#packagingFormats [data-product="${CSS.escape(product.id)}"]`);
    if (cell) {
      cell.classList.add('is-target');
      history.replaceState(null, '', `${location.pathname}${location.search}#formats`);
      requestAnimationFrame(() => document.getElementById('formats')?.scrollIntoView({ block: 'start' }));
    }
  }
}
const tpl = () => templates.find((t) => t.id === state.template) || templates[0];

/* ---------------- drawing ---------------- */
let current = null, pending = 0;
async function draw() {
  const t = tpl();
  if (!t) { $('#stageInfo').textContent = 'No bags are set up yet.'; return; }
  const id = ++pending;
  const B = await prepare(t);
  if (id !== pending) return;
  current = B;
  render(ctx, B, state);
  $('#stageInfo').textContent = specLine(t, state);
  updateSummary();
}

const live = $('#studioStatus');
let liveTimer = 0;
function announce(msg) {
  // clear first so repeating the same sentence is still read out
  clearTimeout(liveTimer); live.textContent = '';
  liveTimer = setTimeout(() => { live.textContent = msg; }, 60);
}

/* ---------------- controls ---------------- */
function buildChips() {
  // common.js h() takes text, not children, so the pieces are joined by hand
  chips.replaceChildren(...templates.map((t) => {
    const input = h('input', { type: 'radio', name: 'template', value: t.id });
    if (t.handle) input.dataset.handle = t.handle;
    input.checked = t.id === state.template;
    const label = h('label', { class: 'opt' });
    label.append(input, h('span', {}, t.name));
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
$('#oneInk').addEventListener('change', (e) => { state.oneInk = e.target.checked; draw(); announce(e.target.checked ? 'Logo printed in the ink colour.' : 'Logo printed in its own colours.'); });

function loadLogo(file) {
  const sub = $('#dropSub');
  if (!file || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { sub.textContent = 'Please choose a PNG, JPG, SVG or WebP image.'; announce(sub.textContent); return; }
  if (file.size > 8 * 1024 * 1024) { sub.textContent = 'That file is over 8 MB. Try a smaller export.'; announce(sub.textContent); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    state.logo = img; state.logoFile = file;
    $('#dropTitle').textContent = file.name; sub.textContent = 'Choose or drop another file to replace it.';
    $('#removeLogo').hidden = false; draw(); announce(`Logo added: ${file.name}. It is on the bag preview.`);
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
  state.logo = null; state.logoFile = null; $('#logoFile').value = ''; $('#dropTitle').textContent = 'Upload a logo';
  $('#dropSub').textContent = 'PNG, JPG, SVG or WebP. Transparent PNG looks best.'; $('#removeLogo').hidden = true;
  draw(); announce('Logo removed.'); $('#logoFile').focus();
});

/* moving the design: drag on the bag, arrow keys on the preview, or the buttons */
function move(x, y, say) { state.dx += x; state.dy += y; if (current) clampDesign(current, state); draw(); if (say) announce(say); }

let drag = null;
const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
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
  state.dx = drag.dx + a[0] - drag.a[0]; state.dy = drag.dy + a[1] - drag.a[1]; clampDesign(current, state); draw();
});
const endDrag = () => { if (!drag) return; drag = null; canvas.classList.remove('is-dragging'); announce('Design moved.'); };
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
  const s = SIZES[state.size];
  const form = $('#inquiry'); if (form) form.dataset.product = 'Kraft paper bags';
  if (sendDesign && !sendDesign.checked) { sendDesign.checked = true; sendDesign.dispatchEvent(new Event('change', { bubbles: true })); }
  track({ event: 'studio_quote' });
  prefill(`Quote for ${s.label.toLowerCase()} kraft paper bags, ${(tpl()?.name || '').toLowerCase()} (${s.dims}). Print: ${state.logo ? 'our logo' : 'logo to follow'}, "${state.text1}" and "${state.text2}", ${INKS[state.ink][0].toLowerCase()} ink${state.oneInk ? ', logo in one colour' : ''}.`);
});

/* the formats list, rebuilt when the admin changed the products after the build (text only) */
function renderFormats(list) {
  const box = $('#packagingFormats');
  if (!box) return;
  const key = (arr) => JSON.stringify(arr.map((p) => [p.id, p.name, p.description, p.moq, p.specs]));
  if (key(list) === key(products)) return;
  products = list;
  const cells = list.map((p) => {
    const cell = h('div', { class: 'format' });
    cell.dataset.product = p.id;
    cell.append(h('h3', {}, p.name), h('p', {}, p.description || ''));
    if (p.moq) cell.append(h('p', { class: 'format-moq' }, `Minimum order ${p.moq}`));
    if (p.specs?.length) { const ul = h('ul', { class: 'format-specs' }); p.specs.forEach((s) => ul.append(h('li', {}, s))); cell.append(ul); }
    return cell;
  });
  const fixed = $('.format-static', box);
  box.replaceChildren(...cells, ...(fixed ? [fixed] : []));
  box.className = `formats cols-${Math.min(4, Math.max(2, box.children.length))}`;
}

/* ---------------- start ---------------- */
syncRadios();
draw().catch(() => { $('#stageInfo').textContent = 'The bag image could not load. Refresh the page to try again.'; });
document.fonts?.load('700 60px "Hanken Grotesk"').then(() => draw()).catch(() => {});
// a bag with a dark theme photo switches with the page
onThemeChange(() => draw());
// warm the other bags so switching is instant
templates.slice(0, 4).forEach((t) => { if (t.id !== state.template) prepare(t).catch(() => {}); });

// bags changed in the admin since this page was built
fetch('/api/packaging-products').then((r) => (r.ok ? r.json() : null)).then((list) => {
  if (!Array.isArray(list)) return;
  renderFormats(list);
  const bags = list.filter(usableInStudio);
  const key = (arr) => JSON.stringify(arr.map((t) => [t.id, t.name, t.image, t.imageDark, t.quad, t.safeTop]));
  if (!bags.length || key(bags) === key(templates)) return;
  templates = bags;
  if (!templates.some((t) => t.id === state.template)) state.template = templates[0].id;
  if (!changedOnce) pickFromUrl();
  buildChips();
  draw();
}).catch(() => {});
