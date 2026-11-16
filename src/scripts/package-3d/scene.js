// The 3D package (box packaging-3d). The product's dieline (lib/package-shapes.js) is
// built at the product's own measurements and folded panel by panel, so the same
// package closes, opens its lid and lays flat with its cut and crease lines. Every
// panel's texture is its own place on one print sheet, as the printer prints it: a
// logo, one artwork over the whole package, artwork on chosen faces, or the mockup
// studio's design are all ways of painting that one sheet.
//
// Lit like a product photo, turned by dragging, the arrow keys or preset views, and
// drawn only on a change, never in a loop at rest. Loaded only when a package is first
// shown (the studio, a product page, the staff preview), so three.js costs nothing before.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { dieline, centroid, panelMatrices } from '../../../lib/package-shapes.js';
import { BOX_STYLES } from '../../../lib/box-styles.js';

const BOARD = {
  kraft: { out: '#C29A6B', in: '#B08659', rough: 0.88, metal: 0, name: 'brown kraft' },
  white: { out: '#F4F1EA', in: '#E4DED2', rough: 0.84, metal: 0, name: 'white board' },
  foil: { out: '#CDD1D6', in: '#B9BDC2', rough: 0.32, metal: 0.85, name: 'foil' },
};
const CUT = '#D6332A', CREASE = '#1F5D72', TEAL = '#186078';
const LINE = '#1F5D72'; // the measurements, in the site's teal
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const asTexture = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

/** The sample artwork shown before a visitor adds their own: plainly a placeholder. */
export function sampleArt() {
  const c = makeCanvas(1200, 800), x = c.getContext('2d');
  x.fillStyle = TEAL; x.fillRect(0, 0, 1200, 800);
  x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 34;
  for (let i = -800; i < 2000; i += 90) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 800, 800); x.stroke(); }
  x.fillStyle = '#F2C14E'; x.beginPath(); x.arc(860, 300, 150, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = '700 120px Inter, system-ui, sans-serif'; x.fillText('YOUR', 90, 360); x.fillText('ARTWORK', 90, 500);
  return c;
}

/* ---------------- the board, painted once per size ---------------- */

const bases = new Map();
function boardBase(material, W, H) {
  const key = `${material}|${W}|${H}`;
  if (bases.has(key)) return bases.get(key);
  const c = makeCanvas(W, H), g = c.getContext('2d'), look = BOARD[material] || BOARD.kraft;
  g.fillStyle = look.out; g.fillRect(0, 0, W, H);
  if (material === 'kraft') { // fibres, seeded so the board does not change between paints
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < W * H / 90; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '90,60,30' : '255,240,210'},${0.05 + rnd() * 0.07})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1); }
  }
  if (material === 'foil') { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#E9ECEF'); gr.addColorStop(0.5, '#B9BEC4'); gr.addColorStop(1, '#E2E5E8'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  if (bases.size > 6) bases.delete(bases.keys().next().value);
  bases.set(key, c);
  return c;
}

/* ---------------- the package: one body per panel, placed by its fold ---------------- */

