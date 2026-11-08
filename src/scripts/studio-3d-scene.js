// The studio's 3D box (studio-3d.js loads this only when a 3D box is first shown).
// Built from the product's measurements as panels of board on hinges, so the lid
// and flaps open the way the real box does; wearing the studio's own design
// (mockup/engine.js drawArt); lit like a product photo; turned by dragging, the
// arrow keys or preset views. Drawn only on a change, never in a loop at rest.
//
// The shapes are a preview of each folding style (lib/box-styles.js), not the
// press's cutting layout: flap lengths and corners here are typical proportions.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawArt, makeCanvas, defaultDesign } from './mockup/engine.js';
import { BOX_STYLES } from '../../lib/box-styles.js';

const BOARD = { white: '#F2EFE9', kraft: '#BE956A' };
const INSIDE = { white: '#E6E1D8', kraft: '#A8835B' };
const EDGE = { white: '#D9D3C8', kraft: '#9A7650' };
const LINE = '#1F5D72'; // the measurements, in the site's teal
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- board and print ---------------- */

// the board itself, with kraft's fibres, kept per board and face shape so typing
// in the studio only redraws the print, not the fibres under it
const fibres = new Map();
function boardCanvas(board, W, H) {
  const key = `${board}|${W}|${H}`;
  if (fibres.has(key)) return fibres.get(key);
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = BOARD[board]; g.fillRect(0, 0, W, H);
  if (board === 'kraft') {
    let s = 7; // seeded, so the board does not change between redraws
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < W * H / 260; i++) {
      g.strokeStyle = rnd() > 0.5 ? 'rgba(90,60,30,.10)' : 'rgba(255,240,215,.10)';
      const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, l = 3 + rnd() * 9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }
  if (fibres.size > 12) fibres.delete(fibres.keys().next().value);
  fibres.set(key, c);
  return c;
}
const asTexture = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

/** A face of board, `wmm` x `hmm`, printed with the studio's design. */
function printedTexture(board, wmm, hmm, design) {
  const W = 1024, H = Math.max(64, Math.min(2048, Math.round(W * (hmm / wmm))));
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.drawImage(boardCanvas(board, W, H), 0, 0);
  const AW = 1000, AH = Math.max(100, Math.min(4000, Math.round(AW * (hmm / wmm))));
  const B = { art: makeCanvas(AW, AH), AW, AH, safeTop: 0.08 };
  // no dashed "your logo" box on a box: that is a hint on the photo, not print
  try { drawArt(B, { ...defaultDesign(), ...design, placeholder: false }); } catch (e) { /* a logo still loading: plain board */ }
  // without a logo the studio still keeps the logo's place above the text; on a box
  // panel the text is centred instead, as it would be printed
  const ink = B.ink, noLogo = design?.mode !== 'artwork' && !design?.logo;
  const shift = noLogo && ink && ink.y1 > ink.y0 ? (AH / 2 - (ink.y0 + ink.y1) / 2) * (H / AH) : 0;
  // the ink is printed into the board: on kraft it darkens with it, as flexo ink does
  g.globalCompositeOperation = board === 'kraft' && design?.ink !== 'white' ? 'multiply' : 'source-over';
  g.drawImage(B.art, 0, shift, W, H);
  return asTexture(c);
}

/** The materials of one box: plain outside, inside, cut edges, and its printed faces. */
function materials(board) {
  const plainMap = asTexture(boardCanvas(board, 512, 512));
  plainMap.wrapS = plainMap.wrapT = THREE.RepeatWrapping;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0, ...o });
  return {
    plainMap,
    // the plain outside of a panel, its fibres at the same scale on every panel
    outside: (wmm, hmm) => { const m = plainMap.clone(); m.repeat.set(wmm / 160, hmm / 160); m.needsUpdate = true; return std({ map: m }); },
    inside: std({ color: new THREE.Color(INSIDE[board]), roughness: 0.9 }),
    edge: std({ color: new THREE.Color(EDGE[board]), roughness: 0.95 }),
    printed: (wmm, hmm, design) => std({ map: printedTexture(board, wmm, hmm, design) }),
  };
}

// BoxGeometry's faces, in its material order
const PX = 0, NX = 1, PY = 2, NY = 3, PZ = 4, NZ = 5;
/** A panel of board: a thin box with a material per face (the rest are cut edges). */
function panel(sx, sy, sz, faces, M) {
  const mats = Array.from({ length: 6 }, (_, i) => faces[i] || M.edge);
  return new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats);
}
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const hingeAt = (x, y, z, ...children) => { const g = new THREE.Group(); g.position.set(x, y, z); g.add(...children); return g; };

