// Packaging workspace: Mockups. The same renderer as the public studio, with
// the client's own files as logo sources and saving the result to the enquiry.
import { $, $$, h, api, toast } from '../admin/api.js';
import { sizesOf, defaultDesign, prepare, render, toArtboard, clampDesign, snapDesign, drawGuides, exportImage, specLine, saveBlob, usableInStudio, onThemeChange, artworkAdvice } from '../mockup/engine.js';
import { checkLogo, removeBox } from '../mockup/logo-check.js';
import { leads, putLead, OPEN, session } from './session.js';
import { fileBlob, replace as replaceLead } from './inbox.js';

let bound = false;
let bags = [];
let all = [];
const state = { bag: null, lead: '', logoName: '', artworkName: '', ...defaultDesign() };
let current = null, pending = 0;
let guides = null;     // centre lines shown while a drag is snapped to them
let logoCheck = null;  // what the logo check found in the logo on the bag
const canvas = () => $('#tmCanvas');
const say = (msg) => { const s = $('#tmStatus'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
const bag = () => bags.find((b) => b.id === state.bag) || bags[0];

export async function show({ params }) {
  if (!bound) { bound = true; bind(); onThemeChange(() => draw()); }
  try {
    [bags, all] = await Promise.all([api('/api/packaging-products?scope=team').then((l) => l.filter(usableInStudio)), leads()]);
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); return; }
  if (!bags.length) {
    $('#tmBags').replaceChildren(h('p', { class: 'a-note' }, 'No bags are set up for mockups yet. Give a product a photo and its print corners under Packaging products.'));
    return;
  }
  if (!bags.some((b) => b.id === state.bag)) state.bag = bags[0].id;
  renderBags();
  renderLeads();
  const want = params.get('lead');
  if (want && all.some((l) => l.id === want)) { $('#tmLead').value = want; await pickLead(want, true); }
  draw();
}

function renderBags() {
  $('#tmBags').replaceChildren(...bags.map((b) => {
    const input = h('input', { type: 'radio', name: 'tmBag', value: b.id, checked: b.id === state.bag || null });
    input.addEventListener('change', () => { if (input.checked) { state.bag = b.id; state.dx = 0; state.dy = 0; buildSizes(); draw(); say(`Changed to ${b.name}.`); } });
    // chosen by its picture, on the website's stage colour
    return h('label', { class: 't-bag', title: b.name }, input, b.image ? h('img', { src: b.image, alt: '', loading: 'lazy', decoding: 'async' }) : null, h('span', {}, b.name));
  }));
  buildSizes();
}

function renderLeads() {
  const sel = $('#tmLead');
  const open = all.filter((l) => OPEN.includes(l.status)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = sel.value;
  sel.replaceChildren(h('option', { value: '' }, 'No enquiry, just a picture'),
    ...open.map((l) => h('option', { value: l.id }, `${l.name || 'Unknown'}${l.company ? `, ${l.company}` : ''}${l.files?.length ? ` (${l.files.length} file${l.files.length === 1 ? '' : 's'})` : ''}`)));
  sel.value = open.some((l) => l.id === keep) ? keep : '';
}

async function pickLead(id, applyDesign) {
  state.lead = id;
  const l = all.find((x) => x.id === id);
  $('#tmSave').disabled = !l;
  $('#tmSaveNote').textContent = l ? `Saves the picture to ${l.name || 'the enquiry'}'s files, ready to attach to a reply.` : 'Choose an enquiry above to save the mockup to it. Saved mockups can be attached to a reply.';
  const images = (l?.files || []).filter((f) => /^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type));
  const others = (l?.files || []).filter((f) => !images.includes(f));
  const fromLead = $('#tmFromLead');
  $('#tmFromLeadWrap').hidden = !l || !(l.files || []).length;
  fromLead.replaceChildren(h('option', { value: '' }, images.length ? 'Choose a file' : 'No image files to use'),
    ...images.map((f) => h('option', { value: f.id }, `${f.name} (${f.kind})`)),
    ...others.map((f) => h('option', { value: '', disabled: true }, `${f.name}: download it and export a PNG or SVG`)));
  const artFrom = $('#tmArtFromLead');
  $('#tmArtFromLeadWrap').hidden = !images.length;
  artFrom.replaceChildren(h('option', { value: '' }, 'Choose a file'), ...images.map((f) => h('option', { value: f.id }, `${f.name} (${f.kind})`)));
  if (!l) return;
  if (applyDesign && l.design?.mode === 'artwork') {
    // the client sent a full artwork: show it the way they placed it
    const d = l.design;
    Object.assign(state, { size: d.size || state.size, scale: d.scale || 1, dx: d.dx || 0, dy: d.dy || 0, fit: d.fit === 'contain' ? 'contain' : 'cover' });
    if (bags.some((b) => b.id === d.template)) state.bag = d.template;
    setMode('artwork', { quiet: true });
    syncControls(); renderBags();
    const art = images.find((f) => f.kind === 'artwork');
    if (art) { artFrom.value = art.id; await useLeadArtwork(l, art); }
    say(art ? 'The full artwork the client sent is on the mockup, placed as they placed it.' : 'The client chose full artwork, but no image file came with it. Ask them for a PNG or PDF.');
    return;
  }
  if (applyDesign && l.design) {
    const d = l.design;
    setMode('brand', { quiet: true });
    Object.assign(state, { size: d.size || state.size, ink: d.ink || state.ink, text1: d.text1 ?? '', text2: d.text2 ?? '', scale: d.scale || 1, dx: d.dx || 0, dy: d.dy || 0, oneInk: !!d.oneInk });
    if (bags.some((b) => b.id === d.template)) { state.bag = d.template; renderBags(); }
    syncControls();
    renderBags();
    const logo = images.find((f) => f.kind === 'logo');
    if (logo) { fromLead.value = logo.id; await useLeadFile(l, logo); }
    if (d.boxRemoved && state.logo && logoCheck?.boxed) {
      await fixBox();
      say('The design the client made in the studio is loaded, with the white box they removed from the logo removed here too.');
    } else say('The design the client made in the studio is loaded.');
  }
}

// the product's own sizes (set in the admin); the three bag sizes for older products
function buildSizes() {
  const b = bag();
  if (!b) return;
  const sizes = sizesOf(b);
  if (!sizes.some((z) => z.id === state.size)) state.size = (sizes.find((z) => z.id === 'medium') || sizes[0]).id;
  $('#tmSizes').replaceChildren(...sizes.map((z) => {
    const input = h('input', { type: 'radio', name: 'tmSize', value: z.id, checked: z.id === state.size || null });
    input.addEventListener('change', () => { if (input.checked) { state.size = z.id; draw(); } });
    return h('label', { class: 'opt', title: z.dims || null }, input, h('span', {}, z.label));
  }));
}

function syncControls() {
  buildSizes();
  $$('input[name="tmSize"]').forEach((r) => { r.checked = r.value === state.size; });
  $$('input[name="tmInk"]').forEach((r) => { r.checked = r.value === state.ink; });
  $$('input[name="tmMode"]').forEach((r) => { r.checked = r.value === state.mode; });
  $$('input[name="tmFit"]').forEach((r) => { r.checked = r.value === state.fit; });
  $('#tmText1').value = state.text1; $('#tmText2').value = state.text2;
  $('#tmScale').value = Math.round(state.scale * 100);
  $('#tmOneInk').checked = state.oneInk;
}

async function useLeadFile(l, f) {
  try {
    const blob = await fileBlob(l, f);
    await setLogo(blob, f.name);
  } catch (e) { toast(e.message, 'error'); }
}
function setLogo(blob, name) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { state.logo = img; state.logoName = name; $('#tmDropTitle').textContent = name; $('#tmRemoveLogo').hidden = false; readLogo(img); draw(); say(`Logo ${name} is on the bag.`); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read. Try a PNG or SVG export.', 'error'); resolve(); };
    img.src = url;
  });
}

