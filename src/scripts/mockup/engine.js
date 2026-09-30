// Kraft bag mockup renderer, shared by the public studio (packaging page), the
// packaging team's workspace and the admin packaging product editor.
//
// Built the way a smart-object mockup works, on a real product photograph:
//   1. base     the product photo on its plain white background (or the same
//               shot on black in dark mode, when the admin added one)
//   2. design   logo and text laid out on a flat artboard the shape of the
//               bag's front panel, or the visitor's own full artwork filling it
//   3. warp     the artboard is bent into the panel's four corners (set in the
//               admin) with a perspective mesh, so the print follows the photo
//   4. blend    coloured ink is multiplied into the paper so fibres, creases and
//               shadows show through; white ink is laid on top and shaded by the
//               photo's own light
// The canvas takes the photo's own proportions, 1200 px wide.

export const CANVAS_W = 1200;
// Indicative standard sizes, width x gusset x height. Confirmed to order.
export const SIZES = {
  small: { label: 'Small', dims: '18 x 8 x 22 cm' },
  medium: { label: 'Medium', dims: '25 x 11 x 32 cm' },
  large: { label: 'Large', dims: '32 x 12 x 42 cm' },
};
export const INKS = { black: ['Black', '#1E1B16'], teal: ['Teal', '#186078'], leaf: ['Leaf green', '#4A5E17'], red: ['Red', '#A3301E'], white: ['White', '#FAF7F0'] };
// mode 'brand' is a logo and two lines of text in one ink; mode 'artwork' is the
// visitor's own finished design (a full page) printed in full colour across the panel
export const defaultDesign = () => ({ size: 'medium', ink: 'teal', logo: null, oneInk: false, text1: 'YOUR BRAND', text2: 'yourbrand.com', scale: 1, dx: 0, dy: 0, mode: 'brand', artwork: null, fit: 'cover' });
export const usableInStudio = (p) => !!(p && p.image && Array.isArray(p.quad) && p.quad.length === 4);

export const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/* ---------------- theme ---------------- */
export function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
/** Calls back when the page switches between light and dark. */
export function onThemeChange(cb) {
  let last = isDarkTheme();
  const check = () => { const now = isDarkTheme(); if (now !== last) { last = now; cb(now); } };
  new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', check);
}
/** The photo to use: the dark theme photo only when there is one and the page is dark. */
export const photoFor = (p, dark = isDarkTheme()) => (dark && p.imageDark ? p.imageDark : p.image);

/* ---------------- geometry ---------------- */
export function homography(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const m = [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
  const fwd = (u, v) => { const w = m[6] * u + m[7] * v + 1; return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w]; };
  // inverse, for turning a pointer position back into artboard coordinates
  const [a, b, c, d, e, f, gg, hi, i] = m;
  const A = e * i - f * hi, B = -(d * i - f * gg), C = d * hi - e * gg;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * hi), b * f - c * e, B, a * i - c * gg, -(a * f - c * d), C, -(a * hi - b * gg), a * e - b * d].map((n) => n / det);
  const back = (x, y) => { const w = inv[6] * x + inv[7] * y + inv[8]; return [(inv[0] * x + inv[1] * y + inv[2]) / w, (inv[3] * x + inv[4] * y + inv[5]) / w]; };
  return { fwd, back };
}

const imageCache = new Map();
export function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(src); reject(new Error('The product photo could not load.')); };
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

/**
 * Prepare a product for rendering. `p` is { image, imageDark?, quad: [[u, v] x 4]
 * as fractions of the photo, safeTop }; width is the canvas width (1200 for the
 * studio, less for small live previews). Cached per photo, corners and width, so moving
 * a corner in the editor re-prepares only that product.
 */
