// Parametric dielines: the flat sheet each packaging product is cut from, built from its
// measurements. One model serves everything: the 3D view folds it, the artwork is painted
// on it, and the flat view shows its cut and crease lines. Pure: no browser, no three.js,
// so the pages, the server and the tests all use the same file.
//
// Sheet coordinates are millimetres, y up, printed (outside) face toward the viewer (+z).
// Every panel is a polygon; every panel but the root hangs on a fold line (hinge) of its
// parent and folds toward the unprinted side, so the print always ends up outside.
//
// Moved from the packaging 3D study (November 2026). Each template was checked by folding
// it at many sizes: the edges that must meet do, and the folded package has the product's
// measurements (test/packaging-3d.test.js).

/** Allowances a press normally sets. Provisional: the real values come from the printer. */
export const ALLOWANCES = { board: 0.5, glue: 15, tuck: 15, hem: 30, seal: 8, bleed: 3, safe: 3 };

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * The folding templates. Each takes { L, W, H } in mm (L width of the front, W depth or
 * gusset, H height) and returns its panels. stage is when the fold happens during the
 * folding animation (0 flat, 1 closed); inset lifts a flap that ends up under another
 * panel; lid is how far a lid fold stays when the package is shown open.
 */
export const TEMPLATES = {
  tuckEnd: { label: 'Tuck-end carton', build: tuckEnd },
  mailer: { label: 'Tray with a hinged lid', build: (d, a) => mailer(d, a, true), rootTurn: 90 },
  tray: { label: 'Open tray', build: (d, a) => mailer(d, a, false), rootTurn: 90 },
  bag: { label: 'Paper bag with a square bottom', build: bag },
  pouch: { label: 'Stand-up pouch', build: (d, a) => pouch(d, a, 0.2) },
  sachet: { label: 'Flat sachet', build: (d, a) => pouch(d, a, 0.09) },
  pillow: { label: 'Pillow box', build: pillow },
  scoop: { label: 'Tapered scoop', build: scoop },
};

