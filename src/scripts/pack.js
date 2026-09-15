// Packaging page: the kraft paper bag mockup studio.
//
// Built the way a Photoshop smart-object mockup works, on real photographs:
//   1. base     a photo of a kraft bag (Pexels License, see PHOTO_CREDITS.md)
//   2. design   logo and text laid out on a flat artboard the shape of the
//               bag's front panel
//   3. warp     the artboard is bent into the panel's measured corners with a
//               perspective (homography) mesh, so the print follows the photo
//   4. blend    coloured ink is multiplied into the paper, so fibres, creases
//               and shadows show through; white ink is laid on top and then
//               shaded by the photo's own light
// To use Olira's own bag photography later, add a photo and its four panel
// corners to BAGS; nothing else changes.
import { $, $$, h, prefill, track } from './common.js';

// designer use, for the admin insights: counted once per page view except downloads and quotes
let changedOnce = false;
const noteChange = () => { if (!changedOnce) { changedOnce = true; track({ event: 'studio_change' }); } };

const CW = 1000, CH = 1400;                      // output canvas
const canvas = $('#bagCanvas');
const ctx = canvas.getContext('2d');
const make = (w, hgt) => { const c = document.createElement('canvas'); c.width = w; c.height = hgt; return c; };

// Corners of the front panel and the crop, in thousandths of the photo width.
const BAGS = {
  twisted: { src: '/images/packaging/bag-twisted-1400.webp', crop: { x: 0, y: 20, w: 1000 },
    quad: [[118, 412], [789, 421], [803, 1389], [114, 1257]], safeTop: 0.13 },
  flat: { src: '/images/packaging/bag-flat-1400.webp', crop: { x: 90, y: 200, w: 800 },
    quad: [[211, 549], [757, 581], [719, 1203], [188, 1142]], safeTop: 0.1 },
};
// Indicative standard sizes, width x gusset x height. Confirmed to order.
const SIZES = {
  small: { label: 'Small', dims: '18 x 8 x 22 cm' },
  medium: { label: 'Medium', dims: '25 x 11 x 32 cm' },
  large: { label: 'Large', dims: '32 x 12 x 42 cm' },
};
const INKS = { black: ['Black', '#1E1B16'], teal: ['Teal', '#186078'], leaf: ['Leaf green', '#4A5E17'], red: ['Red', '#A3301E'], white: ['White', '#FAF7F0'] };

const state = { size: 'medium', handle: 'twisted', ink: 'teal', logo: null, logoName: '', oneInk: false, text1: 'YOUR BRAND', text2: 'yourbrand.com', scale: 1, dx: 0, dy: 0 };
const param = new URLSearchParams(location.search).get('handle');
if (BAGS[param]) state.handle = param;

/* ---------------- geometry ---------------- */
function homography(q) {
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

const bags = {};
function prepare(key) {
  if (bags[key]) return bags[key];
  bags[key] = new Promise((resolve, reject) => {
    const spec = BAGS[key], img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const k = img.naturalWidth / 1000, s = CW / spec.crop.w;
      const quad = spec.quad.map(([x, y]) => [(x - spec.crop.x) * s, (y - spec.crop.y) * s]);
      const photo = make(CW, CH), p = photo.getContext('2d');
      p.fillStyle = '#E9E3D6'; p.fillRect(0, 0, CW, CH);
      p.drawImage(img, spec.crop.x * k, spec.crop.y * k, spec.crop.w * k, spec.crop.w * k * CH / CW, 0, 0, CW, CH);
      // artboard in the panel's proportions
      const wTop = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]), wBot = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
      const hL = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]), hR = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
      const AW = 1000, AH = Math.round(AW * ((hL + hR) / (wTop + wBot)));
      // the photo's own light, normalised so the average paper tone is white:
      // used to shade white ink, which cannot be multiplied
      const data = p.getImageData(0, 0, CW, CH), px = data.data;
      const H = homography(quad);
      let sum = 0, n = 0;
      for (let v = 0.15; v < 0.95; v += 0.05) for (let u = 0.1; u < 0.9; u += 0.05) {
        const [x, y] = H.fwd(u, v), o = (Math.round(y) * CW + Math.round(x)) * 4;
        sum += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; n++;
      }
      const mean = sum / n * 1.06;
      const shade = make(CW, CH), sd = shade.getContext('2d').createImageData(CW, CH), q = sd.data;
      for (let o = 0; o < px.length; o += 4) {
        const L = Math.min(255, 255 * (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / mean);
        q[o] = q[o + 1] = q[o + 2] = L; q[o + 3] = 255;
      }
      shade.getContext('2d').putImageData(sd, 0, 0);
      const poly = new Path2D(); poly.moveTo(...quad[0]); quad.slice(1).forEach((pt) => poly.lineTo(...pt)); poly.closePath();
      resolve({ photo, shade, quad, H, poly, AW, AH, safeTop: spec.safeTop, art: make(AW, AH) });
    };
    img.onerror = reject;
    img.src = spec.src;
  });
  return bags[key];
}