const prepared = new Map();
export async function prepare(p, { dark = isDarkTheme(), width = CANVAS_W } = {}) {
  const src = photoFor(p, dark);
  const key = `${src}|${JSON.stringify(p.quad)}|${p.safeTop}|${width}`;
  if (prepared.has(key)) return prepared.get(key);
  const job = (async () => {
    const img = await loadImage(src);
    const cw = width, ch = Math.round(width * (img.naturalHeight / img.naturalWidth));
    const quad = p.quad.map(([u, v]) => [u * cw, v * ch]);
    const photo = makeCanvas(cw, ch), g = photo.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cw, ch);

    // artboard in the panel's proportions
    const wTop = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]), wBot = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
    const hL = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]), hR = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
    const AW = 1000, AH = Math.max(200, Math.min(3000, Math.round(AW * ((hL + hR) / Math.max(1, wTop + wBot)))));

    // the photo's own light, normalised so the average paper tone is white; used to shade white ink
    const data = g.getImageData(0, 0, cw, ch), px = data.data;
    const H = homography(quad);
    let sum = 0, n = 0;
    for (let v = 0.15; v < 0.95; v += 0.05) for (let u = 0.1; u < 0.9; u += 0.05) {
      const [x, y] = H.fwd(u, v);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= cw || yi >= ch) continue;
      const o = (yi * cw + xi) * 4;
      sum += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; n++;
    }
    const mean = (n ? sum / n : 200) * 1.06;
    const shade = makeCanvas(cw, ch), sctx = shade.getContext('2d'), sd = sctx.createImageData(cw, ch), q = sd.data;
    for (let o = 0; o < px.length; o += 4) {
      const L = Math.min(255, 255 * (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / mean);
      q[o] = q[o + 1] = q[o + 2] = L; q[o + 3] = 255;
    }
    sctx.putImageData(sd, 0, 0);
    const poly = new Path2D(); poly.moveTo(...quad[0]); quad.slice(1).forEach((pt) => poly.lineTo(...pt)); poly.closePath();
    return { photo, shade, quad, H, poly, AW, AH, cw, ch, safeTop: Number.isFinite(p.safeTop) ? p.safeTop : 0.1, art: makeCanvas(AW, AH) };
  })();
  prepared.set(key, job);
  job.catch(() => prepared.delete(key));
  if (prepared.size > 16) prepared.delete(prepared.keys().next().value);
  return job;
}

/* ---------------- artboard ---------------- */
let tint = null;
export function drawArt(B, d) {
  if (d.mode === 'artwork') return drawArtwork(B, d);
  const { art, AW, AH } = B, a = art.getContext('2d');
  a.clearRect(0, 0, AW, AH);
  const s = d.scale, ink = INKS[d.ink]?.[1] || INKS.black[1], maxW = AW * 0.84;
  let logoW, logoH;
  if (d.logo) {
    const ratio = (d.logo.naturalWidth || d.logo.width) / (d.logo.naturalHeight || d.logo.height) || 1;
    logoW = Math.min(AW * 0.56 * s, maxW); logoH = logoW / ratio;
    if (logoH > AH * 0.32 * s) { logoH = AH * 0.32 * s; logoW = logoH * ratio; }
  } else { logoW = AW * 0.44 * s; logoH = AW * 0.26 * s; }
  let size1 = AW * 0.135 * s;
  a.font = `700 ${size1}px "Hanken Grotesk", sans-serif`;
  const w1 = a.measureText(d.text1).width; if (w1 > maxW) size1 *= maxW / w1;
  let size2 = Math.min(AW * 0.062 * s, size1 * 0.62);
  a.font = `500 ${size2}px "Hanken Grotesk", sans-serif`;
  const w2 = a.measureText(d.text2).width; if (w2 > maxW) size2 *= maxW / w2;
  let gap = AW * 0.06 * s;
  let total = logoH + (d.text1 ? gap + size1 : 0) + (d.text2 ? gap * 0.55 + size2 : 0);
  // Sizes above follow the panel's width. A wide, short panel (the front of a
  // box, an envelope) cannot hold that stack, so the whole design is scaled down
  // to the panel's height instead of running off it. Tall bag panels already fit.
  const room = AH * (1 - B.safeTop) * 0.9;
  if (total > room) {
    const f = room / total;
    logoW *= f; logoH *= f; size1 *= f; size2 *= f; gap *= f; total = room;
  }
  const cx = AW / 2 + d.dx;
  let y = AH * (B.safeTop + (1 - B.safeTop) * 0.44) + d.dy - total / 2;

  if (d.logo) {
    if (d.oneInk) {
      tint ||= makeCanvas(1, 1);
      tint.width = Math.max(1, Math.round(logoW)); tint.height = Math.max(1, Math.round(logoH));
      const t = tint.getContext('2d');
      t.drawImage(d.logo, 0, 0, tint.width, tint.height);
      t.globalCompositeOperation = 'source-in'; t.fillStyle = ink; t.fillRect(0, 0, tint.width, tint.height);
      a.drawImage(tint, cx - logoW / 2, y, logoW, logoH);
    } else a.drawImage(d.logo, cx - logoW / 2, y, logoW, logoH);
  } else if (d.placeholder !== false) {
    a.save(); a.strokeStyle = ink; a.globalAlpha = 0.65; a.lineWidth = 5; a.setLineDash([16, 12]);
    a.beginPath(); a.roundRect(cx - logoW / 2, y, logoW, logoH, 18); a.stroke();
    a.setLineDash([]); a.globalAlpha = 0.85; a.fillStyle = ink; a.font = `600 ${Math.round(Math.min(AW * 0.052 * s, logoH * 0.3))}px "Hanken Grotesk", sans-serif`;
    a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillText('YOUR LOGO', cx, y + logoH / 2); a.restore();
  }
  y += logoH;
  a.fillStyle = ink; a.textAlign = 'center'; a.textBaseline = 'top';
  if (d.text1) { y += gap; a.font = `700 ${size1}px "Hanken Grotesk", sans-serif`; a.fillText(d.text1, cx, y); y += size1; }
  if (d.text2) { y += gap * 0.55; a.font = `500 ${size2}px "Hanken Grotesk", sans-serif`; a.fillText(d.text2, cx, y); }
}

