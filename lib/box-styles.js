// The folding styles the studio can show in 3D, shared by the server (saving a
// product), the packaging page (the studio's 3D view) and the team's catalogue
// editor. The packaging team picks one per product; the box is then built from
// that product's own measurements, so it is a preview of the shape, not the
// press's cutting layout. Products that are not boxes (bags, pouches) keep "none"
// and the photo mockup.
//
// No Node or browser APIs here: both sides import this file.

export const BOX_STYLES = {
  mailer: { label: 'Pizza box style', hint: 'Tray with a lid hinged at the back and a tuck front' },
  carton: { label: 'Tuck-end carton', hint: 'Upright carton with a tuck flap at the top, like a medicine box' },
};

export const BOARDS = {
  kraft: 'Brown kraft',
  white: 'White board',
  both: 'Both',
};

/** A stored value read as a style id, or null for none. */
export const boxStyle = (v) => (typeof v === 'string' && Object.hasOwn(BOX_STYLES, v) ? v : null);
/** A stored value read as a board id; kraft when unset or unknown. */
export const boxBoard = (v) => (typeof v === 'string' && Object.hasOwn(BOARDS, v) ? v : 'kraft');

const measured = (s) => [s?.w, s?.d, s?.h].every((n) => Number.isFinite(n) && n > 0);

/**
 * Whether a product can be shown as a 3D box: it has a style, at least one size,
 * and every size has its width, depth and height. A box is never drawn at a
 * guessed size, so one size without measurements keeps the whole product out.
 */
export function has3d(p) {
  const sizes = Array.isArray(p?.sizes) ? p.sizes : [];
  return !!boxStyle(p?.shape3d) && sizes.length > 0 && sizes.every(measured);
}

/** A measurement as the team typed it, in centimetres: "30 cm", "12.5 cm". */
export const cmLabel = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} cm`;

/**
 * The 3D scene's box for a product in a size (its own medium, else its first),
 * or null when the product cannot be shown in 3D. The team enters centimetres;
 * the scene works in millimetres. `board` is the visitor's choice, used only when
 * the product comes in both boards.
 */
export function boxOf(p, sizeId, board) {
  if (!has3d(p)) return null;
  const size = p.sizes.find((s) => s.id === sizeId) || p.sizes.find((s) => s.id === 'medium') || p.sizes[0];
  const boards = boxBoard(p.board3d);
  const b = boards === 'both' ? (board === 'white' ? 'white' : 'kraft') : boards;
  return {
    key: [p.id, size.id, size.w, size.d, size.h, b].join('|'),
    shape: boxStyle(p.shape3d), board: b, both: boards === 'both',
    w: size.w * 10, d: size.d * 10, h: size.h * 10,
    labels: { w: cmLabel(size.w), d: cmLabel(size.d), h: cmLabel(size.h) },
    sizeLabel: size.label, name: `${size.label} ${String(p.name || '').toLowerCase()}`,
  };
}
