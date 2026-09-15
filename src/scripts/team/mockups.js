// Packaging workspace: Mockups. The same renderer as the public studio, with
// the client's own files as logo sources and saving the result to the enquiry.
import { $, $$, h, api, toast } from '../admin/api.js';
import { SIZES, defaultDesign, prepare, render, toArtboard, clampDesign, exportImage, specLine, saveBlob, usableInStudio, onThemeChange } from '../mockup/engine.js';
import { leads, putLead, OPEN, session } from './session.js';
import { fileBlob, replace as replaceLead } from './inbox.js';

let bound = false;
let bags = [];
let all = [];
const state = { bag: null, lead: '', logoName: '', ...defaultDesign() };
let current = null, pending = 0;
const canvas = () => $('#tmCanvas');
const say = (msg) => { const s = $('#tmStatus'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
const bag = () => bags.find((b) => b.id === state.bag) || bags[0];

export async function show({ params }) {
  if (!bound) { bound = true; bind(); onThemeChange(() => draw()); }
  try {
    [bags, all] = await Promise.all([api('/api/packaging-products?scope=team').then((l) => l.filter(usableInStudio)), leads()]);
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); return; }
  if (!bags.length) {
    $('#tmBags').replaceChildren(h('p', { class: 'a-note' }, 'No bags are set up for mockups yet. The administrator adds them under Packaging products.'));
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
    input.addEventListener('change', () => { if (input.checked) { state.bag = b.id; state.dx = 0; state.dy = 0; draw(); say(`Bag changed to ${b.name}.`); } });
    return h('label', { class: 'opt' }, input, h('span', {}, b.name));
  }));
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
  if (!l) return;
  if (applyDesign && l.design) {
    const d = l.design;
    Object.assign(state, { size: SIZES[d.size] ? d.size : state.size, ink: d.ink || state.ink, text1: d.text1 ?? '', text2: d.text2 ?? '', scale: d.scale || 1, dx: d.dx || 0, dy: d.dy || 0, oneInk: !!d.oneInk });
    if (bags.some((b) => b.id === d.template)) state.bag = d.template;
    syncControls();
    renderBags();
    const logo = images.find((f) => f.kind === 'logo');
    if (logo) { fromLead.value = logo.id; await useLeadFile(l, logo); }
    say('The design the client made in the studio is loaded.');
  }
}

function syncControls() {
  $$('input[name="tmSize"]').forEach((r) => { r.checked = r.value === state.size; });
  $$('input[name="tmInk"]').forEach((r) => { r.checked = r.value === state.ink; });
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
    img.onload = () => { state.logo = img; state.logoName = name; $('#tmDropTitle').textContent = name; $('#tmRemoveLogo').hidden = false; draw(); say(`Logo ${name} is on the bag.`); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read. Try a PNG or SVG export.', 'error'); resolve(); };
    img.src = url;
  });
}

async function draw() {
  const b = bag();
  if (!b) return;
  const id = ++pending;
  try {
    const B = await prepare(b);
    if (id !== pending) return;
    current = B;
    render(canvas().getContext('2d'), B, state);
    $('#tmInfo').textContent = specLine(b, state);
  } catch (e) { $('#tmInfo').textContent = e.message; }
}

function bind() {
  $('#tmLead').addEventListener('change', (e) => pickLead(e.target.value, true));
  $('#tmFromLead').addEventListener('change', (e) => {
    const l = all.find((x) => x.id === state.lead), f = l?.files?.find((x) => x.id === e.target.value);
    if (l && f) useLeadFile(l, f);
  });
  $$('input[name="tmSize"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { state.size = r.value; draw(); } }));
  $$('input[name="tmInk"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { state.ink = r.value; draw(); } }));
  $('#tmText1').addEventListener('input', (e) => { state.text1 = e.target.value; draw(); });
  $('#tmText2').addEventListener('input', (e) => { state.text2 = e.target.value; draw(); });
  $('#tmText1').value = state.text1; $('#tmText2').value = state.text2;
  $('#tmScale').addEventListener('input', (e) => { state.scale = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); draw(); });
  $('#tmOneInk').addEventListener('change', (e) => { state.oneInk = e.target.checked; draw(); });
  $('#tmCentre').addEventListener('click', () => { state.dx = 0; state.dy = 0; draw(); say('Design centred.'); });
  $('#tmRemoveLogo').addEventListener('click', () => { state.logo = null; state.logoName = ''; $('#tmDropTitle').textContent = 'Upload a logo'; $('#tmRemoveLogo').hidden = true; $('#tmFromLead').value = ''; draw(); say('Logo removed.'); });
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
    state.dx = drag.dx + a[0] - drag.a[0]; state.dy = drag.dy + a[1] - drag.a[1]; clampDesign(current, state); draw();
  });
  const end = () => { if (drag) { drag = null; c.classList.remove('is-dragging'); } };
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