/* ---------------- the folding styles ---------------- */

/**
 * Pizza box style: a tray with double side walls, and a lid hinged at the top of
 * the back wall, with a tuck flap at its front and a dust flap on each side that
 * fold down inside the tray. The design is on the lid.
 */
function mailer({ w, d, h, board }, design, M) {
  const t = THREE.MathUtils.clamp(Math.min(w, d, h) * 0.03, 1.2, 3); // corrugated board
  const group = new THREE.Group();
  group.add(
    at(panel(w, t, d, { [PY]: M.inside, [NY]: M.outside(w, d) }, M), 0, t / 2, 0),
    at(panel(w, h, t, { [PZ]: M.outside(w, h), [NZ]: M.inside }, M), 0, h / 2, d / 2 - t / 2),
    at(panel(w, h, t, { [PZ]: M.inside, [NZ]: M.outside(w, h) }, M), 0, h / 2, -d / 2 + t / 2),
    at(panel(2 * t, h, d - 2 * t, { [PX]: M.outside(d, h), [NX]: M.inside }, M), w / 2 - t, h / 2, 0),
    at(panel(2 * t, h, d - 2 * t, { [PX]: M.inside, [NX]: M.outside(d, h) }, M), -w / 2 + t, h / 2, 0),
  );
  const top = panel(w, t, d, { [PY]: M.printed(w, d, design), [NY]: M.inside }, M);
  const tuckLen = h * 0.85, dustLen = h * 0.75;
  const tuck = hingeAt(0, 0, d - 2.5 * t, at(panel(w - 6 * t, tuckLen, t, { [PZ]: M.inside, [NZ]: M.outside(w, tuckLen) }, M), 0, -tuckLen / 2, 0));
  const dust = [1, -1].map((side) => hingeAt(side * (w / 2 - 3.5 * t), 0, d / 2,
    at(panel(t, dustLen, d * 0.78, { [side > 0 ? NX : PX]: M.inside, [side > 0 ? PX : NX]: M.outside(d, dustLen) }, M), 0, -dustLen / 2, 0)));
  const lid = hingeAt(0, h, -d / 2, at(top, 0, t / 2, d / 2), tuck, ...dust);
  group.add(lid);
  const OPEN = THREE.MathUtils.degToRad(102);
  return {
    group, t,
    // k: 0 closed to 1 open
    set(k) { lid.rotation.x = -k * OPEN; tuck.rotation.x = -k * 0.5; },
    height: (k) => h + t + Math.sin(k * OPEN) * d,
    printedMesh: top, printedFaces: [PY],
  };
}

/**
 * Tuck-end carton: an upright carton with a closed bottom, a top panel hinged at
 * the back with a tuck flap that goes down inside the front, and two dust flaps
 * on the side walls that fold under it. The design is on the front and the back.
 */
function carton({ w, d, h, board }, design, M) {
  const t = THREE.MathUtils.clamp(Math.min(w, d, h) * 0.008, 0.45, 1); // folding boxboard
  const group = new THREE.Group();
  // the same print on the front and the back: drawn once, shared by both panels
  const print = M.printed(w, h, design);
  const front = panel(w, h, t, { [PZ]: print, [NZ]: M.inside }, M);
  const back = panel(w, h, t, { [PZ]: M.inside, [NZ]: print }, M);
  group.add(
    at(front, 0, h / 2, d / 2 - t / 2),
    at(back, 0, h / 2, -d / 2 + t / 2),
    at(panel(t, h, d - 2 * t, { [PX]: M.outside(d, h), [NX]: M.inside }, M), w / 2 - t / 2, h / 2, 0),
    at(panel(t, h, d - 2 * t, { [PX]: M.inside, [NX]: M.outside(d, h) }, M), -w / 2 + t / 2, h / 2, 0),
    at(panel(w - 2 * t, t, d - 2 * t, { [PY]: M.inside, [NY]: M.outside(w, d) }, M), 0, t / 2, 0),
  );
  const tuckLen = Math.min(d * 0.7, h * 0.3), dustLen = Math.min(w * 0.42, d * 0.85);
  const top = at(panel(w, t, d, { [PY]: M.outside(w, d), [NY]: M.inside }, M), 0, t / 2, d / 2);
  const tuck = hingeAt(0, 0, d - 2 * t, at(panel(w - 3 * t, tuckLen, t, { [PZ]: M.inside, [NZ]: M.outside(w, tuckLen) }, M), 0, -tuckLen / 2, 0));
  const lid = hingeAt(0, h, -d / 2, top, tuck);
  // dust flaps: upright when open, folded in flat under the top panel when closed
  const dust = [1, -1].map((side) => hingeAt(side * (w / 2 - t), h - t, 0,
    at(panel(t, dustLen, d - 4 * t, { [side > 0 ? PX : NX]: M.outside(d, dustLen), [side > 0 ? NX : PX]: M.inside }, M), 0, dustLen / 2, 0)));
  group.add(lid, ...dust);
  const OPEN = THREE.MathUtils.degToRad(118);
  return {
    group, t,
    set(k) {
      lid.rotation.x = -k * OPEN;
      tuck.rotation.x = -k * 0.9;
      // the dust flaps rise once the top panel is out of their way
      const k2 = THREE.MathUtils.clamp((k - 0.3) / 0.7, 0, 1);
      dust.forEach((f, i) => { const side = i === 0 ? 1 : -1; f.rotation.z = side * (Math.PI / 2 - k2 * (Math.PI / 2 + 0.18)); });
    },
    height: (k) => h + t + Math.max(0, Math.sin(k * OPEN)) * d,
    printedMesh: [front, back], printedFaces: [PZ, NZ],
  };
}