/* ---------------- artboard ---------------- */
const tint = make(1, 1);
function drawArt(B) {
  const { art, AW, AH } = B, a = art.getContext('2d');
  a.clearRect(0, 0, AW, AH);
  const s = state.scale, ink = INKS[state.ink][1], maxW = AW * 0.84;
  let logoW, logoH;
  if (state.logo) {
    const ratio = state.logo.width / state.logo.height;
    logoW = Math.min(AW * 0.56 * s, maxW); logoH = logoW / ratio;
    if (logoH > AH * 0.32 * s) { logoH = AH * 0.32 * s; logoW = logoH * ratio; }
  } else { logoW = AW * 0.44 * s; logoH = AW * 0.26 * s; }
  let size1 = AW * 0.135 * s;
  a.font = `700 ${size1}px "Hanken Grotesk", sans-serif`;
  const w1 = a.measureText(state.text1).width; if (w1 > maxW) size1 *= maxW / w1;
  let size2 = Math.min(AW * 0.062 * s, size1 * 0.62);
  a.font = `500 ${size2}px "Hanken Grotesk", sans-serif`;
  const w2 = a.measureText(state.text2).width; if (w2 > maxW) size2 *= maxW / w2;
  const gap = AW * 0.06 * s;
  const total = logoH + (state.text1 ? gap + size1 : 0) + (state.text2 ? gap * 0.55 + size2 : 0);
  const cx = AW / 2 + state.dx;
  let y = AH * (B.safeTop + (1 - B.safeTop) * 0.44) + state.dy - total / 2;

  if (state.logo) {
    if (state.oneInk) {
      tint.width = Math.max(1, Math.round(logoW)); tint.height = Math.max(1, Math.round(logoH));
      const t = tint.getContext('2d');
      t.drawImage(state.logo, 0, 0, tint.width, tint.height);
      t.globalCompositeOperation = 'source-in'; t.fillStyle = ink; t.fillRect(0, 0, tint.width, tint.height);
      a.drawImage(tint, cx - logoW / 2, y, logoW, logoH);
    } else a.drawImage(state.logo, cx - logoW / 2, y, logoW, logoH);
  } else {
    a.save(); a.strokeStyle = ink; a.globalAlpha = 0.65; a.lineWidth = 5; a.setLineDash([16, 12]);
    a.beginPath(); a.roundRect(cx - logoW / 2, y, logoW, logoH, 18); a.stroke();
    a.setLineDash([]); a.globalAlpha = 0.85; a.fillStyle = ink; a.font = `600 ${Math.round(AW * 0.052 * s)}px "Hanken Grotesk", sans-serif`;
    a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillText('YOUR LOGO', cx, y + logoH / 2); a.restore();
  }
  y += logoH;
  a.fillStyle = ink; a.textAlign = 'center'; a.textBaseline = 'top';
  if (state.text1) { y += gap; a.font = `700 ${size1}px "Hanken Grotesk", sans-serif`; a.fillText(state.text1, cx, y); y += size1; }
  if (state.text2) { y += gap * 0.55; a.font = `500 ${size2}px "Hanken Grotesk", sans-serif`; a.fillText(state.text2, cx, y); }
}

