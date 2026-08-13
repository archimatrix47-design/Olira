// Fetch a real SRTM elevation grid over Burayu (Olira's facility) and trace
// smooth topographic contour lines: marching squares -> stitch segments into
// continuous polylines -> Chaikin corner-cutting for smooth curves. Output = SVG
// path data baked to JSON, so the site ships real terrain with no runtime API.
//
// The raw elevation grid is cached (burayu-grid.cache.json) so re-running to
// tweak smoothing doesn't re-hit the API.
import fs from 'node:fs';
import path from 'node:path';

const CENTER = { lat: 9.05, lng: 38.62 }; // Burayu, Oromia — west of Addis Ababa
const HALF = 0.16;                        // ~±18 km box
const N = 32;                             // grid resolution (N x N)
const OUT = process.argv[2] || 'src/data/burayu-contours.json';
const CACHE = path.join(path.dirname(OUT), 'burayu-grid.cache.json');

const lats = [], lngs = [];
for (let i = 0; i < N; i++) {
  lats.push(CENTER.lat + HALF - (2 * HALF * i) / (N - 1)); // row 0 = north = top
  lngs.push(CENTER.lng - HALF + (2 * HALF * i) / (N - 1));
}

async function fetchGrid() {
  if (fs.existsSync(CACHE)) {
    console.error('Using cached elevation grid.');
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  }
  const pts = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) pts.push([lats[r], lngs[c]]);
  const elev = [];
  console.error(`Fetching ${pts.length} elevations…`);
  for (let i = 0; i < pts.length; i += 100) {
    const loc = pts.slice(i, i + 100).map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join('|');
    let vals;
    for (let a = 0; a < 4; a++) {
      const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${loc}`);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      vals = (await res.json()).results.map(r => r.elevation); break;
    }
    elev.push(...vals);
    console.error(`  ${Math.min(i + 100, pts.length)}/${pts.length}`);
    await new Promise(r => setTimeout(r, 1100));
  }
  fs.writeFileSync(CACHE, JSON.stringify(elev));
  return elev;
}

const elev = await fetchGrid();
const grid = [];
for (let r = 0; r < N; r++) grid.push(elev.slice(r * N, r * N + N));

const flat = elev.filter(v => v != null).sort((a, b) => a - b);
const q = p => flat[Math.floor(p * (flat.length - 1))];
const LEVELS = 10;
const lo = q(0.06), hi = q(0.94);
const levels = Array.from({ length: LEVELS }, (_, k) => lo + ((hi - lo) * k) / (LEVELS - 1));

const SIZE = 1000;
const gx = c => (c / (N - 1)) * SIZE;
const gy = r => (r / (N - 1)) * SIZE;
const lerp = (a, b, t) => a + (b - a) * t;

function segmentsForLevel(L) {
  const segs = [];
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
    const tl = grid[r][c], tr = grid[r][c + 1], br = grid[r + 1][c + 1], bl = grid[r + 1][c];
    if ([tl, tr, br, bl].some(v => v == null)) continue;
    let idx = 0;
    if (tl > L) idx |= 8; if (tr > L) idx |= 4; if (br > L) idx |= 2; if (bl > L) idx |= 1;
    if (idx === 0 || idx === 15) continue;
    const top = () => [lerp(gx(c), gx(c + 1), (L - tl) / (tr - tl)), gy(r)];
    const right = () => [gx(c + 1), lerp(gy(r), gy(r + 1), (L - tr) / (br - tr))];
    const bottom = () => [lerp(gx(c), gx(c + 1), (L - bl) / (br - bl)), gy(r + 1)];
    const left = () => [gx(c), lerp(gy(r), gy(r + 1), (L - tl) / (bl - tl))];
    const push = (a, b) => segs.push([a[0], a[1], b[0], b[1]]);
    switch (idx) {
      case 1: case 14: push(left(), bottom()); break;
      case 2: case 13: push(bottom(), right()); break;
      case 3: case 12: push(left(), right()); break;
      case 4: case 11: push(top(), right()); break;
      case 6: case 9: push(top(), bottom()); break;
      case 7: case 8: push(left(), top()); break;
      case 5: push(left(), top()); push(bottom(), right()); break;
      case 10: push(left(), bottom()); push(top(), right()); break;
    }
  }
  return segs;
}

// Stitch independent segments into continuous polylines by joining shared
// endpoints (0.1px tolerance), so they can be smoothed as real lines.
function stitch(segs) {
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const map = new Map();
  segs.forEach((s, i) => {
    for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
      const k = key(x, y); if (!map.has(k)) map.set(k, []); map.get(k).push(i);
    }
  });
  const used = new Array(segs.length).fill(false);
  const lines = [];
  const findNext = (k) => (map.get(k) || []).find(j => !used[j]);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let pts = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (const atEnd of [true, false]) {
      while (true) {
        const [px, py] = atEnd ? pts[pts.length - 1] : pts[0];
        const k = key(px, py);
        const j = findNext(k);
        if (j == null) break;
        used[j] = true;
        const s = segs[j];
        const a = [s[0], s[1]], b = [s[2], s[3]];
        const next = key(a[0], a[1]) === k ? b : a;
        if (atEnd) pts.push(next); else pts.unshift(next);
      }
    }
    const closed = pts.length > 3 &&
      key(pts[0][0], pts[0][1]) === key(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (closed) pts.pop();
    lines.push({ pts, closed });
  }
  return lines;
}

// Chaikin corner-cutting: each pass replaces every corner with two points 1/4
// and 3/4 along its edges, converging to a smooth curve.
function chaikin(pts, iters, closed) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const np = [];
    const n = p.length;
    if (!closed) np.push(p[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = p[i], b = p[(i + 1) % n];
      np.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      np.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) np.push(p[n - 1]);
    p = np;
  }
  return p;
}

function polyLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

function toPath(pts, closed) {
  // Integer coords: the viewBox is 1000 units rendered at ~640px, so rounding
  // to whole units is sub-pixel — invisible, but ~35% smaller payload.
  let d = `M${Math.round(pts[0][0])} ${Math.round(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${Math.round(pts[i][0])} ${Math.round(pts[i][1])}`;
  if (closed) d += 'Z';
  return d;
}

const out = levels.map((L, i) => {
  const lines = stitch(segmentsForLevel(L))
    .filter(l => l.pts.length >= 3 && polyLength(l.pts) > 24) // drop tiny noise
    .map(l => ({ ...l, pts: chaikin(l.pts, 3, l.closed) }));
  const d = lines.map(l => toPath(l.pts, l.closed)).join('');
  return { level: Math.round(L), rank: i / (LEVELS - 1), d, lines: lines.length };
}).filter(p => p.lines > 0);

fs.writeFileSync(OUT, JSON.stringify({
  place: 'Burayu, Oromia, Ethiopia', center: CENTER, box: HALF, grid: N, size: SIZE,
  elevationRange: [flat[0], flat[flat.length - 1]], levels: out
}));
console.error(`Wrote ${OUT}: ${out.length} smoothed levels, ${flat[0]}–${flat[flat.length - 1]}m`);