function tuckEnd({ L, W, H }, A) {
  const g = A.glue, t = A.board, tk = Math.min(A.tuck, W * 0.7);
  const xB = g, xS1 = g + L, xF = g + L + W, xS2 = g + 2 * L + W;
  const dh = Math.min(W * 0.75, L * 0.45); // dust flap height
  const dust = (x, y0, dir) => [[x + 1, y0], [x + W - 1, y0], [x + W - 1 - W * 0.25, y0 + dir * dh], [x + 1 + W * 0.08, y0 + dir * dh]];
  const tuck = (x, y0, dir) => [[x + 1.5, y0], [x + L - 1.5, y0], [x + L - 1.5 - tk * 0.4, y0 + dir * tk], [x + 1.5 + tk * 0.4, y0 + dir * tk]];
  return [
    { id: 'front', name: 'Front', poly: rect(xF, 0, L, H), role: 'face' },
    { id: 'side1', name: 'Left side', poly: rect(xS1, 0, W, H), parent: 'front', hinge: [[xF, 0], [xF, H]], fold: 90, stage: [0, 0.35], role: 'face' },
    { id: 'back', name: 'Back', poly: rect(xB, 0, L, H), parent: 'side1', hinge: [[xS1, 0], [xS1, H]], fold: 90, stage: [0.15, 0.45], role: 'face' },
    { id: 'glue', name: 'Glue flap', poly: [[g, 0], [g, H], [0, H - 4], [0, 4]], parent: 'back', hinge: [[g, 0], [g, H]], fold: 90, stage: [0.35, 0.55], inset: t, role: 'glue', printable: false },
    { id: 'side2', name: 'Right side', poly: rect(xS2, 0, W, H), parent: 'front', hinge: [[xS2, 0], [xS2, H]], fold: 90, stage: [0, 0.35], role: 'face' },
    { id: 'dustB1', name: 'Bottom dust flap (left)', poly: dust(xS1, 0, -1), parent: 'side1', hinge: [[xS1 + 1, 0], [xS1 + W - 1, 0]], fold: 90, stage: [0.5, 0.62], inset: t, role: 'flap' },
    { id: 'dustB2', name: 'Bottom dust flap (right)', poly: dust(xS2, 0, -1), parent: 'side2', hinge: [[xS2 + 1, 0], [xS2 + W - 1, 0]], fold: 90, stage: [0.5, 0.62], inset: t, role: 'flap' },
    { id: 'bottom', name: 'Bottom', poly: rect(xF, -W, L, W), parent: 'front', hinge: [[xF, 0], [xF + L, 0]], fold: 90, stage: [0.55, 0.75], role: 'face', up: 0 },
    { id: 'tuckB', name: 'Bottom tuck flap', poly: tuck(xF, -W, -1), parent: 'bottom', hinge: [[xF + 1.5, -W], [xF + L - 1.5, -W]], fold: 90, stage: [0.62, 0.8], inset: t, role: 'flap' },
    { id: 'dustT1', name: 'Top dust flap (left)', poly: dust(xS1, H, 1), parent: 'side1', hinge: [[xS1 + 1, H], [xS1 + W - 1, H]], fold: 90, stage: [0.7, 0.82], inset: t, role: 'flap' },
    { id: 'dustT2', name: 'Top dust flap (right)', poly: dust(xS2, H, 1), parent: 'side2', hinge: [[xS2 + 1, H], [xS2 + W - 1, H]], fold: 90, stage: [0.7, 0.82], inset: t, role: 'flap' },
    { id: 'lid', name: 'Top (lid)', poly: rect(xB, H, L, W), parent: 'back', hinge: [[xB, H], [xB + L, H]], fold: 90, stage: [0.78, 0.98], role: 'face', lid: 0.1, up: 180 },
    { id: 'tuckT', name: 'Top tuck flap', poly: tuck(xB, H + W, 1), parent: 'lid', hinge: [[xB + 1.5, H + W], [xB + L - 1.5, H + W]], fold: 90, stage: [0.85, 1], inset: t, role: 'flap', lid: 0.35 },
  ];
}