export function buildPackage(model, { board, handles }) {
  const { sheet } = model;
  const s = Math.min(4, 2048 / Math.max(sheet.w, sheet.h)); // canvas pixels per mm
  const canvas = makeCanvas(sheet.w * s, sheet.h * s);
  const ctx = canvas.getContext('2d');
  const texture = asTexture(canvas);
  const look = BOARD[board] || BOARD.kraft;
  const outside = new THREE.MeshStandardMaterial({ map: texture, roughness: look.rough, metalness: look.metal, side: THREE.FrontSide });
  const inside = new THREE.MeshStandardMaterial({ color: look.in, roughness: 0.95, side: THREE.BackSide });
  const holder = new THREE.Group(), turn = new THREE.Group();
  holder.add(turn);
  const nodes = new Map();
  const uvOf = (x, y) => [(x - sheet.minX) / sheet.w, (y - sheet.minY) / sheet.h];

  function geometryOf(p) {
    if (p.bulge) {
      // a film face: a grid that can swell between its sealed edges
      const [x0, y0] = p.poly[0], [x1, y1] = p.poly[2];
      const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 28, 40);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) { const [u, v] = uvOf(pos.getX(i), pos.getY(i)); uv.setXY(i, u, v); }
      g.userData.base = Float32Array.from(pos.array);
      g.userData.box = [x0, y0, x1, y1];
      return g;
    }
    const g = new THREE.ShapeGeometry(new THREE.Shape(p.poly.map(([x, y]) => new THREE.Vector2(x, y))));
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) { const [u, v] = uvOf(pos.getX(i), pos.getY(i)); uv.setXY(i, u, v); }
    return g;
  }
  const cutMat = new THREE.LineBasicMaterial({ color: CUT });
  const creaseMat = new THREE.LineDashedMaterial({ color: CREASE, dashSize: 3, gapSize: 2 });
  // the flat sheet's lines are the dieline's own (lib/package-shapes.js): what the tests check
  // is what is drawn. Laid flat, every panel is in the sheet, so one set of lines serves all.
  const flatLines = new THREE.Group();
  for (const [list, mat] of [[model.cut, cutMat], [model.crease, creaseMat]]) {
    if (!list.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap(([x1, y1, x2, y2]) => [x1, y1, 0.6, x2, y2, 0.6]), 3));
    const l = new THREE.LineSegments(g, mat); l.computeLineDistances(); flatLines.add(l);
  }
  flatLines.visible = false;
  turn.add(flatLines);
  const overlayMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });

  for (const p of model.panels) {
    const geo = geometryOf(p);
    const body = new THREE.Group();
    body.matrixAutoUpdate = false;
    const front = new THREE.Mesh(geo, outside), back = new THREE.Mesh(geo, inside);
    front.userData.panel = back.userData.panel = p.id;
    const overlay = new THREE.Mesh(geo, overlayMat); overlay.visible = false; overlay.renderOrder = 2;
    body.add(front, back, overlay);
    turn.add(body);
    nodes.set(p.id, { p, body, geo, front, overlay });
  }

  // bag handles: inside the top edge of the front and the back, shown once the bag is closed
  const decor = [];
  if (handles) {
    for (const node of [nodes.get('front'), nodes.get('back')].filter(Boolean)) {
      const [x0] = node.p.poly[0], [x1, top] = node.p.poly[2];
      const w = x1 - x0, rise = Math.min(w * 0.42, 120);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0 + w * 0.3, top - 25, -1.5), new THREE.Vector3(x0 + w * 0.28, top + rise * 0.6, -1.5),
        new THREE.Vector3(x0 + w * 0.5, top + rise, -1.5), new THREE.Vector3(x0 + w * 0.72, top + rise * 0.6, -1.5), new THREE.Vector3(x0 + w * 0.7, top - 25, -1.5),
      ]);
      const twisted = handles === 'twisted';
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, twisted ? 2.6 : 5, twisted ? 10 : 2, false), new THREE.MeshStandardMaterial({ color: look.in, roughness: 0.9 }));
      if (!twisted) tube.scale.z = 0.25;
      node.body.add(tube);
      decor.push(tube);
    }
  }

  const bbox = new THREE.Box3();
  /** Fold to progress k (0 flat, 1 closed) with the lid open by share o, standing on the table, centred. */
  function pose(k, o) {
    const mats = panelMatrices(model, k, o, THREE);
    for (const node of nodes.values()) node.body.matrix.copy(mats[node.p.id]);
    flatLines.visible = k < 0.02;
    for (const node of nodes.values()) {
      if (!node.p.bulge) continue;
      const pos = node.geo.attributes.position, base = node.geo.userData.base, [x0, y0, x1, y1] = node.geo.userData.box;
      const seal = node.p.seal, amt = node.p.bulge * Math.min(1, k * 1.15), [pu, pv] = node.p.bulgePow || [0.7, 0.45];
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const u = Math.min(Math.max((x - x0 - seal) / (x1 - x0 - 2 * seal), 0), 1), v = Math.min(Math.max((y - y0 - seal) / (y1 - y0 - 2 * seal), 0), 1);
        pos.setZ(i, amt * Math.sin(Math.PI * u) ** pu * Math.sin(Math.PI * v) ** pv);
      }
      pos.needsUpdate = true; node.geo.computeVertexNormals(); node.geo.computeBoundingBox();
    }
    for (const d of decor) d.visible = k > 0.97;
    holder.position.set(0, 0, 0);
    holder.updateMatrixWorld(true);
    bbox.makeEmpty();
    for (const node of nodes.values()) bbox.expandByObject(node.front);
    for (const d of decor) if (d.visible) bbox.expandByObject(d);
    const c = bbox.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -bbox.min.y, -c.z);
    holder.updateMatrixWorld(true);
    return { min: new THREE.Vector3(bbox.min.x - c.x, 0, bbox.min.z - c.z), max: new THREE.Vector3(bbox.max.x - c.x, bbox.max.y - bbox.min.y, bbox.max.z - c.z) };
  }

  /* painting the print sheet */
  const toPx = (x, y) => [(x - sheet.minX) * s, (sheet.maxY - y) * s];
  const pathOf = (poly) => { ctx.beginPath(); poly.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); };
  const rectOf = (poly) => { const pts = poly.map(([x, y]) => toPx(x, y)); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  /** A face's size in pixels as it reads upright (its print turned by `up`). */
  const upright = (p) => { const b = rectOf(p.poly), side = Math.abs(p.up) % 180 === 90; return { b, fw: side ? b.h : b.w, fh: side ? b.w : b.h }; };
  function drawCover(img, cx, cy, w, h, upDeg) {
    const side = Math.abs(upDeg) % 180 === 90;
    const bw = side ? h : w, bh = side ? w : h;
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw || !ih) return;
    const k = Math.max(bw / iw, bh / ih);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-upDeg * Math.PI / 180);
    ctx.drawImage(img, -iw * k / 2, -ih * k / 2, iw * k, ih * k); ctx.restore();
  }
  // where the logo was last drawn on the sheet (pixels), so it can be found and moved by hand
  let logoBox = null;
  /** The logo (a picture, or the brand in words) on face p. `at` moves it from the middle of the face: shares of the face's width and height, x to the right and y up. */
  function drawLogo(logo, text, p, scale, ink, at) {
    const { fw, fh } = upright(p), [cxm, cym] = centroid(p.poly), [cx, cy] = toPx(cxm, cym);
    const a = -p.up * Math.PI / 180;
    const iw = logo && (logo.width || logo.naturalWidth), ih = logo && (logo.height || logo.naturalHeight);
    let lw = 0, lh = 0, words = '';
    if (iw && ih) { const k = Math.min(fw * scale / iw, fh * scale / ih); lw = iw * k; lh = ih * k; } else {
      words = String(text || 'YOUR BRAND').slice(0, 40);
      let size = fh * 0.22 * scale * 1.6;
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(words).width;
      if (tw > fw * scale) { size *= (fw * scale) / tw; ctx.font = `700 ${size}px Inter, system-ui, sans-serif`; }
      lw = Math.min(tw, fw * scale); lh = size;
    }
    // kept on the face: it can go as far as its own edge reaching the face's edge
    const mx = Math.max(0, (fw - lw) / 2) / fw, my = Math.max(0, (fh - lh) / 2) / fh;
    const x = Math.min(mx, Math.max(-mx, Number(at?.x) || 0)), y = Math.min(my, Math.max(-my, Number(at?.y) || 0));
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.translate(x * fw, -y * fh);
    if (iw && ih) ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
    else { ctx.fillStyle = ink || (board === 'foil' ? '#0F3E4F' : TEAL); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(words, 0, 0); }
    ctx.restore();
    const ox = x * fw, oy = -y * fh;
    logoBox = { id: p.id, x: cx + ox * Math.cos(a) - oy * Math.sin(a), y: cy + ox * Math.sin(a) + oy * Math.cos(a), r: Math.max(lw, lh) / 2, cx, cy, a, fw, fh, at: { x, y } };
  }
  /** The studio's design on a face: drawn for the face's own proportions, then set upright on it. */
  function drawDesign(draw, p) {
    const { b, fw, fh } = upright(p);
    let art = null;
    try { art = draw(fw / s, fh / s); } catch (e) { art = null; } // a logo still loading: plain board
    if (!art) return;
    ctx.save(); pathOf(p.poly); ctx.clip();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.rotate(-p.up * Math.PI / 180);
    ctx.drawImage(art, -fw / 2, -fh / 2, fw, fh); ctx.restore();
  }
  const faces = model.panels.filter((p) => p.printable && p.role === 'face');
  /**
   * Paint the sheet. look.mode: 'logo' (look.logo picture or look.logoText, on look.logoFace),
   * 'wrap' (look.art over the whole sheet), 'faces' (look.art on look.faces), or 'design'
   * (look.draw(wmm, hmm) gives the picture for each of look.main's faces). look.multiply
   * prints the ink into kraft, darker with the board, as flexo ink does.
   */
  function paint(look) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(boardBase(board, canvas.width, canvas.height), 0, 0);
    logoBox = null;
    const mode = look?.mode || 'logo';
    const multiply = look?.multiply && board === 'kraft';
    if (mode === 'wrap' && look.art) drawCover(look.art, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height, 0);
    else if (mode === 'faces' && look.art) {
      for (const p of faces.filter((q) => (look.faces || []).includes(q.id))) {
        const b = rectOf(p.poly);
        ctx.save(); pathOf(p.poly); ctx.clip(); drawCover(look.art, b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, p.up); ctx.restore();
      }
    } else if (mode === 'design' && typeof look.draw === 'function') {
      if (multiply) ctx.globalCompositeOperation = 'multiply';
      for (const p of faces.filter((q) => (look.main || []).includes(q.id))) drawDesign(look.draw, p);
    } else if (mode === 'logo') {
      if (multiply) ctx.globalCompositeOperation = 'multiply';
      const p = faces.find((q) => q.id === look.logoFace) || faces[0];
      if (p) drawLogo(look.logo, look.logoText, p, look.logoScale || 0.6, look.ink, look.logoAt);
    }
    ctx.globalCompositeOperation = 'source-over';
    texture.needsUpdate = true;
  }

  // a face is tinted when it is chosen for print, or under the mouse where a click would act on it
  let chosen = [], hovered = null;
  const tint = () => { for (const n of nodes.values()) n.overlay.visible = chosen.includes(n.p.id) || n.p.id === hovered; };
  function select(ids) { chosen = ids; tint(); }
  /** The face under the mouse (or none). True when that changed. */
  function hover(id) { if (id === hovered) return false; hovered = id; tint(); return true; }
  return {
    holder, pose, paint, select, hover, faces: faces.map((p) => ({ id: p.id, name: p.name })),
    /** Where the logo is on the sheet now, or null when none is drawn. */
    logoBox: () => logoBox,
    /** A point on the sheet (pixels) as a place for the logo on its face. */
    logoAt(px, py) { if (!logoBox) return null; const dx = px - logoBox.cx, dy = py - logoBox.cy, c = Math.cos(-logoBox.a), sn = Math.sin(-logoBox.a); return { x: (dx * c - dy * sn) / logoBox.fw, y: -(dx * sn + dy * c) / logoBox.fh }; },
    /** A point of a face's texture as sheet pixels. */
    sheetPx: (uv) => [uv.x * canvas.width, (1 - uv.y) * canvas.height],
    pickables: [...nodes.values()].map((n) => n.front),
    dispose() {
      for (const n of nodes.values()) n.geo.dispose();
      flatLines.traverse((o) => o.geometry?.dispose());
      for (const d of decor) { d.geometry.dispose(); d.material.dispose(); }
      texture.dispose(); outside.dispose(); inside.dispose(); overlayMat.dispose(); cutMat.dispose(); creaseMat.dispose();
    },
  };
}