const STYLES = { mailer, carton };

/** A soft round shadow under the box, as on a studio table. */
function contactShadow(w, d) {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(40,28,12,.42)'); grd.addColorStop(0.55, 'rgba(40,28,12,.16)'); grd.addColorStop(1, 'rgba(40,28,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.7, d * 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.2;
  return m;
}

/* ---------------- the measurements ---------------- */

/** A label that always faces the camera, the same size on screen at any zoom (sized in labelSize): the measurement as the team entered it. */
function label(text) {
  const c = makeCanvas(256, 96), g = c.getContext('2d');
  g.font = '600 46px "Inter", system-ui, sans-serif';
  const tw = Math.min(236, g.measureText(text).width + 36);
  const x = (256 - tw) / 2;
  g.fillStyle = 'rgba(255,255,255,.92)';
  if (g.roundRect) { g.beginPath(); g.roundRect(x, 14, tw, 68, 34); g.fill(); } else g.fillRect(x, 14, tw, 68);
  g.fillStyle = LINE; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 49);
  const map = asTexture(c);
  // hidden behind the box like the line it names, so a label never sits on the print
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, sizeAttenuation: false }));
  s.renderOrder = 10;
  return s;
}

/** Width along the front, depth along the left side (the side the first view shows), height up the front right corner. */
function measurements({ w, d, h, labels }) {
  const S = Math.max(w, d, h), off = S * 0.08, y0 = 0.6;
  const pts = [];
  const seg = (a, b) => pts.push(...a, ...b);
  // width: the line in front, with its two extension lines from the box's corners
  seg([-w / 2, y0, d / 2 + off], [w / 2, y0, d / 2 + off]);
  seg([-w / 2, y0, d / 2 + off * 0.2], [-w / 2, y0, d / 2 + off * 1.3]);
  seg([w / 2, y0, d / 2 + off * 0.2], [w / 2, y0, d / 2 + off * 1.3]);
  // depth: along the left side
  seg([-w / 2 - off, y0, -d / 2], [-w / 2 - off, y0, d / 2]);
  seg([-w / 2 - off * 0.2, y0, -d / 2], [-w / 2 - off * 1.3, y0, -d / 2]);
  seg([-w / 2 - off * 0.2, y0, d / 2], [-w / 2 - off * 1.3, y0, d / 2]);
  // height: up the front right corner, out from the box
  const cx = w / 2 + off * 0.75, cz = d / 2 + off * 0.75;
  seg([cx, 0, cz], [cx, h, cz]);
  seg([w / 2 + off * 0.15, h, d / 2 + off * 0.15], [cx + off * 0.35, h, cz + off * 0.35]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const group = new THREE.Group();
  // the lines hide behind the box but never cover their own labels
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: LINE, depthWrite: false })));
  group.add(at(label(labels.w), 0, y0, d / 2 + off));
  group.add(at(label(labels.d), -w / 2 - off, y0, 0));
  group.add(at(label(labels.h), cx + off * 0.6, h / 2, cz));
  return { group, off };
}

/* ---------------- the scene ---------------- */

