// The studio's 3D view: the package built from the product's own measurements, beside
// the photo mockup. It appears only for products the packaging team has given a 3D
// shape (lib/box-styles.js) whose every size has its measurements, so a package is never
// drawn at a made-up size, and only while the packaging team and the manager both have
// 3D switched on (the public catalogue leaves the shape out otherwise). A package with
// no photo yet is shown in 3D alone.
//
// The switch and its controls are all this file adds to the page; three.js and the
// scene (box packaging-3d, src/scripts/package-3d/scene.js) are fetched only when a
// package is first shown. The package wears the studio's own design, drawn by the same
// engine as the photo.
import { BOX_STYLES, boxOf } from '../../lib/box-styles.js';
import { usableInStudio, drawArt, makeCanvas, defaultDesign } from './mockup/engine.js';
import { track } from './common.js';

const stage = document.querySelector('#studio .stage');
const frame = stage?.querySelector('.stage-frame');
const flat = document.getElementById('bagCanvas');
const help = document.getElementById('stageHelp');

let on = false; // the 3D package is wanted (chosen, or the only view of a package with no photo)
let board = 'kraft'; // the board it is shown on now
let scene = null, loading = null;
let failed = false; // this device could not start it: not tried again on this visit
let counted = false, lidCounted = false, flatCounted = false; // its use, recorded once a visit (UX-9)

/** For the studio (pack.js): whether the 3D package is showing, its state, its picture, and its board. */
export const view3d = {
  on: () => on && !!scene,
  state: () => (failed ? 'failed' : scene ? 'ready' : on ? 'loading' : 'off'),
  board: () => board,
  snapshot: () => (scene && on ? scene.snapshot() : Promise.resolve(null)),
};

/**
 * The studio's design for one face of the package, at that face's proportions. Without
 * a logo the studio keeps the logo's place above the text; on a package the text is
 * centred instead, as it would be printed.
 */
function printFor(design, wmm, hmm) {
  const AW = 1000, AH = Math.max(100, Math.min(4000, Math.round(AW * (hmm / Math.max(1, wmm)))));
  const B = { art: makeCanvas(AW, AH), AW, AH, safeTop: 0.08 };
  // no dashed "your logo" box on a package: that is a hint on the photo, not print
  drawArt(B, { ...defaultDesign(), ...design, placeholder: false });
  const ink = B.ink, noLogo = design?.mode !== 'artwork' && !design?.logo;
  if (!(noLogo && ink && ink.y1 > ink.y0)) return B.art;
  const out = makeCanvas(AW, AH);
  out.getContext('2d').drawImage(B.art, 0, AH / 2 - (ink.y0 + ink.y1) / 2);
  return out;
}
/** What the scene paints: the studio's design on the package's main faces, the ink printed into kraft. */
const lookOf = (detail, box) => ({ mode: 'design', main: box.main, multiply: detail?.state?.ink !== 'white', draw: (w, h) => printFor(detail?.state, w, h) });

