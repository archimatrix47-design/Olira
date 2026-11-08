// The studio's 3D view: a box built from the product's own measurements, beside
// the photo mockup. It appears only for products the packaging team has given a
// 3D shape (lib/box-styles.js) and whose every size has its width, depth and
// height, so a box is never drawn at a made-up size. A box with no photo yet is
// shown in 3D alone.
//
// The switch and its controls are all this file adds to the page; three.js and
// the scene (studio-3d-scene.js) are fetched only when a 3D box is first shown.
// The box wears the studio's own design, drawn by the same engine as the photo.
import { BOX_STYLES, boxOf } from '../../lib/box-styles.js';
import { usableInStudio } from './mockup/engine.js';
import { track } from './common.js';

const stage = document.querySelector('#studio .stage');
const frame = stage?.querySelector('.stage-frame');
const flat = document.getElementById('bagCanvas');
const help = document.getElementById('stageHelp');

let on = false; // the 3D box is wanted (chosen, or the only view of a box with no photo)
let board = 'kraft'; // the board it is shown on now
let scene = null, loading = null;
let failed = false; // this device could not start it: not tried again on this visit
let counted = false, lidCounted = false; // the 3D box's use, recorded once a visit (UX-9)

/** For the studio (pack.js): whether the 3D box is showing, its state, its picture, and its board. */
export const view3d = {
  on: () => on && !!scene,
  state: () => (failed ? 'failed' : scene ? 'ready' : on ? 'loading' : 'off'),
  board: () => board,
  snapshot: () => (scene && on ? scene.snapshot() : Promise.resolve(null)),
};