/* ---------------- the measurements and the table ---------------- */

/** A soft round shadow under the package, as on a studio table. */
function contactShadow(w, d) {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(40,28,12,.42)'); grd.addColorStop(0.55, 'rgba(40,28,12,.16)'); grd.addColorStop(1, 'rgba(40,28,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 30) * 1.7, Math.max(d, 30) * 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.2;
  return m;
}

/** A label that always faces the camera, the same size on screen at any zoom: the measurement as the team entered it. */
function label(text) {
  const c = makeCanvas(256, 96), g = c.getContext('2d');
  g.font = '600 46px "Inter", system-ui, sans-serif';
  const tw = Math.min(236, g.measureText(text).width + 36);
  const x = (256 - tw) / 2;
  g.fillStyle = 'rgba(255,255,255,.92)';
  if (g.roundRect) { g.beginPath(); g.roundRect(x, 14, tw, 68, 34); g.fill(); } else g.fillRect(x, 14, tw, 68);
  g.fillStyle = LINE; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 49);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: asTexture(c), transparent: true, sizeAttenuation: false }));
  s.renderOrder = 10;
  return s;
}

/** Width along the front, depth along the left side, height up the front right corner (from the extent of the closed package). */
function measurements(box, ext, withDepth) {
  const w = ext.max.x - ext.min.x, d = ext.max.z - ext.min.z, h = Math.min(ext.max.y, box.h + 2);
  const x0 = ext.min.x, x1 = ext.max.x, z0 = ext.min.z, z1 = ext.max.z;
  const S = Math.max(w, d, h), off = S * 0.08, y0 = 0.6;
  const pts = [];
  const seg = (a, b) => pts.push(...a, ...b);
  seg([x0, y0, z1 + off], [x1, y0, z1 + off]);
  seg([x0, y0, z1 + off * 0.2], [x0, y0, z1 + off * 1.3]);
  seg([x1, y0, z1 + off * 0.2], [x1, y0, z1 + off * 1.3]);
  if (withDepth) {
    seg([x0 - off, y0, z0], [x0 - off, y0, z1]);
    seg([x0 - off * 0.2, y0, z0], [x0 - off * 1.3, y0, z0]);
    seg([x0 - off * 0.2, y0, z1], [x0 - off * 1.3, y0, z1]);
  }
  const cx = x1 + off * 0.75, cz = z1 + off * 0.75;
  seg([cx, 0, cz], [cx, h, cz]);
  seg([x1 + off * 0.15, h, z1 + off * 0.15], [cx + off * 0.35, h, cz + off * 0.35]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const group = new THREE.Group();
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: LINE, depthWrite: false })));
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  group.add(at(label(box.labels.w), (x0 + x1) / 2, y0, z1 + off));
  if (withDepth && box.labels.d) group.add(at(label(box.labels.d), x0 - off, y0, (z0 + z1) / 2));
  group.add(at(label(box.labels.h), cx + off * 0.6, h / 2, cz));
  return { group, pad: off * 1.6 };
}