// laid out with the front wall above the bottom and the back wall, lid and lid flaps
// below it, so that once folded the front faces the viewer and the lid opens toward them
function mailer({ L, W, H }, A, withLid) {
  const t = A.board, ear = H * 0.92, lf = H * 0.8;
  const panels = [
    { id: 'base', name: 'Bottom', poly: rect(0, 0, L, W), role: 'face' },
    { id: 'front', name: 'Front wall', poly: rect(0, W, L, H), parent: 'base', hinge: [[0, W], [L, W]], fold: 90, stage: [0.05, 0.4], role: 'face' },
    { id: 'back', name: 'Back wall', poly: rect(0, -H, L, H), parent: 'base', hinge: [[0, 0], [L, 0]], fold: 90, stage: [0.05, 0.4], role: 'face', up: 180 },
    { id: 'left', name: 'Left wall', poly: rect(-H, 0, H, W), parent: 'base', hinge: [[0, 0], [0, W]], fold: 90, stage: [0.3, 0.55], role: 'face', up: 90 },
    { id: 'right', name: 'Right wall', poly: rect(L, 0, H, W), parent: 'base', hinge: [[L, 0], [L, W]], fold: 90, stage: [0.3, 0.55], role: 'face', up: -90 },
    { id: 'earFL', name: 'Corner flap (front left)', poly: [[0, W + 2], [0, W + H - 2], [-ear, W + H * 0.85], [-ear, W + H * 0.15]], parent: 'front', hinge: [[0, W + 2], [0, W + H - 2]], fold: 90, stage: [0.2, 0.42], inset: t, role: 'flap' },
    { id: 'earFR', name: 'Corner flap (front right)', poly: [[L, W + 2], [L, W + H - 2], [L + ear, W + H * 0.85], [L + ear, W + H * 0.15]], parent: 'front', hinge: [[L, W + 2], [L, W + H - 2]], fold: 90, stage: [0.2, 0.42], inset: t, role: 'flap' },
    { id: 'earBL', name: 'Corner flap (back left)', poly: [[0, -H + 2], [0, -2], [-ear, -H * 0.15], [-ear, -H * 0.85]], parent: 'back', hinge: [[0, -H + 2], [0, -2]], fold: 90, stage: [0.2, 0.42], inset: t, role: 'flap' },
    { id: 'earBR', name: 'Corner flap (back right)', poly: [[L, -H + 2], [L, -2], [L + ear, -H * 0.15], [L + ear, -H * 0.85]], parent: 'back', hinge: [[L, -H + 2], [L, -2]], fold: 90, stage: [0.2, 0.42], inset: t, role: 'flap' },
  ];
  if (withLid) panels.push(
    { id: 'lid', name: 'Lid', poly: rect(0, -H - W, L, W), parent: 'back', hinge: [[0, -H], [L, -H]], fold: 90, stage: [0.6, 0.92], role: 'face', lid: 0.08 },
    { id: 'lidFront', name: 'Lid front flap', poly: [[2, -H - W], [L - 2, -H - W], [L - 2 - lf * 0.3, -H - W - lf], [2 + lf * 0.3, -H - W - lf]], parent: 'lid', hinge: [[2, -H - W], [L - 2, -H - W]], fold: 90, stage: [0.72, 1], inset: t, role: 'flap', lid: 0.2 },
    { id: 'lidL', name: 'Lid side flap (left)', poly: [[0, -H - 2], [0, -H - W + 2], [-lf, -H - W + lf * 0.4], [-lf, -H - lf * 0.4]], parent: 'lid', hinge: [[0, -H - W + 2], [0, -H - 2]], fold: 90, stage: [0.55, 0.7], inset: t, role: 'flap', lid: 0.2 },
    { id: 'lidR', name: 'Lid side flap (right)', poly: [[L, -H - 2], [L, -H - W + 2], [L + lf, -H - W + lf * 0.4], [L + lf, -H - lf * 0.4]], parent: 'lid', hinge: [[L, -H - W + 2], [L, -H - 2]], fold: 90, stage: [0.55, 0.7], inset: t, role: 'flap', lid: 0.2 },
  );
  return panels;
}

