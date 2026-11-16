// The packaging line-up in 3D: the products standing on the home page's packaging
// panel and along the bottom of the packaging page's first screen. Each one is
// folded from its dieline (lib/package-shapes.js) by the same code as the 3D view
// (scene.js) and printed with Olira's logo (home page) or the visitor's brand
// (packaging page). One WebGL renderer draws every product, each into its own
// canvas. A box opens its lid while the pointer is over it (a tap opens and closes
// it); a bag or pouch turns a little. Reduced motion: it changes without moving.
//
// The page first shows still renders of the same products (PackLineup.astro),
// made by this same file (scripts/render-lineup.mjs), so the live 3D replaces them
// without a jump. The line-up is the company's own showcase, like the photos it
// replaced: it is not behind the two 3D switches, which govern the 3D view of
// each product at its measured sizes.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { dieline } from '../../../lib/package-shapes.js';
import { BOX_STYLES } from '../../../lib/box-styles.js';
import { buildPackage } from './scene.js';

const AZ = 30 * Math.PI / 180;   // seen from the front, a little from the left
const TURN = -26 * Math.PI / 180; // how far a bag or pouch turns
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A soft shadow under the package, fading out before its own edge. */
function shadowOf(w, d) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, 'rgba(40,28,12,.40)'); grd.addColorStop(0.5, 'rgba(40,28,12,.18)'); grd.addColorStop(1, 'rgba(40,28,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.3, d * 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.3;
  return m;
}