/* ---------------- the scene ---------------- */

/** The states a package can be shown in: [fold progress, lid open share]. */
const STATES = { closed: [1, 0], open: [1, 1], flat: [0, 0] };

export function createScene(frame, { backdrop = '#DCD7CE', className = 'stage-3d' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
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
  // a studio backdrop a shade darker than white board, so a white package stands out from it
  scene.background = new THREE.Color(backdrop);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-500, 700, 450);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced();
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.49; // never under the table

  let box = null, model = null, pkg = null, marks = null, shadow = null, look = null, ext = null;
  let visible = false, raf = 0, k = 1, o = 0, state = 'closed', showSizes = true, run = 0, picked = null, placed = null, placing = false;

  function fit() {
    const r = frame.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(0.2, r.width / Math.max(1, r.height));
    camera.updateProjectionMatrix();
    labelSize();
  }
  /** The labels' text about 12 CSS pixels high whatever the frame and zoom. */
  function labelSize() {
    if (!marks) return;
    const fh = Math.max(1, frame.getBoundingClientRect().height);
    const sy = (2 * 26 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / fh;
    marks.group.children.forEach((c) => { if (c.isSprite) c.scale.set(sy * (256 / 96), sy, 1); });
  }
  const centre = () => new THREE.Vector3((ext.min.x + ext.max.x) / 2, ext.max.y / 2, (ext.min.z + ext.max.z) / 2);
  const probe = new THREE.PerspectiveCamera();
  const corner = new THREE.Vector3();
  /** The camera distance that fills the frame with the package as it is now, seen from `dir`. */
  function fitFor(dir) {
    dir = (dir || camera.position.clone().sub(controls.target)).clone().normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.5, 0.4, 0.75).normalize();
    const pad = showSizes && marks?.group.visible ? marks.pad : 0;
    const tgt = centre();
    probe.fov = camera.fov; probe.aspect = camera.aspect; probe.near = camera.near; probe.far = camera.far;
    probe.updateProjectionMatrix();
    const xs = [ext.min.x - pad, ext.max.x + pad], ys = [0, ext.max.y], zs = [ext.min.z - pad, ext.max.z + pad];
    let dist = Math.hypot(xs[1] - xs[0], ys[1], zs[1] - zs[0]) * 2;
    for (let i = 0; i < 5; i++) {
      probe.position.copy(tgt).addScaledVector(dir, dist); probe.lookAt(tgt); probe.updateMatrixWorld();
      let m = 0;
      for (const x of xs) for (const y of ys) for (const z of zs) { corner.set(x, y, z).project(probe); m = Math.max(m, Math.abs(corner.x), Math.abs(corner.y)); }
      dist *= m / 0.84;
    }
    return dist;
  }
  function frameNow(dir) {
    const dist = fitFor(dir);
    controls.minDistance = dist * 0.5; controls.maxDistance = dist * 2.5;
    return dist;
  }
  const ro = new ResizeObserver(() => {
    fit();
    if (pkg) { const dist = frameNow(); camera.position.sub(controls.target).setLength(dist).add(controls.target); controls.update(); }
    draw();
  });
  ro.observe(frame);

  function setPose() {
    ext = pkg.pose(k, o);
    const still = k > 0.98;
    if (shadow) shadow.visible = still;
    if (marks) marks.group.visible = showSizes && still && o < 0.02;
  }
  function build() {
    if (pkg) { scene.remove(pkg.holder); pkg.dispose(); }
    for (const obj of [marks?.group, shadow]) if (obj) { scene.remove(obj); obj.traverse((x) => { x.geometry?.dispose(); for (const m of [].concat(x.material || [])) { m.map?.dispose(); m.dispose(); } }); }
    model = dieline(box.template, { L: box.w, W: box.d, H: box.h });
    pkg = buildPackage(model, { board: box.board, handles: box.handles });
    if (!model.hasLid && state === 'open') { state = 'closed'; [k, o] = STATES.closed; }
    scene.add(pkg.holder);
    // the measurements and the shadow are taken from the closed package
    const closed = pkg.pose(1, 0);
    marks = measurements(box, closed, model.template !== 'pouch' && model.template !== 'sachet');
    shadow = contactShadow(closed.max.x - closed.min.x, closed.max.z - closed.min.z);
    scene.add(marks.group, shadow);
    labelSize();
    paintNow();
    setPose();
    controls.target.copy(centre());
  }
  function paintNow() {
    if (!pkg) return;
    pkg.paint(look || { mode: 'logo' });
    pkg.select(look?.mode === 'faces' ? (look.faces || []) : []);
    describe();
  }
  function describe() {
    if (!box) return;
    const art = { wrap: 'one artwork over the whole package', faces: 'artwork on the chosen faces', design: 'your design' }[look?.mode] || (look?.logo ? 'your logo' : `"${look?.logoText || 'YOUR BRAND'}"`);
    const size = box.labels.d ? `${box.labels.w} wide, ${box.labels.d} deep and ${box.labels.h} high` : `${box.labels.w} wide and ${box.labels.h} high`;
    const now = state === 'flat' ? 'laid flat, with its cut and fold lines' : state === 'open' ? 'open' : 'closed';
    canvas.setAttribute('aria-label', `${BOX_STYLES[box.shape]?.label || model.label}, ${size}, ${BOARD[box.board]?.name || 'board'}, printed with ${art}, ${now}. Arrow keys turn it.`);
  }

  // where the camera sits for each preset view: angle around the package, and height above it
  const VIEWS = { front: [0, 0.12], side: [Math.PI / 2, 0.12], back: [Math.PI, 0.12], top: [0.35, 1.25], start: [-0.6, 0.38], flat: [0.03, 0.08] };
  const dirOf = (view) => { const [az, el] = VIEWS[view] || VIEWS.start; return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); };
  function place(view, instant = false) {
    const dir = dirOf(view);
    const r = frameNow(dir);
    const to = dir.clone().multiplyScalar(r).add(controls.target);
    if (instant || reduced()) { camera.position.copy(to); controls.update(); draw(); return; }
    const from = camera.position.clone(), t0 = performance.now(), dur = 600;
    const step = (now) => {
      const e = 1 - Math.pow(1 - Math.min(1, (now - t0) / dur), 3);
      camera.position.lerpVectors(from, to, e);
      camera.position.sub(controls.target).setLength(r).add(controls.target);
      controls.update(); draw();
      if (e < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Move to a state ('closed', 'open', 'flat'), folding on the way; the camera follows the package. */
  function go(name) {
    if (!pkg || !STATES[name] || (name === 'open' && !model.hasLid)) return;
    const from = [k, o], to = STATES[name], wasFlat = state === 'flat';
    state = name;
    const id = ++run;
    const zoom = camera.position.distanceTo(controls.target) / fitFor();
    const apply = (kk, oo) => {
      k = kk; o = oo; setPose();
      const off = camera.position.clone().sub(controls.target);
      controls.target.copy(centre());
      camera.position.copy(controls.target).add(off.setLength(fitFor() * zoom));
      controls.update(); draw();
    };
    const done = () => { describe(); if (name === 'flat') place('flat'); else if (wasFlat) place('start'); else { frameNow(); draw(); } };
    const dur = Math.min(2400, 1500 * Math.abs(to[0] - from[0]) + 700 * Math.abs(to[1] - from[1]));
    if (reduced() || dur < 1) { apply(...to); done(); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (id !== run) return;
      const p = Math.min(1, (now - t0) / dur), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      apply(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }

  // drawn on demand: a change, a drag, or the damping that follows one
  function draw() { if (visible) renderer.render(scene, camera); }
  controls.addEventListener('change', draw);
  function loop() { controls.update(); raf = visible ? requestAnimationFrame(loop) : 0; }
  let down = null;
  // Moving the logo by hand: a press on the logo itself takes hold of it (the view stays still),
  // a drag carries it across its face, and letting go tells the page where it now is.
  const hitAt = (x, y, only) => {
    const r = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(only || pkg.pickables, false)[0];
    if (!hit?.uv) return null;
    const [px, py] = pkg.sheetPx(hit.uv);
    return { id: hit.object.userData.panel, px, py };
  };
  let grab = [0, 0];
  const onLogo = (h) => { const b = pkg.logoBox(); return !!(placed && b && h && h.id === b.id && Math.hypot(h.px - b.x, h.py - b.y) <= b.r * 1.15); };
  // in the capture phase, so the view's own drag-to-turn has not started yet when this decides
  canvas.addEventListener('pointerdown', (e) => {
    const h = pkg && placed ? hitAt(e.clientX, e.clientY) : null;
    if (!onLogo(h)) return;
    const b = pkg.logoBox();
    grab = [h.px - b.x, h.py - b.y]; // held where it was pressed, not by its middle
    placing = true; controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* the drag still works without it */ }
    canvas.style.cursor = 'grabbing';
  }, { capture: true });
  canvas.addEventListener('pointermove', (e) => {
    if (!placing || !pkg) return;
    const b = pkg.logoBox();
    const face = b && pkg.pickables.find((m) => m.userData.panel === b.id);
    const h = face && hitAt(e.clientX, e.clientY, [face]);
    if (!h) return; // off its face: the logo waits where it was
    look = { ...look, logoAt: pkg.logoAt(h.px - grab[0], h.py - grab[1]) };
    pkg.paint(look); draw();
  });
  const endPlacing = () => {
    if (!placing) return;
    placing = false; down = null; // not a click on a face
    canvas.style.cursor = '';
    setTimeout(() => { controls.enabled = true; }, 0); // after the view's own handlers have seen this release
    placed?.(pkg?.logoBox()?.at || { x: 0, y: 0 });
  };
  canvas.addEventListener('pointerup', endPlacing, { capture: true });
  canvas.addEventListener('pointercancel', endPlacing);
  canvas.addEventListener('pointerdown', (e) => { if (placing) return; down = [e.clientX, e.clientY]; if (!raf && controls.enableDamping) loop(); });
  // a face that a click would act on shows it: tinted under the mouse, with a hand (mouse only, once a frame)
  let hoverQueued = false;
  const faceAt = (x, y) => {
    const r = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const id = ray.intersectObjects(pkg.pickables, false)[0]?.object.userData.panel;
    return id && pkg.faces.some((f) => f.id === id) ? id : null;
  };
  const unhover = () => { if (pkg?.hover(null)) { canvas.style.cursor = ''; draw(); } };
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons || hoverQueued || !pkg) return;
    hoverQueued = true;
    const x = e.clientX, y = e.clientY;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!pkg || !visible) return;
      const id = picked ? faceAt(x, y) : null;
      const changed = pkg.hover(id);
      // over the logo itself: it can be taken hold of and moved
      const cursor = placed && onLogo(hitAt(x, y)) ? 'move' : id ? 'pointer' : '';
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
      if (changed) draw();
    });
  });
  canvas.addEventListener('pointerleave', unhover);
  canvas.addEventListener('pointerup', (e) => {
    setTimeout(() => { cancelAnimationFrame(raf); raf = 0; }, 800);
    // a click, not a drag: which face was it?
    if (!picked || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !pkg) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pkg.pickables, false)[0];
    const id = hit?.object.userData.panel;
    if (id && pkg.faces.some((f) => f.id === id)) picked(id);
  });
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
    /** Show a package (boxOf in lib/box-styles.js) closed, from the starting view, painted with `l`. */
    show(b, l) {
      box = b; look = l || look; visible = true; run++; state = 'closed'; [k, o] = STATES.closed;
      canvas.hidden = false;
      fit(); build(); place('start', true);
    },
    hide() { visible = false; canvas.hidden = true; cancelAnimationFrame(raf); raf = 0; },
    /** Gone for good: the drawing context is given back (a browser allows only a few at once). */
    dispose() {
      run++; visible = false; cancelAnimationFrame(raf); raf = 0; ro.disconnect(); controls.dispose();
      if (pkg) { scene.remove(pkg.holder); pkg.dispose(); pkg = null; }
      scene.environment?.dispose(); pmrem.dispose(); renderer.dispose(); canvas.remove();
    },
    /** Another product, size or board: rebuilt in the same state, from the starting view if the shape changed. */
    update(b, l) {
      const reshape = !box || b.template !== box.template;
      box = b; look = l || look; run++;
      [k, o] = STATES[state] || STATES.closed;
      build();
      if (reshape) place(state === 'flat' ? 'flat' : 'start', true);
      else { const dist = frameNow(); camera.position.sub(controls.target).setLength(dist).add(controls.target); controls.update(); draw(); }
    },
    /** New print, same package: see paint() in buildPackage for what `l` may hold. */
    paint(l) { look = l; if (pkg) { paintNow(); draw(); } },
    go,
    state: () => state,
    view(name) { place(name); },
    sizes(on) { showSizes = on; if (pkg) setPose(); frameNow(); draw(); },
    /** Faces a visitor may print on, and whether this package has a lid to open. */
    info: () => ({ faces: pkg ? pkg.faces : [], hasLid: !!model?.hasLid, template: model?.template, sheet: model ? { w: Math.round(model.sheet.w), h: Math.round(model.sheet.h) } : null }),
    /** fn(faceId) when a face is clicked (not dragged); null to stop. */
    onPick(fn) { picked = typeof fn === 'function' ? fn : null; if (!picked) unhover(); },
    /** fn({ x, y }) when the logo has been moved by hand (shares of its face from the middle); null to stop offering it. */
    onPlace(fn) { placed = typeof fn === 'function' ? fn : null; },
    /** The package as it is turned now, as a PNG about `width` pixels wide. */
    snapshot(width = 1600) {
      return new Promise((resolve) => {
        if (!visible) return resolve(null);
        const r = frame.getBoundingClientRect();
        renderer.setPixelRatio(Math.min(4, width / Math.max(1, r.width)));
        fit();
        renderer.render(scene, camera);
        canvas.toBlob((blob) => { renderer.setPixelRatio(ratio()); fit(); draw(); resolve(blob); }, 'image/png');
      });
    },
  };
}
