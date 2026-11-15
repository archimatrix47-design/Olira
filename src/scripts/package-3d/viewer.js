// A packaging product in 3D with the visitor's own print (box packaging-3d): Closed,
// Open (a package with a lid) and Lay flat over the view, and a panel to try a print on
// it: a logo on one face, one artwork over the whole package, or artwork on the faces
// the visitor picks (from the list, or by clicking the package).
//
// Used on a product page (pd-pack.js, only while both 3D switches are on) and in the
// staff preview (scripts/team/package-3d.js, whatever the switches say). The visitor's
// files are read in this browser only: nothing here is uploaded. three.js and the scene
// are fetched only when the package is first shown.
import { boxOf, BOARDS } from '../../../lib/box-styles.js';
import { keepDesign } from './handoff.js';

const BRAND = 'olira-brand'; // what the visitor typed as their brand anywhere on the site (live-print.js)
const MAX_FILE = 15 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const el = (tag, attrs = {}, text) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  if (text != null) n.textContent = text;
  return n;
};
let uid = 0;

/** A picture the visitor chose, read here in the browser; null when it is not one. */
function readImage(file) {
  return new Promise((resolve) => {
    if (!file || !TYPES.includes(file.type) || file.size > MAX_FILE) return resolve(null);
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; // loaded: the address is no longer needed
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Mount the viewer.
 *   media: the element the 3D view fills (positioned, with a size of its own)
 *   panelHost: where the "Try your print" panel goes (after this element), or null for none
 *   product: { id, name, sizes, shape3d, board3d } (has3d must be true)
 *   photo: the media shows a photo: start with a "See it in 3D" button instead of loading at once
 *   panelOpen: the print panel opens with the view (default: only when the visitor asked for 3D).
 *     Where the package loads on its own, the panel waits for "Try your print", so nothing on the
 *     page moves without the visitor asking
 *   quoteHref: the quote form's address: offers "Request a quote with this design", which takes the design there
 *   track(event): the site's event counter, or nothing
 *   backdrop: the scene's backdrop colour
 * Returns { start, destroy } (start shows the package now).
 */
export function mountViewer({ media, panelHost = null, product, photo = false, panelOpen = photo, quoteHref = null, track = () => {}, backdrop } = {}) {
  const id = `p3d${++uid}`;
  let scene = null, loading = null, failed = false, box = null, gone = false, hinted = false;
  let sizeId = product.sizes.find((s) => s.id === 'medium')?.id || product.sizes[0]?.id;
  let board = 'kraft';
  const counted = new Set();
  const once = (ev) => { if (!counted.has(ev)) { counted.add(ev); track({ event: ev }); } };
  let brand = '';
  try { brand = (localStorage.getItem(BRAND) || '').trim(); } catch (e) { brand = ''; }
  // what is printed: the starting look is the visitor's brand name, or YOUR BRAND
  const look = { mode: 'logo', logo: null, logoText: brand ? brand.toUpperCase() : 'YOUR BRAND', logoFace: null, logoScale: 0.6, logoAt: { x: 0, y: 0 }, art: null, faces: [] };
  let sample = null, sampleArt = null;

  /* ---------- on the view: the state buttons, and the way back to the photo ---------- */
  const bar = el('div', { class: 'p3d-bar', role: 'group', 'aria-label': 'Show the package' });
  const stateBtn = (name, text) => { const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-state': name, 'aria-pressed': String(name === 'closed') }, text); bar.append(b); return b; };
  stateBtn('closed', 'Closed'); const openBtn = stateBtn('open', 'Open'); stateBtn('flat', 'Lay flat');
  // back to where it started, after turning it out of sight or zooming too far
  const resetBtn = el('button', { class: 'btn btn-secondary btn-sm p3d-reset', type: 'button' }, 'Reset view');
  bar.append(resetBtn);
  resetBtn.addEventListener('click', () => { if (!scene) return; scene.view(scene.state() === 'flat' ? 'flat' : 'start'); say('View reset.'); });
  const back = photo ? el('button', { class: 'btn btn-secondary btn-sm p3d-photo', type: 'button' }, 'Photo') : null;
  // the print panel opens and closes from the view, so the page moves only when asked
  const tryBtn = panelHost ? el('button', { class: 'btn btn-secondary btn-sm p3d-try', type: 'button', 'aria-expanded': 'false' }, 'Try your print') : null;
  if (tryBtn) bar.append(tryBtn);
  if (back) bar.append(back);
  bar.hidden = true;
  const startBtn = photo ? el('button', { class: 'btn btn-secondary btn-sm p3d-start', type: 'button' }, 'See it in 3D') : null;
  const status = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  media.append(...[startBtn, bar, status].filter(Boolean));
  const say = (msg) => { status.textContent = ''; setTimeout(() => { status.textContent = msg; }, 60); };

  /* ---------- beside it: try a print ---------- */
  const panel = panelHost ? el('section', { class: 'p3d-print', 'aria-labelledby': `${id}-title` }) : null;
  const q = (s) => panel?.querySelector(s);
  if (panel) {
    const both = BOARDS[product.board3d] && product.board3d === 'both';
    panel.innerHTML = `
      <h2 class="p3d-title" id="${id}-title">Try your print on it</h2>
      <div class="p3d-row">
        <label class="p3d-field"><span>Size</span><select class="input" data-size></select></label>
        ${both ? `<div class="p3d-field"><span id="${id}-board">Board</span><div class="chips" role="radiogroup" aria-labelledby="${id}-board">
          <label class="opt"><input type="radio" name="${id}-board" value="kraft" checked><span>Brown kraft</span></label>
          <label class="opt"><input type="radio" name="${id}-board" value="white"><span>White board</span></label></div></div>` : ''}
      </div>
      <fieldset class="p3d-modes"><legend>What to print</legend>
        <label class="check check-row"><input type="radio" name="${id}-mode" value="logo" checked> Your logo on one face</label>
        <label class="check check-row"><input type="radio" name="${id}-mode" value="wrap"> One artwork over the whole package</label>
        <label class="check check-row"><input type="radio" name="${id}-mode" value="faces"> Artwork on the faces you choose</label>
      </fieldset>
      <div class="p3d-set" data-set="logo">
        <label class="p3d-field"><span>Logo file</span><input class="input" type="file" accept="${TYPES.join(',')}" data-logo-file></label>
        <div class="p3d-row">
          <label class="p3d-field"><span>On the</span><select class="input" data-logo-face></select></label>
          <label class="p3d-field"><span>Logo size</span><input type="range" min="0.25" max="0.95" step="0.05" value="0.6" data-logo-scale></label>
        </div>
        <div class="p3d-row">
          <label class="p3d-field"><span>Move it across</span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-logo-x></label>
          <label class="p3d-field"><span>Move it up or down</span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-logo-y></label>
        </div>
        <p class="note">Or drag the logo on the package to where you want it.</p>
        <p class="note">Until you choose a logo, ${brand ? 'your brand name' : 'YOUR BRAND'} is printed in its place.</p>
      </div>
      <div class="p3d-set" data-set="art" hidden>
        <label class="p3d-field"><span>Artwork file</span><input class="input" type="file" accept="${TYPES.join(',')}" data-art-file></label>
        <p class="note" data-art-note>A sample pattern is shown until you choose your artwork.</p>
      </div>
      <fieldset class="p3d-set" data-set="faces" hidden><legend>Faces to print</legend>
        <div class="chips" data-faces></div>
        <p class="note">Or click a face on the package.</p>
      </fieldset>
      <p class="note p3d-msg" data-msg role="status" aria-live="polite"></p>
      <div class="p3d-row">${quoteHref ? '<button class="btn btn-primary" type="button" data-quote>Request a quote with this design</button>' : ''}<button class="btn btn-secondary" type="button" data-save>Save this picture</button></div>
      <p class="note">A preview of the shape at the size you choose. The final package and its flat layout follow the press's cutting die.</p>
      <p class="note">Your files stay in this browser. To send your design with a quote request, use the studio.</p>`;
    panel.hidden = true;
    panelHost.after(panel);
    // the package as it is turned and printed now, as a picture to keep or send on
    q('[data-save]').addEventListener('click', async () => {
      const blob = scene ? await scene.snapshot() : null;
      if (!blob) { message('The picture could not be made. Try again in a moment.'); return; }
      const a = el('a', { href: URL.createObjectURL(blob), download: `${String(product.name || 'package').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-3d.png` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      once('save_3d'); message('Picture saved.');
    });
    // to the quote form with this design: its choices and a picture, kept in this tab until the form is sent
    q('[data-quote]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const blob = scene ? await scene.snapshot(1000) : null;
      const picture = blob ? await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(blob); }) : '';
      const faces = scene?.info().faces || [];
      const kept = picture && keepDesign({
        productId: product.id, productName: product.name, size: box.sizeId, sizeLabel: box.sizeLabel, board: box.board,
        print: look.mode, face: look.mode === 'logo' ? look.logoFace : '', faceName: faces.find((f) => f.id === look.logoFace)?.name || '',
        faces: look.mode === 'faces' ? look.faces : [], hasLogo: !!look.logo, hasArtwork: !!look.art, picture,
      });
      if (kept) { once('quote_3d'); location.href = quoteHref; return; }
      btn.disabled = false;
      message('This browser could not keep the picture. Use "Save this picture" and attach it to your request.');
    });
    const sizeSel = q('[data-size]');
    for (const s of product.sizes) sizeSel.append(new Option(s.label, s.id));
    sizeSel.value = sizeId;
    sizeSel.addEventListener('change', () => { sizeId = sizeSel.value; rebuild(); });
    panel.querySelectorAll(`input[name="${id}-board"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) { board = r.value; rebuild(); } }));
    panel.querySelectorAll(`input[name="${id}-mode"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) { look.mode = r.value; showSets(); repaint(); } }));
    q('[data-logo-face]').addEventListener('change', (e) => { look.logoFace = e.target.value; centre(); repaint(); });
    q('[data-logo-x]').addEventListener('input', (e) => { look.logoAt = { ...look.logoAt, x: Number(e.target.value) }; repaint(); });
    q('[data-logo-y]').addEventListener('input', (e) => { look.logoAt = { ...look.logoAt, y: Number(e.target.value) }; repaint(); });
    q('[data-logo-scale]').addEventListener('input', (e) => { look.logoScale = Number(e.target.value); repaint(); });
    q('[data-logo-file]').addEventListener('change', async (e) => {
      const img = await readImage(e.target.files?.[0]);
      if (!img) { message('Choose a PNG, JPG, WebP or SVG picture of up to 15 MB.'); return; }
      look.logo = img; message('Your logo is on the package.'); once('art_3d'); repaint();
    });
    q('[data-art-file]').addEventListener('change', async (e) => {
      const img = await readImage(e.target.files?.[0]);
      if (!img) { message('Choose a PNG, JPG, WebP or SVG picture of up to 15 MB.'); return; }
      look.art = img; q('[data-art-note]').hidden = true; message('Your artwork is on the package.'); once('art_3d'); repaint();
    });
  }
  const message = (msg) => { const m = q('[data-msg]'); if (m) { m.textContent = ''; setTimeout(() => { m.textContent = msg; }, 60); } };
  function showSets() {
    if (!panel) return;
    q('[data-set="logo"]').hidden = look.mode !== 'logo';
    q('[data-set="art"]').hidden = look.mode === 'logo';
    q('[data-set="faces"]').hidden = look.mode !== 'faces';
  }
  /** The face lists follow the package: its faces, and the logo's usual place. */
  function fillFaces() {
    if (!panel || !scene) return;
    const faces = scene.info().faces;
    const sel = q('[data-logo-face]');
    sel.replaceChildren(...faces.map((f) => new Option(f.name, f.id)));
    if (!faces.some((f) => f.id === look.logoFace)) look.logoFace = box.main.find((m) => faces.some((f) => f.id === m)) || faces[0]?.id;
    sel.value = look.logoFace;
    look.faces = look.faces.filter((f) => faces.some((x) => x.id === f));
    if (!look.faces.length) look.faces = box.main.filter((m) => faces.some((f) => f.id === m)).slice(0, 1);
    const wrap = q('[data-faces]');
    wrap.replaceChildren(...faces.map((f) => {
      const l = el('label', { class: 'opt' }), c = el('input', { type: 'checkbox', value: f.id });
      c.checked = look.faces.includes(f.id);
      c.addEventListener('change', () => toggleFace(f.id, c.checked));
      l.append(c, el('span', {}, f.name));
      return l;
    }));
  }
  function toggleFace(faceId, on) {
    look.faces = on ? [...new Set([...look.faces, faceId])] : look.faces.filter((f) => f !== faceId);
    panel?.querySelectorAll('[data-faces] input').forEach((c) => { c.checked = look.faces.includes(c.value); });
    repaint();
    const name = scene?.info().faces.find((f) => f.id === faceId)?.name || 'Face';
    say(`${name} ${on ? 'printed' : 'left plain'}.`);
  }
  // wrap and faces without the visitor's artwork yet: the sample pattern, plainly a placeholder
  const lookNow = () => (look.mode !== 'logo' && !look.art ? { ...look, art: (sample ||= sampleArt ? sampleArt() : null) } : { ...look });
  // a click on a face prints it or not (chosen faces), or moves the logo there. Off while one
  // artwork covers the whole package, so a face is offered as clickable only when a click does something
  const pickFace = (faceId) => {
    if (look.mode === 'faces') toggleFace(faceId, !look.faces.includes(faceId));
    else if (look.mode === 'logo') {
      if (faceId !== look.logoFace) centre(); // on a new face it starts in the middle
      look.logoFace = faceId; const s = q('[data-logo-face]'); if (s) s.value = faceId; repaint();
      say(`Logo on the ${(scene?.info().faces.find((f) => f.id === faceId)?.name || 'face').toLowerCase()}.`);
    }
  };
  // the logo's place on its face: the sliders and a drag on the package set the same two numbers
  const syncAt = () => { const x = q('[data-logo-x]'), y = q('[data-logo-y]'); if (x) x.value = String(look.logoAt.x); if (y) y.value = String(look.logoAt.y); };
  function centre() { look.logoAt = { x: 0, y: 0 }; syncAt(); }
  const placedAt = (at) => { look.logoAt = { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 }; syncAt(); say('Logo moved.'); };
  function repaint() {
    if (!scene || !box) return;
    scene.paint(lookNow());
    scene.onPick(look.mode === 'wrap' ? null : pickFace);
    scene.onPlace(look.mode === 'logo' ? placedAt : null);
  }
  function syncState() {
    const now = scene?.state() || 'closed';
    bar.querySelectorAll('[data-state]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.state === now)));
    openBtn.hidden = !scene?.info().hasLid;
  }
  function rebuild() {
    box = boxOf(product, sizeId, board);
    if (!box || !scene) return;
    board = box.board;
    scene.update(box, lookNow());
    fillFaces(); repaint(); syncState();
    say(`${box.sizeLabel} size.`);
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-state]');
    if (!b || !scene) return;
    const to = b.dataset.state;
    scene.go(to); syncState();
    if (to === 'open') once('lid_3d');
    if (to === 'flat') once('flat_3d');
    say(to === 'open' ? 'Open.' : to === 'flat' ? 'Laid flat, with its cut lines in red and its folds dashed.' : 'Closed.');
  });

  async function start() {
    if (failed) return;
    box = boxOf(product, sizeId, board);
    if (!box) return;
    board = box.board;
    media.classList.add('is-loading-3d');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Loading the 3D view'; }
    // opened now, while the visitor's click is fresh, not when the view has loaded
    if (panelOpen) openPanel(true);
    try {
      if (!scene) {
        loading ||= import('./scene.js').then((m) => { sampleArt = m.sampleArt; return m.createScene(media, { backdrop, className: 'p3d-canvas' }); });
        const made = await loading;
        // taken away while it loaded (another preview was opened): give the drawing context back
        if (gone) { made.dispose(); return; }
        scene = made;
      }
      scene.show(box, lookNow());
      fillFaces(); repaint(); syncState();
      media.classList.add('has-3d');
      bar.hidden = false;
      // said once, in sight, until the visitor touches the view (the same is read out for screen readers)
      if (!hinted) {
        hinted = true;
        const hint = el('p', { class: 'p3d-hint', 'aria-hidden': 'true' }, 'Drag to turn. Pinch or scroll to zoom.');
        media.append(hint);
        const off = () => hint.remove();
        setTimeout(off, 6000); media.addEventListener('pointerdown', off, { once: true });
      }
      showSets();
      if (startBtn) startBtn.hidden = true;
      once('view_3d');
      say(`${product.name} in 3D. Drag to turn it.`);
    } catch (e) {
      // no WebGL here: the photo (or the product's name) stays in the panel, as before
      failed = true; loading = null; openPanel(false);
      if (startBtn) { startBtn.hidden = true; }
      media.classList.remove('has-3d');
    } finally {
      media.classList.remove('is-loading-3d');
      if (startBtn && !startBtn.hidden) { startBtn.disabled = false; startBtn.textContent = 'See it in 3D'; }
    }
  }
  function openPanel(on) {
    if (!panel) return;
    panel.hidden = !on;
    tryBtn.setAttribute('aria-expanded', String(on));
    if (on) showSets();
  }
  tryBtn?.addEventListener('click', () => { const on = panel.hidden; openPanel(on); if (on) panel.querySelector('select, input')?.focus({ preventScroll: true }); });
  function toPhoto() {
    scene?.hide();
    media.classList.remove('has-3d');
    bar.hidden = true;
    openPanel(false);
    if (startBtn) { startBtn.hidden = false; startBtn.focus(); }
  }
  startBtn?.addEventListener('click', start);
  back?.addEventListener('click', toPhoto);

  return {
    start,
    destroy() { gone = true; scene?.dispose(); scene = null; bar.remove(); startBtn?.remove(); status.remove(); panel?.remove(); media.classList.remove('has-3d', 'is-loading-3d'); },
  };
}