function bag({ L, W, H }, A) {
  const g = A.glue, t = A.board, hem = A.hem;
  const xB = g, xS1 = g + L, xF = g + L + W, xS2 = g + 2 * L + W;
  const half = W * 0.55;
  return [
    { id: 'front', name: 'Front', poly: rect(xF, 0, L, H), role: 'face' },
    { id: 'side1', name: 'Left gusset', poly: rect(xS1, 0, W, H), parent: 'front', hinge: [[xF, 0], [xF, H]], fold: 90, stage: [0, 0.35], role: 'face' },
    { id: 'back', name: 'Back', poly: rect(xB, 0, L, H), parent: 'side1', hinge: [[xS1, 0], [xS1, H]], fold: 90, stage: [0.15, 0.45], role: 'face' },
    { id: 'glue', name: 'Glue strip', poly: [[g, 0], [g, H], [0, H], [0, 0]], parent: 'back', hinge: [[g, 0], [g, H]], fold: 90, stage: [0.35, 0.55], inset: t, role: 'glue', printable: false },
    { id: 'side2', name: 'Right gusset', poly: rect(xS2, 0, W, H), parent: 'front', hinge: [[xS2, 0], [xS2, H]], fold: 90, stage: [0, 0.35], role: 'face' },
    // the turn-over is one strip of paper: where its parts meet is a fold, not a cut (seam)
    { id: 'hemF', name: 'Top turn-over (front)', poly: rect(xF, H, L, hem), parent: 'front', hinge: [[xF, H], [xF + L, H]], fold: 180, stage: [0.5, 0.65], inset: t, role: 'flap', seam: 'hem' },
    { id: 'hemB', name: 'Top turn-over (back)', poly: rect(xB, H, L, hem), parent: 'back', hinge: [[xB, H], [xB + L, H]], fold: 180, stage: [0.5, 0.65], inset: t, role: 'flap', seam: 'hem' },
    { id: 'hemS1', name: 'Top turn-over (left)', poly: rect(xS1, H, W, hem), parent: 'side1', hinge: [[xS1, H], [xS1 + W, H]], fold: 180, stage: [0.5, 0.65], inset: t, role: 'flap', seam: 'hem' },
    { id: 'hemS2', name: 'Top turn-over (right)', poly: rect(xS2, H, W, hem), parent: 'side2', hinge: [[xS2, H], [xS2 + W, H]], fold: 180, stage: [0.5, 0.65], inset: t, role: 'flap', seam: 'hem' },
    { id: 'botS1', name: 'Bottom fold (left)', poly: [[xS1, 0], [xS1 + W, 0], [xS1 + W / 2, -W / 2]], parent: 'side1', hinge: [[xS1, 0], [xS1 + W, 0]], fold: 90, stage: [0.6, 0.78], inset: t, role: 'flap' },
    { id: 'botS2', name: 'Bottom fold (right)', poly: [[xS2, 0], [xS2 + W, 0], [xS2 + W / 2, -W / 2]], parent: 'side2', hinge: [[xS2, 0], [xS2 + W, 0]], fold: 90, stage: [0.6, 0.78], inset: t, role: 'flap' },
    { id: 'bottom', name: 'Bottom', poly: rect(xF, -W, L, W), parent: 'front', hinge: [[xF, 0], [xF + L, 0]], fold: 90, stage: [0.7, 0.92], role: 'face' },
    { id: 'botB', name: 'Bottom fold (back)', poly: rect(xB, -half, L, half), parent: 'back', hinge: [[xB, 0], [xB + L, 0]], fold: 90, stage: [0.8, 1], inset: 2 * t, role: 'flap' },
  ];
}

function pouch({ L, H }, A, bulge) {
  return [
    { id: 'front', name: 'Front', poly: rect(0, 0, L, H), role: 'face', bulge: bulge * Math.min(L, H), seal: A.seal },
    // the back film sits a hair behind the front where the two are sealed, so they never flicker
    { id: 'back', name: 'Back', poly: rect(L, 0, L, H), parent: 'front', hinge: [[L, 0], [L, H]], fold: 180, stage: [0, 0.7], role: 'face', bulge: bulge * Math.min(L, H), seal: A.seal, inset: -0.4 },
  ];
}

/**
 * A pillow box: two faces joined down one long edge, swelling to the box's depth in the
 * middle and pinched shut along both long edges, with a tuck-in flap at each end. The
 * real box closes on curved creases; here the faces swell smoothly instead (a preview of
 * the shape, like the pouches).
 */