export function createScene(frame) {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-3d';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  // throws where WebGL cannot start; the canvas joins the page only once it has
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  frame.append(canvas);
  const ratio = () => Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(ratio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps brand colours true
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  // a studio backdrop a shade darker than white board, so a white box stands out from it
  scene.background = new THREE.Color('#DCD7CE');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55; // soft fill all round
  // the key light from the upper left: the panels shade differently, as in a photo
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-500, 700, 450);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced();
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.49; // never under the table

  let box = null, model = null, marks = null, shadow = null, M = null, latest = null;
  let visible = false, raf = 0, k = 0, showSizes = true;

  function fit() {
    const r = frame.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(0.2, r.width / Math.max(1, r.height));
    camera.updateProjectionMatrix();
    labelSize();
  }
  /** The labels' text about 12 CSS pixels high (the label picture is 26) whatever the frame and zoom; a sprite without size attenuation is sized against the view's height. */
  function labelSize() {
    if (!marks) return;
    const fh = Math.max(1, frame.getBoundingClientRect().height);
    const sy = (2 * 26 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / fh;
    marks.group.children.forEach((c) => { if (c.isSprite) c.scale.set(sy * (256 / 96), sy, 1); });
  }
  const targetFor = (kk) => new THREE.Vector3(0, model.height(kk) / 2, 0);
  const probe = new THREE.PerspectiveCamera();
  const corner = new THREE.Vector3();
  /**
   * The camera distance that fills the frame with the box (and its measurements),
   * lid at `kk`, seen from direction `dir` (the camera's own by default): the box's
   * corners are projected and the distance adjusted until the widest one sits just
   * inside the edge. A flat pizza box then fills a wide frame instead of floating
   * small in the middle of a sphere drawn round it.
   */
  function fitFor(kk, dir) {
    dir = (dir || camera.position.clone().sub(controls.target)).clone().normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.5, 0.4, 0.75).normalize();
    // the measurement lines reach about an eighth of the box's largest side beyond it
    const pad = showSizes && marks ? Math.max(box.w, box.d, box.h) * 0.13 : 0;
    const hx = box.w / 2 + pad, hz = box.d / 2 + pad, top = model.height(kk);
    const tgt = targetFor(kk);
    probe.fov = camera.fov; probe.aspect = camera.aspect; probe.near = camera.near; probe.far = camera.far;
    probe.updateProjectionMatrix();
    let dist = Math.hypot(hx * 2, top, hz * 2) * 2;
    for (let i = 0; i < 5; i++) {
      probe.position.copy(tgt).addScaledVector(dir, dist); probe.lookAt(tgt); probe.updateMatrixWorld();
      let m = 0;
      for (const x of [-hx, hx]) for (const y of [0, top]) for (const z of [-hz, hz]) {
        corner.set(x, y, z).project(probe);
        m = Math.max(m, Math.abs(corner.x), Math.abs(corner.y));
      }
      dist *= m / 0.84; // a margin for the labels, which are sized on screen
    }
    return dist;
  }
  function frameNow(dir) {
    const dist = fitFor(k, dir);
    controls.minDistance = dist * 0.5; controls.maxDistance = dist * 2.5;
    return dist;
  }
  new ResizeObserver(() => {
    fit();
    if (model) { const dist = frameNow(); camera.position.sub(controls.target).setLength(dist).add(controls.target); controls.update(); }
    draw();
  }).observe(frame);

  function dispose(obj) {
    obj?.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
    });
  }
  function build() {
    for (const o of [model?.group, marks?.group, shadow]) if (o) { scene.remove(o); dispose(o); }
    M?.plainMap.dispose();
    M = materials(box.board);
    model = STYLES[box.shape](box, latest?.state, M);
    marks = measurements(box);
    marks.group.visible = showSizes;
    labelSize();
    shadow = contactShadow(box.w, box.d);
    scene.add(model.group, marks.group, shadow);
    model.set(k);
    controls.target.copy(targetFor(k));
    describe();
  }
  /** Only the print changed (text, logo, ink): one new print for every printed face, same box. */
  function reprint() {
    if (!model) return;
    const [wmm, hmm] = box.shape === 'mailer' ? [box.w, box.d] : [box.w, box.h];
    const print = M.printed(wmm, hmm, latest?.state);
    const old = new Set();
    [].concat(model.printedMesh).forEach((mesh, i) => {
      const face = model.printedFaces[i];
      old.add(mesh.material[face]);
      mesh.material[face] = print;
    });
    old.forEach((m) => { m.map?.dispose(); m.dispose(); });
    describe();
  }
  function describe() {
    const text = latest?.state?.mode === 'artwork' ? 'your artwork' : (latest?.state?.text1 || 'your brand');
    canvas.setAttribute('aria-label', `${BOX_STYLES[box.shape].label}, ${box.labels.w} wide, ${box.labels.d} deep and ${box.labels.h} high, ${box.board === 'kraft' ? 'brown kraft' : 'white board'}, printed with ${text}, lid ${k > 0.5 ? 'open' : 'closed'}. Arrow keys turn it.`);
  }

  // where the camera sits for each preset view: angle around the box, and height above it
  const VIEWS = { front: [0, 0.12], side: [Math.PI / 2, 0.12], back: [Math.PI, 0.12], top: [0.35, 1.25], start: [-0.6, 0.38] };
  function place(view, instant = false) {
    const [az, el] = VIEWS[view] || VIEWS.start;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const r = frameNow(dir);
    const to = dir.clone().multiplyScalar(r).add(controls.target);
    if (instant || reduced()) { camera.position.copy(to); controls.update(); draw(); return; }
    const from = camera.position.clone(), t0 = performance.now(), dur = 600;
    const step = (now) => {
      const e = 1 - Math.pow(1 - Math.min(1, (now - t0) / dur), 3);
      camera.position.lerpVectors(from, to, e);
      camera.position.sub(controls.target).setLength(r).add(controls.target); // keep the distance while swinging round
      controls.update(); draw();
      if (e < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Open or close the lid; the camera eases back as the box grows, keeping any zoom the visitor chose. */
  let lidRun = 0;
  function lid(open) {
    if (!model) return;
    const to = open ? 1 : 0, from = k;
    const run = ++lidRun;
    const zoom = camera.position.distanceTo(controls.target) / fitFor(k);
    const apply = (kk) => {
      k = kk; model.set(k);
      const off = camera.position.clone().sub(controls.target);
      controls.target.copy(targetFor(k));
      camera.position.copy(controls.target).add(off.setLength(fitFor(k) * zoom));
      controls.update(); draw();
    };
    if (reduced()) { apply(to); frameNow(); describe(); return; }
    const t0 = performance.now(), dur = 700;
    const step = (now) => {
      if (run !== lidRun) return;
      const p = Math.min(1, (now - t0) / dur), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      apply(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else { frameNow(); describe(); }
    };
    requestAnimationFrame(step);
  }

  // drawn on demand: a change, a drag, or the damping that follows one
  function draw() { if (visible) renderer.render(scene, camera); }
  controls.addEventListener('change', draw);
  function loop() { controls.update(); raf = visible ? requestAnimationFrame(loop) : 0; }
  canvas.addEventListener('pointerdown', () => { if (!raf && controls.enableDamping) loop(); });
  canvas.addEventListener('pointerup', () => { setTimeout(() => { cancelAnimationFrame(raf); raf = 0; }, 800); });

  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    sph.theta += step[0] * (Math.PI / 12);
    sph.phi = THREE.MathUtils.clamp(sph.phi + step[1] * (Math.PI / 24), 0.15, Math.PI * 0.49);
    camera.position.setFromSpherical(sph).add(controls.target);
    controls.update(); draw();
  });

  return {
    /** Show a box ({ shape, board, w, d, h in mm, labels }) closed, from the starting view. */
    show(b, l) {
      box = b; latest = l || latest; visible = true; k = 0; lidRun++;
      canvas.hidden = false;
      fit(); build(); place('start', true);
    },
    hide() { visible = false; canvas.hidden = true; cancelAnimationFrame(raf); raf = 0; },
    /** Another product, size or board: rebuilt closed, from the starting view if the style changed. */
    update(b, l) {
      const restyle = !box || b.shape !== box.shape;
      box = b; latest = l || latest; k = 0; lidRun++;
      build();
      if (restyle) place('start', true); else { const dist = frameNow(); camera.position.sub(controls.target).setLength(dist).add(controls.target); controls.update(); draw(); }
    },
    design(l) { latest = l; if (visible && model) { reprint(); draw(); } },
    lid,
    view(name) { place(name); },
    sizes(on) { showSizes = on; if (marks) marks.group.visible = on; frameNow(); draw(); },
    /** The box as it is turned now, as a PNG about 1,600 pixels wide. */
    snapshot() {
      return new Promise((resolve) => {
        if (!visible) return resolve(null);
        const r = frame.getBoundingClientRect();
        renderer.setPixelRatio(Math.min(4, 1600 / Math.max(1, r.width)));
        fit();
        renderer.render(scene, camera);
        // read straight after drawing, while the picture is still in the canvas
        canvas.toBlob((blob) => { renderer.setPixelRatio(ratio()); fit(); draw(); resolve(blob); }, 'image/png');
      });
    },
  };
}