/* ---------------- perspective warp ---------------- */
const print = make(CW, CH), pctx = print.getContext('2d');
const shaded = make(CW, CH), sctx = shaded.getContext('2d');
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
  g.drawImage(img, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
  g.restore();
}

function warp(B) {
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.clearRect(0, 0, CW, CH);
  const pts = [];
  for (let r = 0; r <= ROWS; r++) { pts[r] = []; for (let c = 0; c <= COLS; c++) pts[r][c] = B.H.fwd(c / COLS, r / ROWS); }
  const sx = B.AW / COLS, sy = B.AH / ROWS;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const s00 = [c * sx, r * sy], s10 = [(c + 1) * sx, r * sy], s01 = [c * sx, (r + 1) * sy], s11 = [(c + 1) * sx, (r + 1) * sy];
    triangle(pctx, B.art, s00, s10, s11, pts[r][c], pts[r][c + 1], pts[r + 1][c + 1]);
    triangle(pctx, B.art, s00, s11, s01, pts[r][c], pts[r + 1][c + 1], pts[r + 1][c]);
  }
  // keep the print on the panel
  pctx.globalCompositeOperation = 'destination-in'; pctx.fill(B.poly); pctx.globalCompositeOperation = 'source-over';
}

let current = null, pending = 0;
async function render() {
  const id = ++pending;
  const B = await prepare(state.handle);
  if (id !== pending) return;
  current = B;
  drawArt(B); warp(B);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(B.photo, 0, 0);
  if (state.ink === 'white') {
    ctx.globalAlpha = 0.93; ctx.drawImage(print, 0, 0); ctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over'; sctx.clearRect(0, 0, CW, CH); sctx.drawImage(print, 0, 0);
    sctx.globalCompositeOperation = 'source-in'; sctx.drawImage(B.shade, 0, 0);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(shaded, 0, 0);
  } else {
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.94; ctx.drawImage(print, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  $('#stageInfo').textContent = specLine();
}

function specLine() {
  const s = SIZES[state.size];
  return `${s.label} bag, ${state.handle} handles, ${s.dims}, ${INKS[state.ink][0].toLowerCase()} ink`;
}
const live = $('#studioStatus');
let liveTimer = 0;
function announce(msg) {
  // clear first so repeating the same sentence is still read out
  clearTimeout(liveTimer); live.textContent = '';
  liveTimer = setTimeout(() => { live.textContent = msg; }, 60);
}

/* ---------------- controls ---------------- */
function syncRadios() {
  for (const [name, val] of [['size', state.size], ['handle', state.handle], ['ink', state.ink]]) {
    const r = $(`input[name="${name}"][value="${val}"]`); if (r) r.checked = true;
  }
}
for (const name of ['size', 'handle', 'ink']) {
  $$(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    state[name] = r.value;
    if (name === 'handle') { state.dx = 0; state.dy = 0; }
    render(); announce(`Preview updated. ${specLine()}.`); noteChange();
  }));
}
$('#text1').addEventListener('input', (e) => { state.text1 = e.target.value; render(); noteChange(); });
$('#text2').addEventListener('input', (e) => { state.text2 = e.target.value; render(); });
$('#scale').addEventListener('input', (e) => { state.scale = +e.target.value / 100; e.target.setAttribute('aria-valuetext', `${e.target.value} percent`); render(); });
$('#scale').addEventListener('change', (e) => announce(`Design size ${e.target.value}%.`));
$('#oneInk').addEventListener('change', (e) => { state.oneInk = e.target.checked; render(); announce(e.target.checked ? 'Logo printed in the ink colour.' : 'Logo printed in its own colours.'); });