function pillow({ L, W, H }, A) {
  const g = Math.min(A.glue, L * 0.2);
  const f = clamp(W * 0.55, 8, H * 0.25); // how far an end flap reaches in
  // a half-ellipse on the end edge y0 of a face starting at x0, reaching `dir` * f
  const flap = (x0, y0, dir) => { const pts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); pts.push([x0 + L / 2 - Math.cos(a) * (L / 2 - 1), y0 + dir * Math.sin(a) * f]); } return pts; };
  const swell = { bulge: W / 2, seal: 0, bulgePow: [0.85, 0.22] };
  return [
    { id: 'front', name: 'Front', poly: rect(0, 0, L, H), role: 'face', ...swell },
    { id: 'back', name: 'Back', poly: rect(L, 0, L, H), parent: 'front', hinge: [[L, 0], [L, H]], fold: 180, stage: [0, 0.7], role: 'face', inset: -0.4, ...swell },
    { id: 'glue', name: 'Glue strip', poly: [[0, 0], [0, H], [-g, H - 4], [-g, 4]], parent: 'front', hinge: [[0, 0], [0, H]], fold: 180, stage: [0.1, 0.6], inset: -0.2, role: 'glue', printable: false },
    { id: 'endFT', name: 'End flap (front, top)', poly: flap(0, H, 1), parent: 'front', hinge: [[1, H], [L - 1, H]], fold: 180, stage: [0.7, 0.95], inset: -0.1, role: 'flap' },
    { id: 'endFB', name: 'End flap (front, bottom)', poly: flap(0, 0, -1), parent: 'front', hinge: [[1, 0], [L - 1, 0]], fold: 180, stage: [0.7, 0.95], inset: -0.1, role: 'flap' },
    { id: 'endBT', name: 'End flap (back, top)', poly: flap(L, H, 1), parent: 'back', hinge: [[L + 1, H], [2 * L - 1, H]], fold: 180, stage: [0.75, 1], inset: -0.1, role: 'flap' },
    { id: 'endBB', name: 'End flap (back, bottom)', poly: flap(L, 0, -1), parent: 'back', hinge: [[L + 1, 0], [2 * L - 1, 0]], fold: 180, stage: [0.75, 1], inset: -0.1, role: 'flap' },
  ];
}

/**
 * A tapered scoop (a fries carton): four walls leaning out from a smaller bottom, open
 * at the top, the front dipping and the back rising in a curve. L and W are the opening
 * at the top, H the height. The walls are true trapezoids: each is laid against its
 * neighbour's slanted edge in the sheet, and folds by the angle the leaning walls
 * really meet at (a little under a right angle), so the scoop closes exactly.
 */
function scoop({ L, W, H }, A) {
  const t = A.board, K = 0.7; // the bottom is 70% of the opening
  const a = L * K, b = W * K, dx = (L - a) / 2, dz = (W - b) / 2;
  const sf = Math.hypot(H, dz), ss = Math.hypot(H, dx); // slant heights: front and back, sides
  const deg = (r) => r * 180 / Math.PI;
  const wall = deg(Math.acos((dz / sf) * (dx / ss))); // between two neighbouring walls
  const base = deg(Math.acos(dz / sf)); // between the front wall and the bottom
  // lay a panel drawn in its own space against an edge already in the sheet
  const place = (poly, [p0, p1], [q0, q1]) => {
    const ang = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    const at = ([x, y]) => [q0[0] + (x - p0[0]) * c - (y - p0[1]) * s, q0[1] + (x - p0[0]) * s + (y - p0[1]) * c];
    return { poly: poly.map(at), at, up: deg(ang) };
  };
  // a front or back wall: bottom, right slant, a curved top (dipping or rising by `bow`), left slant
  const face = (bow) => { const pts = [[-a / 2, 0], [a / 2, 0]]; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([L / 2 - L * u, sf + bow * Math.sin(Math.PI * u)]); } return pts; };
  const side = [[-b / 2, 0], [b / 2, 0], [W / 2, ss], [-W / 2, ss]];
  const front = face(-sf * 0.16), backOwn = face(sf * 0.2);
  const right = place(side, [side[0], side[3]], [front[1], front[2]]);
  const left = place(side, [side[1], side[2]], [front[0], front[front.length - 1]]);
  const farLeft = [left.at(side[0]), left.at(side[3])];
  const back = place(backOwn, [backOwn[1], backOwn[2]], farLeft);
  const g = Math.min(A.glue, a * 0.3), n = backOwn.length - 1;
  const glueOwn = [backOwn[0], backOwn[n], [backOwn[n][0] - g, backOwn[n][1] - 6], [backOwn[0][0] - g, 6]];
  return {
    rootTurn: deg(Math.atan2(dz, H)), // the front wall leans out, so the bottom sits level
    panels: [
      { id: 'front', name: 'Front', poly: front, role: 'face' },
      { id: 'side1', name: 'Left side', poly: left.poly, parent: 'front', hinge: [front[0], front[front.length - 1]], fold: wall, stage: [0, 0.4], role: 'face', up: left.up },
      { id: 'side2', name: 'Right side', poly: right.poly, parent: 'front', hinge: [front[1], front[2]], fold: wall, stage: [0, 0.4], role: 'face', up: right.up },
      { id: 'back', name: 'Back', poly: back.poly, parent: 'side1', hinge: farLeft, fold: wall, stage: [0.2, 0.6], role: 'face', up: back.up },
      { id: 'glue', name: 'Glue flap', poly: glueOwn.map(back.at), parent: 'back', hinge: [back.at(backOwn[0]), back.at(backOwn[n])], fold: wall, stage: [0.45, 0.7], inset: t, role: 'glue', printable: false },
      { id: 'bottom', name: 'Bottom', poly: [[-a / 2, 0], [a / 2, 0], [a / 2, -b], [-a / 2, -b]], parent: 'front', hinge: [[-a / 2, 0], [a / 2, 0]], fold: base, stage: [0.6, 0.95], role: 'face' },
    ],
  };
}

