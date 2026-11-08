// The studio's last design, kept in this browser like the brand (live-print.js)
// and the packing list (packing-list.js): the visitor's choices only, never their
// logo or artwork files. Every value is checked when read back, so an old or
// edited entry can never break the studio. No browser APIs here: tests use it too.
export const MEMORY_KEY = 'olira-studio';

/** The design as stored: product, size, ink, text, scale, position, logo in one ink, artwork fit. */
export function toSaved(state) {
  return {
    v: 1,
    template: state.template, size: state.size, ink: state.ink,
    text1: String(state.text1 ?? ''), text2: String(state.text2 ?? ''),
    scale: state.scale, dx: Math.round(state.dx || 0), dy: Math.round(state.dy || 0),
    oneInk: !!state.oneInk, fit: state.fit,
  };
}

/**
 * The stored design as studio state, keeping only values that are still valid:
 * a product that is still in the studio, a known ink, text within the fields'
 * limits, numbers within the studio's ranges. Null when there is nothing usable.
 */
export function fromSaved(raw, { templates = [], inks = {} } = {}) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== 'object' || o.v !== 1) return null;
  const out = {};
  if (typeof o.template === 'string' && templates.some((t) => t.id === o.template)) out.template = o.template;
  if (typeof o.size === 'string' && /^[a-z0-9-]{1,30}$/.test(o.size)) out.size = o.size;
  if (typeof o.ink === 'string' && Object.hasOwn(inks, o.ink)) out.ink = o.ink;
  if (typeof o.text1 === 'string') out.text1 = o.text1.slice(0, 18);
  if (typeof o.text2 === 'string') out.text2 = o.text2.slice(0, 28);
  const within = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const scale = within(o.scale, 0.5, 1.4), dx = within(o.dx, -600, 600), dy = within(o.dy, -1600, 1600);
  if (scale !== undefined) out.scale = scale;
  if (dx !== undefined) out.dx = dx;
  if (dy !== undefined) out.dy = dy;
  if (typeof o.oneInk === 'boolean') out.oneInk = o.oneInk;
  if (o.fit === 'cover' || o.fit === 'contain') out.fit = o.fit;
  return Object.keys(out).length ? out : null;
}