/* ---------- full artwork ---------- */
function setMode(mode, { quiet } = {}) {
  state.mode = mode;
  for (const el of $$('[data-tm-mode]')) el.hidden = el.dataset.tmMode !== mode;
  $$('input[name="tmMode"]').forEach((r) => { r.checked = r.value === mode; });
  if (!quiet) { state.dx = 0; state.dy = 0; state.scale = 1; $('#tmScale').value = 100; draw(); say(mode === 'artwork' ? 'Full artwork.' : 'Logo and text.'); }
}
function setArtwork(blob, name) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { state.artwork = img; state.artworkName = name; state.dx = 0; state.dy = 0; $('#tmArtTitle').textContent = name; $('#tmRemoveArt').hidden = false; draw(); say(`Artwork ${name} is on the mockup.`); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read. Export the page as a PNG or JPG.', 'error'); resolve(); };
    img.src = url;
  });
}
async function useLeadArtwork(l, f) {
  try { await setArtwork(await fileBlob(l, f), f.name); } catch (e) { toast(e.message, 'error'); }
}

async function draw() {
  const b = bag();
  if (!b) return;
  const id = ++pending;
  try {
    const B = await prepare(b);
    if (id !== pending) return;
    current = B;
    const ctx = canvas().getContext('2d');
    render(ctx, B, state);
    drawGuides(ctx, B, guides, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#186078', state.mode);
    $('#tmInfo').textContent = specLine(b, state);
    if (state.mode === 'artwork') {
      const a = artworkAdvice(b, B, state);
      $('#tmArtHint').textContent = `Print area: ${a.shape}. ${a.size}`.trim();
      $('#tmArtAdvice').hidden = !a.warnings.length; $('#tmArtAdvice').textContent = a.warnings.join(' ');
    }
  } catch (e) { $('#tmInfo').textContent = e.message; }
}

/* the same logo check as the public studio: a white box, or a logo too pale for kraft */
function readLogo(img) {
  try { logoCheck = checkLogo(img); } catch (e) { logoCheck = null; }
  advise();
}
function advise() {
  const c = state.logo && logoCheck;
  const boxed = !!(c && c.boxed), pale = !!(c && !c.boxed && c.light && !state.oneInk);
  $('#tmLogoAdvice').hidden = !boxed && !pale;
  $('#tmFixBox').hidden = !boxed;
  $('#tmFixInk').hidden = !pale;
  $('#tmLogoAdviceText').textContent = boxed
    ? 'This logo sits on a white box, which prints as a patch on kraft. Remove it for the mockup, and ask the client for a transparent PNG or vector file for print.'
    : pale ? 'This logo is very pale and will hardly show on kraft. Print it in the ink colour, or ask the client for a darker version.' : '';
}
async function fixBox() {
  if (!state.logo || !logoCheck?.boxed) return;
  try { state.logo = await removeBox(state.logo, logoCheck.bg); readLogo(state.logo); draw(); }
  catch (e) { toast(e.message, 'error'); }
}

function bind() {
  $('#tmFixBox').addEventListener('click', async () => { await fixBox(); say('White box removed from the logo on the mockup.'); ($('#tmFixInk').hidden ? $('#tmOneInk') : $('#tmFixInk')).focus(); });
  $('#tmFixInk').addEventListener('click', () => { const box = $('#tmOneInk'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); box.focus(); });
  $('#tmLead').addEventListener('change', (e) => pickLead(e.target.value, true));
  $$('input[name="tmMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setMode(r.value); }));
  $$('input[name="tmFit"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { state.fit = r.value; state.dx = 0; state.dy = 0; draw(); } }));
  $('#tmArtFromLead').addEventListener('change', (e) => {
    const l = all.find((x) => x.id === state.lead), f = l?.files?.find((x) => x.id === e.target.value);
    if (l && f) useLeadArtwork(l, f);
  });
  {
    const file = $('#tmArtFile'), drop = $('#tmArtDrop');
    const take = (f) => {
      if (!f || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) return toast('Choose a PNG, JPG, WebP or SVG of the artwork. For a PDF, export the page as an image.', 'error');
      setArtwork(f, f.name);
    };
    file.addEventListener('change', () => { take(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));
  }
  $('#tmRemoveArt').addEventListener('click', () => { state.artwork = null; state.artworkName = ''; $('#tmArtTitle').textContent = 'Upload the artwork'; $('#tmRemoveArt').hidden = true; $('#tmArtFromLead').value = ''; draw(); say('Artwork removed.'); });
  $('#tmFromLead').addEventListener('change', (e) => {
    const l = all.find((x) => x.id === state.lead), f = l?.files?.find((x) => x.id === e.target.value);
    if (l && f) useLeadFile(l, f);
  });
  $$('input[name="tmInk"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { state.ink = r.value; draw(); } }));
  $('#tmText1').addEventListener('input', (e) => { state.text1 = e.target.value; draw(); });
  $('#tmText2').addEventListener('input', (e) => { state.text2 = e.target.value; draw(); });
  $('#tmText1').value = state.text1; $('#tmText2').value = state.text2;
  $('#tmScale').addEventListener('input', (e) => { state.scale = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); draw(); });
  $('#tmOneInk').addEventListener('change', (e) => { state.oneInk = e.target.checked; draw(); advise(); });
  $('#tmCentre').addEventListener('click', () => { state.dx = 0; state.dy = 0; draw(); say('Design centred.'); });
  $('#tmRemoveLogo').addEventListener('click', () => { state.logo = null; state.logoName = ''; logoCheck = null; advise(); $('#tmDropTitle').textContent = 'Upload a logo'; $('#tmRemoveLogo').hidden = true; $('#tmFromLead').value = ''; draw(); say('Logo removed.'); });
  const file = $('#tmLogoFile'), drop = $('#tmDrop');
  const take = (f) => {
    if (!f || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) return toast('Choose a PNG, JPG, SVG or WebP image.', 'error');
    setLogo(f, f.name);
  };
  file.addEventListener('change', () => { take(file.files[0]); file.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));

  // move the design: drag or arrow keys
  const c = canvas();
  const toCanvas = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  let drag = null;
  c.addEventListener('pointerdown', (e) => {
    if (!current) return;
    const p = toCanvas(e);
    if (!c.getContext('2d').isPointInPath(current.poly, p[0], p[1])) return;
    drag = { a: toArtboard(current, ...p), dx: state.dx, dy: state.dy };
    c.setPointerCapture(e.pointerId); c.classList.add('is-dragging');
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const a = toArtboard(current, ...toCanvas(e));
    const s = snapDesign(current, drag.dx + a[0] - drag.a[0], drag.dy + a[1] - drag.a[1]);
    guides = { x: s.x, y: s.y };
    state.dx = s.dx; state.dy = s.dy; clampDesign(current, state); draw();
  });
  const end = () => { if (drag) { drag = null; guides = null; c.classList.remove('is-dragging'); draw(); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 15;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!m || !current) return;
    e.preventDefault(); state.dx += m[0]; state.dy += m[1]; clampDesign(current, state); draw();
  });

  const name = (ext) => {
    const l = all.find((x) => x.id === state.lead);
    const who = (l?.company || l?.name || 'olira').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'olira';
    return `${who}-${(bag()?.handle || 'bag')}-${state.size}-mockup.${ext}`;
  };
  $('#tmDownloadPng').addEventListener('click', async () => { if (current) saveBlob(await exportImage(current, state, { type: 'png' }), name('png')); });
  $('#tmDownloadJpg').addEventListener('click', async () => { if (current) saveBlob(await exportImage(current, state, { type: 'jpg' }), name('jpg')); });
  $('#tmSave').addEventListener('click', async (e) => {
    const l = all.find((x) => x.id === state.lead);
    if (!l || !current) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving';
    try {
      const blob = await exportImage(current, state, { type: 'png' });
      const fd = new FormData();
      fd.append('file', new File([blob], name('png'), { type: 'image/png' }));
      fd.append('kind', 'mockup');
      const r = await api(`/api/team/inquiries/${encodeURIComponent(l.id)}/files`, { method: 'POST', form: fd });
      putLead(r.inquiry);
      all = all.map((x) => (x.id === l.id ? r.inquiry : x));
      replaceLead(r.inquiry);
      renderLeads(); $('#tmLead').value = l.id; pickLead(l.id, false);
      toast(`Mockup saved to ${l.name || 'the enquiry'}. Attach it to a reply from the Inbox.`);
    } catch (x) { toast(x.message, 'error'); }
    finally { btn.disabled = !state.lead; btn.textContent = 'Save to the enquiry'; }
  });
}

export { session };
