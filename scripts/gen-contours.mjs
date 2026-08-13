// Fetch a real SRTM elevation grid over Burayu (Olira's facility) and trace
// true topographic contour lines with marching squares. Output = SVG path data
// baked into a JSON file, so the site ships real terrain with no runtime API.
import fs from 'node:fs';

const CENTER = { lat: 9.05, lng: 38.62 }; // Burayu, Oromia — west of Addis Ababa
const HALF = 0.16;                        // ~±18 km box
const N = 32;                             // grid resolution (N x N)
const OUT = process.argv[2] || 'burayu-contours.json';

const lats = []; // north (top) -> south
const lngs = [];
for (let i = 0; i < N; i++) {
  // row 0 = north (max lat) so it maps to the TOP of the SVG
  lats.push(CENTER.lat + HALF - (2 * HALF * i) / (N - 1));
  lngs.push(CENTER.lng - HALF + (2 * HALF * i) / (N - 1));
}

// Build the list of points row-major.
const pts = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) pts.push([lats[r], lngs[c]]);

async function fetchBatch(batch) {
  const loc = batch.map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join('|');
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${loc}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return j.results.map(r => r.elevation);
  }
  throw new Error('rate limited');
}

console.error(`Fetching ${pts.length} elevations in batches of 100…`);
const elev = [];
for (let i = 0; i < pts.length; i += 100) {
  const vals = await fetchBatch(pts.slice(i, i + 100));
  elev.push(...vals);
  console.error(`  ${Math.min(i + 100, pts.length)}/${pts.length}`);
  await new Promise(r => setTimeout(r, 1100)); // respect ~1 req/sec
}

// grid[r][c]
const grid = [];
for (let r = 0; r < N; r++) grid.push(elev.slice(r * N, r * N + N));

const flat = elev.filter(v => v != null).sort((a, b) => a - b);
const q = p => flat[Math.floor(p * (flat.length - 1))];
const lo = q(0.06), hi = q(0.94);
const LEVELS = 10;
const levels = Array.from({ length: LEVELS }, (_, k) => lo + ((hi - lo) * k) / (LEVELS - 1));

// Marching squares -> line segments per level. Coordinates normalised to 0..1000.
const SIZE = 1000;
const gx = c => (c / (N - 1)) * SIZE;
const gy = r => (r / (N - 1)) * SIZE;
const lerp = (a, b, t) => a + (b - a) * t;

function segmentsForLevel(L) {
  const segs = [];
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const tl = grid[r][c], tr = grid[r][c + 1], br = grid[r + 1][c + 1], bl = grid[r + 1][c];
      if ([tl, tr, br, bl].some(v => v == null)) continue;
      let idx = 0;
      if (tl > L) idx |= 8;
      if (tr > L) idx |= 4;
      if (br > L) idx |= 2;
      if (bl > L) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      // edge crossing points (interpolated)
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
        case 6: case 9:  push(top(), bottom()); break;
        case 7: case 8:  push(left(), top()); break;
        case 5:  push(left(), top()); push(bottom(), right()); break;
        case 10: push(left(), bottom()); push(top(), right()); break;
      }
    }
  }
  return segs;
}

const out = levels.map((L, i) => {
  const segs = segmentsForLevel(L);
  // one path per level: many M x y L x y subpaths
  const d = segs.map(s => `M${s[0].toFixed(1)} ${s[1].toFixed(1)}L${s[2].toFixed(1)} ${s[3].toFixed(1)}`).join('');
  return { level: Math.round(L), rank: i / (LEVELS - 1), d, count: segs.length };
}).filter(p => p.count > 0);

fs.writeFileSync(OUT, JSON.stringify({
  place: 'Burayu, Oromia, Ethiopia',
  center: CENTER, box: HALF, grid: N, size: SIZE,
  elevationRange: [flat[0], flat[flat.length - 1]],
  levels: out
}, null, 0));
console.error(`Wrote ${OUT}: ${out.length} contour levels, elevation ${flat[0]}–${flat[flat.length - 1]}m`);