/** Where the artwork sits on the artboard: filling it (cover) or all of it inside (contain), then scaled and moved. */
export function artworkBox(B, d) {
  const img = d.artwork;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const base = d.fit === 'contain' ? Math.min(B.AW / iw, B.AH / ih) : Math.max(B.AW / iw, B.AH / ih);
  const w = iw * base * d.scale, h = ih * base * d.scale;
  return { x: (B.AW - w) / 2 + d.dx, y: (B.AH - h) / 2 + d.dy, w, h };
}
function drawArtwork(B, d) {
  const { art, AW, AH } = B, a = art.getContext('2d');
  a.clearRect(0, 0, AW, AH);
  if (!d.artwork) {
    // before an upload: the whole print area, outlined, is where the artwork goes
    if (d.placeholder === false) return;
    const ink = INKS.teal[1];
    a.save(); a.strokeStyle = ink; a.globalAlpha = 0.6; a.lineWidth = 6; a.setLineDash([18, 12]);
    a.strokeRect(10, 10, AW - 20, AH - 20);
    a.setLineDash([]); a.globalAlpha = 0.85; a.fillStyle = ink; a.textAlign = 'center'; a.textBaseline = 'middle';
    a.font = `700 ${Math.round(Math.min(AW * 0.075, AH * 0.08))}px "Hanken Grotesk", sans-serif`;
    a.fillText('YOUR ARTWORK', AW / 2, AH / 2 - AW * 0.035);
    a.font = `500 ${Math.round(Math.min(AW * 0.038, AH * 0.04))}px "Hanken Grotesk", sans-serif`;
    a.fillText('fills this print area', AW / 2, AH / 2 + AW * 0.045);
    a.restore();
    return;
  }
  const r = artworkBox(B, d);
  a.imageSmoothingQuality = 'high';
  a.drawImage(d.artwork, r.x, r.y, r.w, r.h);
}

/* ---------------- perspective warp ---------------- */
const COLS = 10, ROWS = 12;
function triangle(g, img, s0, s1, s2, d0, d1, d2) {
  // grow the clip slightly from its centre so neighbouring triangles meet
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => { const vx = p[0] - cx, vy = p[1] - cy, l = Math.hypot(vx, vy) || 1; return [p[0] + vx / l * 0.8, p[1] + vy / l * 0.8]; };
  const [e0, e1, e2] = [grow(d0), grow(d1), grow(d2)];
  const ux1 = s1[0] - s0[0], uy1 = s1[1] - s0[1], ux2 = s2[0] - s0[0], uy2 = s2[1] - s0[1];
  const vx1 = d1[0] - d0[0], vy1 = d1[1] - d0[1], vx2 = d2[0] - d0[0], vy2 = d2[1] - d0[1];
  const det = ux1 * uy2 - ux2 * uy1;
  if (!det) return;
  const a = (vx1 * uy2 - vx2 * uy1) / det, c = (vx2 * ux1 - vx1 * ux2) / det;
  const b = (vy1 * uy2 - vy2 * uy1) / det, d = (vy2 * ux1 - vy1 * ux2) / det;
  const e = d0[0] - (a * s0[0] + c * s0[1]), f = d0[1] - (b * s0[0] + d * s0[1]);
  g.save();
  g.beginPath(); g.moveTo(...e0); g.lineTo(...e1); g.lineTo(...e2); g.closePath(); g.clip();
  g.setTransform(a, b, c, d, e, f);
  const minX = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 2), minY = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 2);
  const maxX = Math.min(img.width, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 2), maxY = Math.min(img.height, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 2);
  if (maxX > minX && maxY > minY) g.drawImage(img, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
  g.restore();
}

