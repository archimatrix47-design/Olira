// The 3D shapes a packaging product can be shown as, shared by the server (saving a
// product, the public catalogue), the pages (the studio and product pages) and the
// staff screens. The packaging team picks one per product; the package is then built
// from that product's own measurements (lib/package-shapes.js), so it is a preview of
// the shape at the visitor's size, not the press's cutting layout.
//
// Whether 3D shows on the website at all is decided by two switches, one for the
// packaging team and one for the manager: it shows only when both are on (view3dLive).
//
// No Node or browser APIs here: both sides import this file.

/**
 * The shapes. `template` is the folding template in lib/package-shapes.js; `flat` shapes
 * need only a width and a height; `main` is where the brand goes by default.
 * The ids of the first two are kept as they were stored before more shapes were added.
 */
export const BOX_STYLES = {
  mailer: { label: 'Pizza box style', hint: 'Tray with a lid hinged at the back and a tuck front', template: 'mailer', main: ['lid'] },
  carton: { label: 'Tuck-end carton', hint: 'Upright carton with a tuck flap at the top, like a medicine box', template: 'tuckEnd', main: ['front', 'back'] },
  tray: { label: 'Open tray', hint: 'Four walls and no lid, like a food tray', template: 'tray', main: ['front'] },
  bag: { label: 'Paper bag, no handles', hint: 'Square bottom and side gussets', template: 'bag', main: ['front', 'back'] },
  'bag-flat': { label: 'Paper bag with flat handles', hint: 'Square bottom, side gussets and flat paper handles', template: 'bag', handles: 'flat', main: ['front', 'back'] },
  'bag-twisted': { label: 'Paper bag with twisted handles', hint: 'Square bottom, side gussets and twisted paper handles', template: 'bag', handles: 'twisted', main: ['front', 'back'] },
  pouch: { label: 'Stand-up pouch', hint: 'Two films sealed round the edge, standing on a bottom gusset: only the width and height are needed', template: 'pouch', flat: true, main: ['front'] },
  sachet: { label: 'Flat sachet or foil bag', hint: 'Two films sealed all round, no gusset: only the width and height are needed', template: 'sachet', flat: true, main: ['front'] },
  pillow: { label: 'Pillow box', hint: 'Two curved faces that close with a tuck-in flap at each end; the depth is its thickness in the middle', template: 'pillow', main: ['front'] },
  scoop: { label: 'Fries carton', hint: 'A scoop open at the top and narrower at the bottom; the width and depth are those of the opening', template: 'scoop', main: ['front', 'back'] },
};

export const BOARDS = {
  kraft: 'Brown kraft',
  white: 'White board',
  both: 'Both',
  foil: 'Foil',
};

/** A stored value read as a style id, or null for none. */
export const boxStyle = (v) => (typeof v === 'string' && Object.hasOwn(BOX_STYLES, v) ? v : null);
/** A stored value read as a board id; kraft when unset or unknown. */
export const boxBoard = (v) => (typeof v === 'string' && Object.hasOwn(BOARDS, v) ? v : 'kraft');
/** Whether a shape needs each size's depth: every shape but a flat one does. */
export const needsDepth = (shape) => !BOX_STYLES[boxStyle(shape)]?.flat;

const positive = (n) => Number.isFinite(n) && n > 0;
const measuredFor = (shape) => (s) => positive(s?.w) && positive(s?.h) && (!needsDepth(shape) || positive(s?.d));

/**
 * Whether a product can be shown in 3D: it has a shape, at least one size, and every
 * size has the measurements that shape needs. A package is never drawn at a guessed
 * size, so one size without its measurements keeps the whole product out.
 */
export function has3d(p) {
  const shape = boxStyle(p?.shape3d);
  const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
  return !!shape && sizes.length > 0 && sizes.every(measuredFor(shape));
}

/** How many of a product's sizes have the measurements its shape needs: for the staff screens. */
export function measuredSizes(p) {
  const shape = boxStyle(p?.shape3d);
  const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
  return { done: shape ? sizes.filter(measuredFor(shape)).length : 0, of: sizes.length };
}

/** A measurement as the team typed it, in centimetres: "30 cm", "12.5 cm". */
export const cmLabel = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} cm`;

/**
 * The package for a product in a size (its own medium, else its first), or null when the
 * product cannot be shown in 3D. The team enters centimetres; the scene works in
 * millimetres. `board` is the visitor's choice, used only when the product comes in both.
 */
export function boxOf(p, sizeId, board) {
  if (!has3d(p)) return null;
  const shape = boxStyle(p.shape3d), def = BOX_STYLES[shape];
  const size = p.sizes.find((s) => s.id === sizeId) || p.sizes.find((s) => s.id === 'medium') || p.sizes[0];
  const boards = boxBoard(p.board3d);
  const b = boards === 'both' ? (board === 'white' ? 'white' : 'kraft') : boards;
  const d = def.flat ? 0 : size.d;
  return {
    key: [p.id, size.id, size.w, d, size.h, b, shape].join('|'),
    shape, template: def.template, handles: def.handles || null, main: def.main,
    board: b, both: boards === 'both',
    w: size.w * 10, d: d * 10, h: size.h * 10,
    labels: { w: cmLabel(size.w), d: def.flat ? null : cmLabel(d), h: cmLabel(size.h) },
    sizeId: size.id, sizeLabel: size.label, name: `${size.label} ${String(p.name || '').toLowerCase()}`,
  };
}

/* ---------------- the two switches ---------------- */

/** The two switches as stored ({ team: { on }, manager: { on } }): each is on only when set to true. */
export const switchesOf = (s) => ({ team: s?.team?.on === true, manager: s?.manager?.on === true });

/**
 * The AND gate: 3D shows on the website only when the packaging team AND the manager
 * have switched it on. Either of them turning theirs off takes it off the site.
 */
export function view3dLive(s) {
  const on = switchesOf(s);
  return on.team && on.manager;
}