/** The dieline of one template at one size: panels, fold signs, the sheet's extent, cut and crease lines. */
export function dieline(template, dims, allowances = ALLOWANCES) {
  const def = Object.hasOwn(TEMPLATES, template) ? TEMPLATES[template] : null;
  if (!def) throw new Error(`No dieline template "${template}"`);
  const A = { ...ALLOWANCES, ...allowances };
  // a builder gives its panels, or its panels with the turn that stands the package on its base
  const built = def.build(dims, A);
  const panels = (Array.isArray(built) ? built : built.panels).map((p) => ({ printable: true, inset: 0, up: 0, lid: 0, stage: [0, 1], ...p }));
  const rootTurn = (Array.isArray(built) ? undefined : built.rootTurn) ?? def.rootTurn ?? 0;
  const byId = new Map(panels.map((p) => [p.id, p]));
  for (const p of panels) {
    if (!p.parent) continue;
    if (!byId.has(p.parent)) throw new Error(`${p.id} hangs on a missing panel ${p.parent}`);
    // which side of its fold line the panel lies on decides the turn that folds it away from the print
    const [a, b] = p.hinge, c = centroid(p.poly);
    const side = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    p.sign = side > 0 ? -1 : 1;
  }
  const xs = panels.flatMap((p) => p.poly.map((q) => q[0])), ys = panels.flatMap((p) => p.poly.map((q) => q[1]));
  const sheet = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  sheet.w = sheet.maxX - sheet.minX; sheet.h = sheet.maxY - sheet.minY;
  const { cut, crease } = lines(panels);
  return { template, label: def.label, dims, allowances: A, panels, sheet, cut, crease, rootTurn, hasLid: panels.some((p) => p.lid > 0) };
}

export const centroid = (poly) => poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length], [0, 0]);

/**
 * Cut lines: every panel edge, less the parts that are a fold line, each once. Crease lines:
 * the fold lines. An edge partly on a fold (a side panel's top, where a dust flap is folded
 * from the middle of it) is split: the fold part is a crease, the rest is cut.
 */