if (stage && frame && flat) {
  const helpPhoto = help?.textContent || '';
  const HELP_3D = 'Drag the package to turn it, or focus it and use the arrow keys.';
  let latest = null; // the studio's design and product, from its last drawing
  let built = ''; // what the package was last built from (product, size, board)

  const bar = document.createElement('div');
  bar.className = 'stage-3d-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <div class="chips" role="radiogroup" aria-label="Preview" data-switch>
      <label class="opt"><input type="radio" name="view3d" value="photo" checked><span>Photo mockup</span></label>
      <label class="opt"><input type="radio" name="view3d" value="3d"><span>3D package</span></label>
    </div>
    <div class="stage-3d-controls" hidden>
      <div class="chips" role="radiogroup" aria-label="Board" data-boards hidden>
        <label class="opt"><input type="radio" name="board3d" value="kraft" checked><span>Brown kraft</span></label>
        <label class="opt"><input type="radio" name="board3d" value="white"><span>White board</span></label>
      </div>
      <div class="views-3d" role="group" aria-label="Show it">
        <button class="btn btn-secondary btn-sm" type="button" data-lid="closed" aria-pressed="true">Closed</button>
        <button class="btn btn-secondary btn-sm" type="button" data-lid="open" aria-pressed="false">Open</button>
        <button class="btn btn-secondary btn-sm" type="button" data-lid="flat" aria-pressed="false">Lay flat</button>
      </div>
      <div class="views-3d" role="group" aria-label="Turn the package to">
        <button class="btn btn-secondary btn-sm" type="button" data-view="front">Front</button>
        <button class="btn btn-secondary btn-sm" type="button" data-view="side">Side</button>
        <button class="btn btn-secondary btn-sm" type="button" data-view="back">Back</button>
        <button class="btn btn-secondary btn-sm" type="button" data-view="top">Top</button>
      </div>
      <label class="check check-row"><input type="checkbox" id="sizes3d" checked> Show the measurements</label>
      <p class="note" id="about3d"></p>
    </div>
    <p class="note" id="status3d" role="status" aria-live="polite"></p>`;
  stage.append(bar);
  const $ = (s) => bar.querySelector(s);
  const controls = $('.stage-3d-controls');
  const say = (msg) => { $('#status3d').textContent = ''; setTimeout(() => { $('#status3d').textContent = msg; }, 60); };
  // on the stage itself, for a package with no photo: loading, or why there is none
  const notice = document.createElement('p');
  notice.className = 'stage-3d-msg';
  notice.hidden = true;
  frame.append(notice);
  const note = (msg) => { notice.textContent = msg; notice.hidden = !msg; };

  /**
   * The package for the studio's current product and size, or null when it cannot be
   * shown: boxOf (lib/box-styles.js) gives nothing for a product without a 3D shape or
   * with a size the team has not measured, so nothing is drawn at a guessed size.
   */
  function boxFor(detail) {
    const box = boxOf(detail?.product, detail?.state?.size, board);
    if (!box) return null;
    board = box.board;
    return box;
  }

  async function show3d() {
    if (!boxFor(latest)) return;
    if (failed) { unavailable(); return; }
    on = true;
    controls.hidden = false;
    $('input[name="view3d"][value="3d"]').checked = true;
    if (help) help.textContent = HELP_3D;
    if (!scene) {
      say('Loading the 3D package.');
      if (!usableInStudio(latest?.product)) note('Loading the 3D package.');
      loading ||= import('./package-3d/scene.js').then((m) => m.createScene(frame));
      try { scene = await loading; } catch (e) { failed = true; loading = null; unavailable(); return; }
      say(''); note('');
    }
    if (!on) return;
    // the visitor may have changed the product, size or board while three.js loaded:
    // build what is chosen now, not what was chosen when the 3D view was asked for
    const box = boxFor(latest);
    if (!box) { showPhoto(); return; }
    about(box);
    scene.show(box, lookOf(latest, box)); built = box.key;
    scene.sizes($('#sizes3d').checked);
    syncLid();
    flat.style.visibility = 'hidden';
    if (!counted) { counted = true; track({ event: 'view_3d' }); } // once a visit
  }
  /** This device cannot draw the package: the photo when there is one, else a note on the stage. */
  function unavailable() {
    on = false;
    controls.hidden = true;
    const choose3d = $('input[name="view3d"][value="3d"]');
    choose3d.disabled = true;
    choose3d.closest('label').title = 'This device cannot show the 3D package';
    if (usableInStudio(latest?.product)) {
      showPhoto();
      say('This device cannot show the 3D package, so the photo mockup is shown.');
    } else {
      note('This device cannot show the 3D package. Your design and files are still sent with your request.');
      say('This device cannot show the 3D package.');
    }
    // the request summary says no picture can be made for a package with no photo
    document.dispatchEvent(new CustomEvent('studio:3d-unavailable'));
  }
  function showPhoto() {
    on = false;
    controls.hidden = true;
    $('input[name="view3d"][value="photo"]').checked = true;
    if (help) help.textContent = helpPhoto;
    scene?.hide();
    flat.style.visibility = '';
  }
  /** The state buttons follow the package: Open only for one with a lid. */
  function syncLid() {
    const now = scene?.state() || 'closed', lid = !!scene?.info().hasLid;
    bar.querySelectorAll('[data-lid]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lid === now));
      if (b.dataset.lid === 'open') b.hidden = !lid;
    });
  }
  /** The text under the controls: what the package is, at what size, and that it is a preview. */
  function about(box) {
    const size = box.labels.d ? `${box.labels.w} wide, ${box.labels.d} deep, ${box.labels.h} high` : `${box.labels.w} wide, ${box.labels.h} high`;
    $('#about3d').textContent = `${BOX_STYLES[box.shape].label}, ${size}. A preview of the shape at this size; the final package follows the press's cutting die.`;
  }

  bar.querySelectorAll('input[name="view3d"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) (r.value === '3d' ? show3d : showPhoto)(); }));
  bar.querySelectorAll('input[name="board3d"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    board = r.value;
    const box = boxFor(latest);
    if (on && box && scene) { scene.update(box, lookOf(latest, box)); built = box.key; say(`Shown on ${r.value === 'white' ? 'white board' : 'brown kraft'}.`); }
  }));
  bar.querySelectorAll('[data-lid]').forEach((b) => b.addEventListener('click', () => {
    const to = b.dataset.lid;
    scene?.go(to);
    syncLid();
    if (to === 'open' && !lidCounted) { lidCounted = true; track({ event: 'lid_3d' }); }
    if (to === 'flat' && !flatCounted) { flatCounted = true; track({ event: 'flat_3d' }); }
    say(to === 'open' ? 'Lid open.' : to === 'flat' ? 'Laid flat, with its cut and fold lines.' : 'Closed.');
  }));
  bar.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => scene?.view(b.dataset.view)));
  $('#sizes3d').addEventListener('change', (e) => scene?.sizes(e.target.checked));

  // every drawing in the studio (product, size, text, logo, ink) reaches the package
  document.addEventListener('studio:drawn', (e) => {
    latest = e.detail;
    const box = boxFor(latest);
    const photo = usableInStudio(latest?.product);
    bar.hidden = !box;
    // nothing to switch between for a package with no photo yet
    $('[data-switch]').hidden = !photo;
    if (photo || !box) note('');
    if (!box) { if (on) showPhoto(); return; }
    $('[data-boards]').hidden = !box.both;
    // a foil package has no board to choose between
    const radio = bar.querySelector(`input[name="board3d"][value="${box.board}"]`);
    if (radio) radio.checked = true;
    about(box);
    // a package with no photo yet is only shown in 3D (or its note, where it cannot run)
    if (!photo && failed) { note('This device cannot show the 3D package. Your design and files are still sent with your request.'); return; }
    if (!photo && !on) { show3d(); return; }
    if (!on || !scene) return;
    if (box.key !== built) { scene.update(box, lookOf(latest, box)); built = box.key; syncLid(); } else scene.paint(lookOf(latest, box));
  });
}