/** Throws where WebGL cannot start. */
export function createLineup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-500, 700, 450);
  scene.add(key);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  const items = new Map();
  const v = new THREE.Vector3();

  /** Add a product: { id, style, board, cm: [w, d, h], tilt (degrees), h (its height in the row) }. */
  function add(spec) {
    const def = BOX_STYLES[spec.style];
    const [w, d, h] = spec.cm.map((x) => Number(x) * 10);
    const model = dieline(def.template, { L: w, W: def.flat ? 0 : d, H: h });
    const pkg = buildPackage(model, { board: spec.board, handles: def.handles || null });
    const pivot = new THREE.Group();
    pivot.add(pkg.holder);
    const closed = pkg.pose(1, 0);
    const rest = pkg.holder.position.clone();
    const boxes = [closed];
    if (model.hasLid) {
      const open = pkg.pose(1, 1), shift = rest.clone().sub(pkg.holder.position);
      boxes.push({ min: open.min.clone().add(shift), max: open.max.clone().add(shift) });
      pkg.pose(1, 0); pkg.holder.position.copy(rest);
    }
    const shadow = shadowOf(closed.max.x - closed.min.x, closed.max.z - closed.min.z);
    pivot.add(shadow);
    pivot.visible = false;
    scene.add(pivot);

    // the frame: everything the product shows, closed and open (or turned), and its shadow
    const el = Number(spec.tilt || 18) * Math.PI / 180;
    const dir = new THREE.Vector3(-Math.sin(AZ) * Math.cos(el), Math.sin(el), Math.cos(AZ) * Math.cos(el));
    camera.position.copy(dir).multiplyScalar(5000); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse.clone();
    const turns = model.hasLid ? [0] : [0, TURN / 2, TURN];
    const span = (list, yTop) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const b of list) for (const a of turns) for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) for (const y of [0, yTop ?? b.max.y]) {
        v.set(x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)).applyMatrix4(view);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1 };
    };
    const all = span(boxes);
    const sw = (closed.max.x - closed.min.x) * 0.65, sd = (closed.max.z - closed.min.z) * 0.65;
    const sh = span([{ min: { x: -sw, z: -sd }, max: { x: sw, z: sd } }], 0);
    const floor = span([closed], 0).y0; // the front corner of the base
    const pad = (all.y1 - all.y0) * 0.05;
    const f = { l: Math.min(all.x0, sh.x0) - pad, r: Math.max(all.x1, sh.x1) + pad, b: Math.min(floor, sh.y0) - pad * 0.4, t: all.y1 + pad };
    // the row is laid out by the closed product (its "core"); the picture is larger
    // than that, so an open lid, a turn or the shadow reach past it without moving it
    const core = span([closed]), cw = core.x1 - core.x0, ch = core.y1 - floor;
    const item = {
      spec, model, pkg, pivot, rest, view, dir, frame: f,
      ratio: cw / ch,
      units: Number(spec.h || 50) * cw / ch,
      box: { l: (f.l - core.x0) / cw, t: (core.y1 - f.t) / ch, w: (f.r - f.l) / cw, h: (f.t - f.b) / ch },
      o: 0, turn: 0, run: 0,
      main: def.main?.[0] || null,
    };
    items.set(spec.id, item);
    return { ratio: item.ratio, units: item.units, box: item.box };
  }

  /** Print on every product: { logo } (a loaded picture) or { logoText }. */
  function paint(look, ids = [...items.keys()]) {
    for (const id of ids) {
      const it = items.get(id);
      if (it) it.pkg.paint({ mode: 'logo', logoScale: 0.62, multiply: true, ...look, logoFace: it.main });
    }
  }

  function pose(it) {
    it.pkg.pose(1, it.o);
    it.pkg.holder.position.copy(it.rest);
    it.pivot.rotation.y = it.turn;
    it.pivot.updateMatrixWorld(true);
  }

  /** Draw one product into `target` (a 2D canvas), at the target's own size. */
  function draw(id, target) {
    const it = items.get(id);
    if (!it || !target.width || !target.height) return;
    for (const x of items.values()) x.pivot.visible = x === it;
    pose(it);
    camera.position.copy(it.dir).multiplyScalar(5000); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
    Object.assign(camera, { left: it.frame.l, right: it.frame.r, bottom: it.frame.b, top: it.frame.t });
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const size = renderer.getSize(v);
    if (size.x !== target.width || size.y !== target.height) renderer.setSize(target.width, target.height, false);
    renderer.render(scene, camera);
    const g = target.getContext('2d');
    g.clearRect(0, 0, target.width, target.height);
    g.drawImage(renderer.domElement, 0, 0);
  }

  /** Open (or turn) a product, or back: redrawn into `target` on every frame. */
  function move(id, on, target) {
    const it = items.get(id);
    if (!it) return;
    const lid = it.model.hasLid;
    const from = lid ? it.o : it.turn, to = on ? (lid ? 1 : TURN) : 0;
    const set = (x) => { if (lid) it.o = x; else it.turn = x; draw(id, target); };
    const run = ++it.run;
    if (reduced() || from === to) { set(to); return; }
    const dur = (lid ? (on ? 700 : 520) : 560) * Math.abs(to - from) / (lid ? 1 : Math.abs(TURN));
    const t0 = performance.now();
    const step = (now) => {
      if (run !== it.run) return;
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      set(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return {
    add, paint, draw, move,
    has: (id) => items.has(id),
    box: (id) => items.get(id)?.box,
    hasLid: (id) => !!items.get(id)?.model.hasLid,
    dispose() { for (const it of items.values()) it.pkg.dispose(); scene.environment?.dispose(); pmrem.dispose(); renderer.dispose(); },
  };
}

/* ---------------- on the page ---------------- */

const BRAND_KEY = 'olira-brand';
const brandText = () => { try { return (localStorage.getItem(BRAND_KEY) || '').trim().slice(0, 18); } catch (e) { return ''; } };

function loadImage(src) {
  return new Promise((resolve) => { const img = new Image(); img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
}
async function oliraLogo() {
  const b = await fetch('/api/branding').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return (b?.logo && await loadImage(b.logo)) || loadImage('/logo.png');
}

/** Bring every line-up on the page to life (lineup.js loads this when it is wanted). */
export async function mount(lineups) {
  let L;
  try { L = createLineup(); } catch (e) { return; } // no WebGL: the still renders stay
  const logo = lineups.some((el) => el.dataset.brand === 'olira') ? await oliraLogo() : null;
  const touch = matchMedia('(hover: none)').matches;
  for (const el of lineups) {
    const own = el.dataset.brand === 'olira';
    const look = () => (own ? { logo } : { logo: null, logoText: brandText() || 'YOUR BRAND' });
    const cells = [];
    for (const item of el.querySelectorAll('.item[data-style]')) {
      const id = item.dataset.id;
      if (!L.has(id)) L.add({ id, style: item.dataset.style, board: item.dataset.board, cm: item.dataset.cm.split(','), tilt: item.dataset.tilt, h: item.dataset.h });
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      item.append(canvas);
      cells.push({ id, item, canvas });
    }
    const size = (c) => {
      const r = c.item.getBoundingClientRect(), k = Math.min(devicePixelRatio || 1, 2), bx = L.box(c.id);
      c.canvas.width = Math.max(1, Math.round(r.width * bx.w * k)); c.canvas.height = Math.max(1, Math.round(r.height * bx.h * k));
    };
    L.paint(look(), cells.map((c) => c.id));
    for (const c of cells) { size(c); L.draw(c.id, c.canvas); }
    requestAnimationFrame(() => { for (const c of cells) c.item.classList.add('is-live'); });

    for (const c of cells) {
      let on = false;
      const set = (v) => { if (v === on) return; on = v; L.move(c.id, on, c.canvas); };
      c.item.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') set(true); });
      c.item.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') set(false); });
      c.item.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch' || touch) set(!on); });
    }
    new ResizeObserver(() => { for (const c of cells) { size(c); L.draw(c.id, c.canvas); } }).observe(el);
    if (!own) {
      let timer = 0;
      const repaint = () => { clearTimeout(timer); timer = setTimeout(() => { L.paint(look(), cells.map((c) => c.id)); for (const c of cells) L.draw(c.id, c.canvas); }, 120); };
      for (const input of document.querySelectorAll('input[data-brand-input]')) input.addEventListener('input', repaint);
    }
  }
}