function lines(panels) {
  const key = (a, b) => { const r = (v) => Math.round(v * 100) / 100; const [p, q] = [a, b].sort((m, n) => m[0] - n[0] || m[1] - n[1]); return `${r(p[0])},${r(p[1])},${r(q[0])},${r(q[1])}`; };
  const crease = panels.filter((p) => p.hinge).map((p) => [...p.hinge[0], ...p.hinge[1]]);
  const hinges = panels.filter((p) => p.hinge).map((p) => p.hinge);
  const seen = new Map(), cut = [];
  for (const p of panels) {
    for (let i = 0; i < p.poly.length; i++) {
      const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length];
      for (const [c, d] of offFold(a, b, hinges)) {
        const k = key(c, d);
        const other = seen.get(k);
        if (!other) { seen.set(k, p); cut.push([...c, ...d]); }
        else if (p.seam && p.seam === other.seam) {
          // two parts of one strip meet here: a fold, not a cut
          const at = cut.findIndex((s) => key([s[0], s[1]], [s[2], s[3]]) === k);
          crease.push(...cut.splice(at, 1));
        }
      }
    }
  }
  return { cut, crease };
}
/** The pieces of edge a-b that are not on any fold line, as [start, end] pairs. */
function offFold(a, b, hinges) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.01) return [];
  const t = (q) => ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (len * len);
  const offLine = (q) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / len > 0.01;
  const covered = hinges.filter(([h1, h2]) => !offLine(h1) && !offLine(h2))
    .map(([h1, h2]) => [Math.max(0, Math.min(t(h1), t(h2))), Math.min(1, Math.max(t(h1), t(h2)))])
    .filter(([s, e]) => e - s > 1e-6).sort((x, y) => x[0] - y[0]);
  const pieces = []; let from = 0;
  for (const [s, e] of covered) { if (s > from) pieces.push([from, s]); from = Math.max(from, e); }
  if (from < 1) pieces.push([from, 1]);
  const at = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  return pieces.filter(([s, e]) => (e - s) * len > 0.01).map(([s, e]) => [at(s), at(e)]);
}

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
/**
 * The angle of every fold, in radians, at fold progress k (0 flat, 1 closed). With the lid
 * open, lid folds stop at their `lid` share of the way. `open` is true or false, or a share
 * from 0 to 1 while the lid is opening.
 */
export function foldAngles(model, k, open = false) {
  const out = {};
  const o = open === true ? 1 : clamp(Number(open) || 0, 0, 1);
  for (const p of model.panels) {
    if (!p.parent) continue;
    const [s, e] = p.stage;
    let f = ease(clamp((k - s) / (e - s), 0, 1));
    if (o && p.lid) f += (Math.min(f, p.lid) - f) * o;
    out[p.id] = p.sign * (p.fold * Math.PI / 180) * f;
  }
  return out;
}
export const rootProgress = (k) => ease(clamp(k / 0.4, 0, 1));

/**
 * Where every panel is when folded: one matrix per panel, taking a point on the flat sheet
 * (mm, z = 0) to its place in the folded package. The 3D view and the closure checks both
 * use this, so both see the same package. THREE is passed in, so this runs in the browser
 * and in Node alike.
 */
export function panelMatrices(model, k, open, THREE) {
  const angles = foldAngles(model, k, open);
  const out = {};
  const kids = (id) => model.panels.filter((p) => p.parent === id);
  const turn = new THREE.Matrix4().makeRotationX((model.rootTurn * Math.PI / 180) * rootProgress(k));
  const visit = (p, parentM, parentPivot) => {
    const pivot = p.hinge ? p.hinge[0] : [0, 0];
    const m = parentM.clone().multiply(new THREE.Matrix4().makeTranslation(pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], 0));
    if (p.hinge) {
      const axis = new THREE.Vector3(p.hinge[1][0] - p.hinge[0][0], p.hinge[1][1] - p.hinge[0][1], 0).normalize();
      m.multiply(new THREE.Matrix4().makeRotationAxis(axis, angles[p.id]));
    }
    out[p.id] = m.clone().multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -p.inset));
    for (const c of kids(p.id)) visit(c, m, pivot);
  };
  for (const r of model.panels.filter((p) => !p.parent)) visit(r, turn, [0, 0]);
  return out;
}

/** A sheet point of a panel, folded: [x, y, z] in mm. */
export function foldPoint(mats, id, [x, y], THREE, z = 0) {
  const v = new THREE.Vector3(x, y, z).applyMatrix4(mats[id]);
  return [v.x, v.y, v.z];
}