let print = null, shaded = null;
const sized = (c, w, h) => { if (!c) return makeCanvas(w, h); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; };
function warp(B) {
  print = sized(print, B.cw, B.ch);
  const g = print.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, B.cw, B.ch);
  const pts = [];
  for (let r = 0; r <= ROWS; r++) { pts[r] = []; for (let c = 0; c <= COLS; c++) pts[r][c] = B.H.fwd(c / COLS, r / ROWS); }
  const sx = B.AW / COLS, sy = B.AH / ROWS;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const s00 = [c * sx, r * sy], s10 = [(c + 1) * sx, r * sy], s01 = [c * sx, (r + 1) * sy], s11 = [(c + 1) * sx, (r + 1) * sy];
    triangle(g, B.art, s00, s10, s11, pts[r][c], pts[r][c + 1], pts[r + 1][c + 1]);
    triangle(g, B.art, s00, s11, s01, pts[r][c], pts[r + 1][c + 1], pts[r + 1][c]);
  }
  // keep the print on the panel
  g.globalCompositeOperation = 'destination-in'; g.fill(B.poly);
  g.globalCompositeOperation = 'source-over';
  return print;
}

/** Draw the finished mockup. The canvas is resized to the product photo's proportions. */
export function render(ctx, B, design) {
  const canvas = ctx.canvas;
  if (canvas.width !== B.cw || canvas.height !== B.ch) { canvas.width = B.cw; canvas.height = B.ch; }
  drawArt(B, design);
  const pr = warp(B);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(B.photo, 0, 0);
  if (design.mode !== 'artwork' && design.ink === 'white') {
    ctx.globalAlpha = 0.93; ctx.drawImage(pr, 0, 0); ctx.globalAlpha = 1;
    shaded = sized(shaded, B.cw, B.ch);
    const s = shaded.getContext('2d');
    s.globalCompositeOperation = 'source-over'; s.clearRect(0, 0, B.cw, B.ch); s.drawImage(pr, 0, 0);
    s.globalCompositeOperation = 'source-in'; s.drawImage(B.shade, 0, 0);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(shaded, 0, 0);
  } else {
    // full-colour artwork is multiplied in whole, so the paper's grain and folds show through it
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = design.mode === 'artwork' ? 1 : 0.94; ctx.drawImage(pr, 0, 0);
  }
  ctx.restore();
}

/** Canvas point to artboard point, for dragging the design. */
export function toArtboard(B, x, y) {
  const [u, v] = B.H.back(x, y);
  return [u * B.AW, v * B.AH];
}
/** A dragged offset settles on a centre line within 2.5% of the panel width of it. */
export function snapDesign(B, dx, dy) {
  const near = B.AW * 0.025;
  const x = Math.abs(dx) < near, y = Math.abs(dy) < near;
  return { dx: x ? 0 : dx, dy: y ? 0 : dy, x, y };
}
/** The printable panel's centre lines in perspective, shown while a drag is snapped to them. */
export function drawGuides(ctx, B, guides, color, mode = 'brand') {
  if (!guides || (!guides.x && !guides.y)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(...B.H.fwd(...a)); ctx.lineTo(...B.H.fwd(...b)); ctx.stroke(); };
  if (guides.x) line([0.5, 0.02], [0.5, 0.98]);
  // the design's resting height, the same one drawArt centres it on
  // (artwork is centred on the whole panel)
  if (guides.y) { const v = mode === 'artwork' ? 0.5 : B.safeTop + (1 - B.safeTop) * 0.44; line([0.02, v], [0.98, v]); }
  ctx.restore();
}
export function clampDesign(B, d) {
  // artwork may be moved further, up to half the panel, to choose which part shows
  const k = d.mode === 'artwork' ? 0.5 : 0.34;
  const lx = B.AW * k, ly = B.AH * k;
  d.dx = Math.max(-lx, Math.min(lx, d.dx)); d.dy = Math.max(-ly, Math.min(ly, d.dy));
}