function loadLogo(file) {
  const sub = $('#dropSub');
  if (!file || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { sub.textContent = 'Please choose a PNG, JPG, SVG or WebP image.'; announce(sub.textContent); return; }
  if (file.size > 8 * 1024 * 1024) { sub.textContent = 'That file is over 8 MB. Try a smaller export.'; announce(sub.textContent); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    state.logo = img; state.logoName = file.name;
    $('#dropTitle').textContent = file.name; sub.textContent = 'Choose or drop another file to replace it.';
    $('#removeLogo').hidden = false; render(); announce(`Logo added: ${file.name}. It is on the bag preview.`);
    track({ event: 'studio_logo' });
  };
  img.onerror = () => { sub.textContent = 'That image could not be read. Try a PNG.'; announce(sub.textContent); URL.revokeObjectURL(url); };
  img.src = url;
}
$('#logoFile').addEventListener('change', (e) => loadLogo(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => loadLogo(e.dataTransfer.files[0]));
$('#removeLogo').addEventListener('click', () => {
  state.logo = null; state.logoName = ''; $('#logoFile').value = ''; $('#dropTitle').textContent = 'Upload a logo';
  $('#dropSub').textContent = 'PNG, JPG, SVG or WebP. Transparent PNG looks best.'; $('#removeLogo').hidden = true;
  render(); announce('Logo removed.'); $('#logoFile').focus();
});

/* moving the design: drag on the bag, arrow keys on the preview, or the buttons */
const clampPos = () => {
  if (!current) return;
  const lx = current.AW * 0.34, ly = current.AH * 0.34;
  state.dx = Math.max(-lx, Math.min(lx, state.dx)); state.dy = Math.max(-ly, Math.min(ly, state.dy));
};
function move(x, y, say) { state.dx += x; state.dy += y; clampPos(); render(); if (say) announce(say); }

let drag = null;
const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * CW / r.width, (e.clientY - r.top) * CH / r.height]; };
const toArt = (p) => { const [u, v] = current.H.back(...p); return [u * current.AW, v * current.AH]; };
canvas.addEventListener('pointerdown', (e) => {
  if (!current) return;
  const p = toCanvas(e);
  if (!ctx.isPointInPath(current.poly, p[0], p[1])) return;
  const a = toArt(p);
  drag = { a, dx: state.dx, dy: state.dy };
  canvas.setPointerCapture(e.pointerId); canvas.classList.add('is-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const a = toArt(toCanvas(e));
  state.dx = drag.dx + a[0] - drag.a[0]; state.dy = drag.dy + a[1] - drag.a[1]; clampPos(); render();
});
const endDrag = () => { if (!drag) return; drag = null; canvas.classList.remove('is-dragging'); announce('Design moved.'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 60 : 15;
  const m = { ArrowLeft: [-step, 0, 'left'], ArrowRight: [step, 0, 'right'], ArrowUp: [0, -step, 'up'], ArrowDown: [0, step, 'down'] }[e.key];
  if (!m) return;
  e.preventDefault(); move(m[0], m[1], `Design moved ${m[2]}.`);
});
$$('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
  const dir = b.dataset.nudge;
  const m = { left: [-30, 0], right: [30, 0], up: [0, -30], down: [0, 30] }[dir];
  move(m[0], m[1], `Design moved ${dir}.`);
}));
$('#resetPos').addEventListener('click', () => { state.dx = 0; state.dy = 0; render(); announce('Design centred on the bag.'); });

$('#download').addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = h('a', { href: URL.createObjectURL(blob), download: `olira-kraft-bag-${state.handle}-${state.size}-mockup.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    announce('Mockup image downloaded.');
    track({ event: 'studio_download' });
  }, 'image/png');
});
$('#useDesign').addEventListener('click', () => {
  const s = SIZES[state.size];
  const form = $('#inquiry'); if (form) form.dataset.product = 'Kraft paper bags';
  track({ event: 'studio_quote' });
  prefill(`Quote for ${s.label.toLowerCase()} kraft paper bags with ${state.handle} handles (${s.dims}). Print: ${state.logo ? 'our logo' : 'logo to follow'}, "${state.text1}" and "${state.text2}", ${INKS[state.ink][0].toLowerCase()} ink${state.oneInk ? ', logo in one colour' : ''}.`);
});

syncRadios();
render().catch(() => { $('#stageInfo').textContent = 'The bag photo could not load. Refresh the page to try again.'; });
prepare(state.handle === 'twisted' ? 'flat' : 'twisted').catch(() => {});
document.fonts?.load('700 60px "Hanken Grotesk"').then(() => render()).catch(() => {});
