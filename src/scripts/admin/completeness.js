// How complete a product is on the website: what a buyer needs to judge it, out
// of 100, with what is missing in words. The marketing teams see it on their
// product lists; the manager sees the same on Products, to know what to ask for.

/** An agricultural product: photo, a fuller description, purity, minimum, key points, category, specification. */
export function agriCompleteness(p) {
  const specs = Object.values(p.spec || {}).filter((v) => String(v || '').trim()).length;
  return score([
    [25, !!p.image, 'photo'],
    [15, String(p.description || '').length >= 120, 'a fuller description (120 characters or more)'],
    [10, !!p.purity, 'purity'],
    [10, !!p.moq, 'minimum order'],
    [15, (p.specs || []).length >= 3, 'at least 3 key points'],
    [5, /^(sesame|pulses|spices|coffee|specialty)$/i.test(p.category || ''), 'a standard category'],
    [20, specs >= 4, 'a specification (at least 4 values, such as moisture and packing)'],
  ]);
}

/**
 * A packaging product: photo, print corners (for the studio), minimum order,
 * measurements of each size, a price for every size, and a lead time. A product
 * made to the buyer's size (no sizes listed) has no measurements to give.
 */
export function packCompleteness(p) {
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  return score([
    [25, !!p.image, 'photo'],
    [15, !!(p.image && Array.isArray(p.quad) && p.quad.length === 4), 'print corners'],
    [15, !!p.minOrder || (sizes.length > 0 && sizes.every((s) => s.minOrder)), 'minimum order'],
    [10, sizes.every((s) => s.w && s.h), 'measurements of each size'],
    [25, sizes.length ? sizes.every((s) => s.pricePer1000 || p.pricePer1000) : !!p.pricePer1000, 'price'],
    [10, !!p.leadTimeDays, 'lead time'],
  ]);
}

function score(checks) {
  const missing = checks.filter(([, ok]) => !ok).map(([, , label]) => label);
  return { score: checks.reduce((n, [pts, ok]) => n + (ok ? pts : 0), 0), missing, complete: !missing.length };
}

/** "12 of 18 products complete" for the top of a list. */
export function completeLine(list, check) {
  const done = list.filter((p) => check(p).complete).length;
  return list.length ? `${done} of ${list.length} product${list.length === 1 ? '' : 's'} complete${done === list.length ? '' : `. Open one to fill in what it is missing.`}` : '';
}