/** The finished mockup as a PNG or JPG Blob. */
export async function exportImage(B, design, { type = 'png', scale = 1 } = {}) {
  let out = makeCanvas(B.cw, B.ch);
  render(out.getContext('2d'), B, design);
  if (scale !== 1) {
    const small = makeCanvas(Math.round(B.cw * scale), Math.round(B.ch * scale));
    const o = small.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(out, 0, 0, small.width, small.height);
    out = small;
  }
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be created.'))), type === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
}

/**
 * A product's size by id, as { id, label, dims }. Products carry their own sizes
 * (set in the admin); a product without any uses the three original bag sizes.
 * dims is '' when the packaging team has not entered measurements yet.
 */
export function sizesOf(p) {
  const own = Array.isArray(p?.sizes) ? p.sizes.filter((s) => s && s.id && s.label) : [];
  if (own.length) return own.map((s) => ({ id: s.id, label: s.label, w: s.w, d: s.d, h: s.h, minOrder: s.minOrder ?? null, dims: s.w && s.h ? `${[s.w, s.d, s.h].filter(Boolean).join(' x ')} cm` : '' }));
  return Object.entries(SIZES).map(([id, s]) => { const [w, d, h] = s.dims.match(/[\d.]+/g).map(Number); return { id, label: s.label, w, d, h, minOrder: null, dims: s.dims }; });
}
export function sizeOf(p, id) {
  const all = sizesOf(p);
  return all.find((s) => s.id === id) || all.find((s) => s.id === 'medium') || all[0];
}

/** "Pizza boxes" -> "pizza box", "Flat handle bags" -> "flat handle bag". */
export const singular = (name) => String(name || '').toLowerCase().replace(/(x|ch|sh|ss)es$/, '$1').replace(/([^s])s$/, '$1');

export function specLine(p, design) {
  const s = sizeOf(p, design.size);
  const print = design.mode === 'artwork' ? 'your artwork in full colour' : `${(INKS[design.ink]?.[0] || 'black').toLowerCase()} ink`;
  return `${s.label} ${singular(p?.name || 'kraft bags')}${s.dims ? `, ${s.dims}` : ''}, ${print}`;
}

/**
 * What to tell someone about their artwork on this product: the shape of the print
 * area, the pixel size that prints sharp (when the bag's width and height are
 * known), and anything that will not come out as they expect.
 */
export function artworkAdvice(p, B, design) {
  const ratio = B.AW / B.AH;
  const shape = Math.abs(ratio - 1) < 0.06 ? 'square' : ratio < 1 ? 'portrait (taller than wide)' : 'landscape (wider than tall)';
  const s = sizeOf(p, design.size);
  const bag = /bag/i.test(p?.name || '') && s.w && s.h;
  const px = (cm) => Math.round((cm / 2.54) * 300);
  const out = { shape, size: bag ? `Front panel about ${s.w} x ${s.h} cm: ${px(s.w).toLocaleString('en-US')} x ${px(s.h).toLocaleString('en-US')} px prints sharp.` : '', warnings: [] };
  const img = design.artwork;
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const ir = iw / ih;
    if (design.fit !== 'contain' && Math.abs(Math.log(ir / ratio)) > 0.15) {
      out.warnings.push(ir > ratio ? 'Your artwork is wider than the print area, so its left and right edges are cut off. Choose "Show all of it" to see the whole page.' : 'Your artwork is taller than the print area, so its top and bottom are cut off. Choose "Show all of it" to see the whole page.');
    }
    if (bag && !/svg/i.test(img.src || '') && iw < px(s.w) * 0.5) out.warnings.push(`At ${iw.toLocaleString('en-US')} px wide it may print soft at this size. A larger export, or a PDF sent with your request, prints sharper.`);
  }
  return out;
}

export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