if (stage && frame && flat) {
  const helpPhoto = help?.textContent || '';
  const HELP_3D = 'Drag the box to turn it, or focus it and use the arrow keys.';
  let latest = null; // the studio's design and product, from its last drawing
  let built = ''; // what the box was last built from (product, size, board)
  let open = false;

  const bar = document.createElement('div');
  bar.className = 'stage-3d-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <div class="chips" role="radiogroup" aria-label="Preview" data-switch>
      <label class="opt"><input type="radio" name="view3d" value="photo" checked><span>Photo mockup</span></label>
      <label class="opt"><input type="radio" name="view3d" value="3d"><span>3D box</span></label>
    </div>
    <div class="stage-3d-controls" hidden>
      <div class="chips" role="radiogroup" aria-label="Board" data-boards hidden>
        <label class="opt"><input type="radio" name="board3d" value="kraft" checked><span>Brown kraft</span></label>
        <label class="opt"><input type="radio" name="board3d" value="white"><span>White board</span></label>
      </div>
      <div class="views-3d" role="group" aria-label="Lid">
        <button class="btn btn-secondary btn-sm" type="button" data-lid="closed" aria-pressed="true">Closed</button>
        <button class="btn btn-secondary btn-sm" type="button" data-lid="open" aria-pressed="false">Open</button>
      </div>
      <div class="views-3d" role="group" aria-label="Turn the box to">
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
  // on the stage itself, for a box with no photo: loading, or why there is no box
  const notice = document.createElement('p');
  notice.className = 'stage-3d-msg';
  notice.hidden = true;
  frame.append(notice);
  const note = (msg) => { notice.textContent = msg; notice.hidden = !msg; };

  /**
   * The box for the studio's current product and size, or null when it cannot be
   * shown: boxOf (lib/box-styles.js) gives nothing for a product without a 3D shape
   * or with a size the team has not measured, so no box is drawn at a guessed size.
   */
  function boxFor(detail) {
    const box = boxOf(detail?.product, detail?.state?.size, board);
    if (!box) return null;
    board = box.board;
    return { ...box, sizes: $('#sizes3d').checked };
  }

  async function show3d() {
    if (!boxFor(latest)) return;
    if (failed) { unavailable(); return; }
    on = true;
    controls.hidden = false;
    $('input[name="view3d"][value="3d"]').checked = true;
    if (help) help.textContent = HELP_3D;
    if (!scene) {
      say('Loading the 3D box.');
      if (!usableInStudio(latest?.product)) note('Loading the 3D box.');
      loading ||= import('./studio-3d-scene.js').then((m) => m.createScene(frame));
      try { scene = await loading; } catch (e) { failed = true; loading = null; unavailable(); return; }
      say(''); note('');
    }
    if (!on) return;
    // the visitor may have changed the product, size or board while three.js loaded:
    // build what is chosen now, not what was chosen when the 3D view was asked for
    const box = boxFor(latest);
    if (!box) { showPhoto(); return; }
    about(box);
    open = false; syncLid();
    scene.show(box, latest); built = box.key;
    flat.style.visibility = 'hidden';
    if (!counted) { counted = true; track({ event: 'view_3d' }); } // once a visit
  }
  /** This device cannot draw the box: the photo when there is one, else a note on the stage. */
  function unavailable() {
    on = false;
    controls.hidden = true;
    const choose3d = $('input[name="view3d"][value="3d"]');
    choose3d.disabled = true;
    choose3d.closest('label').title = 'This device cannot show the 3D box';
    if (usableInStudio(latest?.product)) {
      showPhoto();
      say('This device cannot show the 3D box, so the photo mockup is shown.');
    } else {
      note('This device cannot show the 3D box. Your design and files are still sent with your request.');
      say('This device cannot show the 3D box.');
    }
    // the request summary says no picture can be made for a box with no photo
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
  function syncLid() {
    bar.querySelectorAll('[data-lid]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.lid === 'open') === open)));
  }
  /** The text under the controls: what the box is, at what size, and that it is a preview. */
  function about(box) {
    $('#about3d').textContent = `${BOX_STYLES[box.shape].label}, ${box.labels.w} wide, ${box.labels.d} deep, ${box.labels.h} high. A preview of the shape at this size; the final box follows the press's cutting die.`;
  }

  bar.querySelectorAll('input[name="view3d"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) (r.value === '3d' ? show3d : showPhoto)(); }));
  bar.querySelectorAll('input[name="board3d"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    board = r.value;
    const box = boxFor(latest);
    if (on && box) { scene.update(box, latest); built = box.key; say(`Shown on ${r.value === 'white' ? 'white board' : 'brown kraft'}.`); }
  }));
  bar.querySelectorAll('[data-lid]').forEach((b) => b.addEventListener('click', () => {
    open = b.dataset.lid === 'open'; syncLid();
    scene?.lid(open);
    if (open && !lidCounted) { lidCounted = true; track({ event: 'lid_3d' }); }
    say(open ? 'Lid open.' : 'Lid closed.');
  }));
  bar.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => scene?.view(b.dataset.view)));
  $('#sizes3d').addEventListener('change', (e) => scene?.sizes(e.target.checked));

  // every drawing in the studio (product, size, text, logo, ink) reaches the box
  document.addEventListener('studio:drawn', (e) => {
    latest = e.detail;
    const box = boxFor(latest);
    const photo = usableInStudio(latest?.product);
    bar.hidden = !box;
    // nothing to switch between for a box with no photo yet
    $('[data-switch]').hidden = !photo;
    if (photo || !box) note('');
    if (!box) { if (on) showPhoto(); return; }
    $('[data-boards]').hidden = !box.both;
    bar.querySelector(`input[name="board3d"][value="${box.board}"]`).checked = true;
    about(box);
    // a box with no photo yet is only shown in 3D (or its note, where it cannot run)
    if (!photo && failed) { note('This device cannot show the 3D box. Your design and files are still sent with your request.'); return; }
    if (!photo && !on) { show3d(); return; }
    if (!on || !scene) return;
    if (box.key !== built) { open = false; syncLid(); scene.update(box, latest); built = box.key; } else scene.design(latest);
  });
}
