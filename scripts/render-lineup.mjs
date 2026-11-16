// Makes the still renders of the packaging line-up (src/lib/panels.ts, LINEUP):
// the pictures the home page and the packaging page show at once, before the live
// 3D (src/scripts/package-3d/lineup3d.js) takes over on hover. They are drawn by
// that same code in a browser, so the live 3D replaces them without a jump.
//
//   node scripts/render-lineup.mjs
//
// Writes public/images/lineup/<id>-olira.webp (printed with Olira's logo, for the
// home page) and <id>-brand.webp ("YOUR BRAND", for the packaging page), and
// src/lib/lineup-renders.json (each product's share of the row, its proportions and
// where its picture reaches past it). Run it after changing LINEUP, then build.
// Needs Playwright (not a site dependency): `npm i --no-save playwright`, or set
// PLAYWRIGHT to the path of its index.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/images/lineup');
const MANIFEST = path.join(ROOT, 'src/lib/lineup-renders.json');
const WIDE = 888;  // the row's widest drawn width in CSS pixels (a 1920 px screen's packaging panel)
const SCALE = 2;   // pixels per CSS pixel in the stills
const GAP = 4;     // the row's gap, % of its width (sheet.css .door-pack .lineup)

async function playwright() {
  const tries = [process.env.PLAYWRIGHT && pathToFileURL(process.env.PLAYWRIGHT).href, 'playwright', 'file:///C:/Olira/olira-v2/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const t of tries) { try { return await import(t); } catch (e) { /* next */ } }
  throw new Error('Playwright not found: npm i --no-save playwright, or set PLAYWRIGHT to its index.mjs');
}

const harness = `
import { LINEUP } from ${JSON.stringify(path.join(ROOT, 'src/lib/panels.ts'))};
import { createLineup } from ${JSON.stringify(path.join(ROOT, 'src/scripts/package-3d/lineup3d.js'))};
window.render = async ({ wide, scale, gap }) => {
  await document.fonts.load('700 40px Inter');
  const logo = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = '/logo.png'; });
  const L = createLineup();
  const frames = LINEUP.map((s) => ({ id: s.id, ...L.add(s) }));
  const total = frames.reduce((a, f) => a + f.units, 0);
  const room = 100 - gap * (frames.length - 1);
  const items = {}, images = {};
  for (const f of frames) {
    const w = +(f.units / total * room).toFixed(2);
    const cw = w / 100 * wide * scale, pw = Math.round(cw * f.box.w), ph = Math.round(cw / f.ratio * f.box.h);
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const r4 = (x) => +x.toFixed(4);
    items[f.id] = { w, ratio: r4(f.ratio), box: { l: r4(f.box.l), t: r4(f.box.t), w: r4(f.box.w), h: r4(f.box.h) }, px: [pw, ph] };
    for (const [print, look] of [['olira', { logo }], ['brand', { logo: null, logoText: 'YOUR BRAND' }]]) {
      L.paint(look, [f.id]); L.draw(f.id, c);
      images[f.id + '-' + print] = c.toDataURL('image/png');
    }
  }
  return { items, images };
};`;

const bundle = await build({
  stdin: { contents: harness, resolveDir: ROOT, loader: 'js' },
  bundle: true, format: 'iife', write: false, logLevel: 'silent',
});
const js = bundle.outputFiles[0].text;
const html = '<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@700&display=block" rel="stylesheet"></head><body><script src="/bundle.js"></script></body></html>';

const { chromium } = await playwright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[page]', e.message));
await page.route('http://lineup.local/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: js });
  if (u.pathname === '/logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'public/logo.png')) });
  return route.fulfill({ contentType: 'text/html', body: html });
});
await page.goto('http://lineup.local/');
const { items, images } = await page.evaluate((o) => window.render(o), { wide: WIDE, scale: SCALE, gap: GAP });
await browser.close();

fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [name, url] of Object.entries(images)) {
  const file = path.join(OUT, `${name}.webp`);
  await sharp(Buffer.from(url.split(',')[1], 'base64')).webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(file);
  bytes += fs.statSync(file).size;
}
fs.writeFileSync(MANIFEST, JSON.stringify({ wide: WIDE, scale: SCALE, items }, null, 2) + '\n');
console.log(`render-lineup: ${Object.keys(images).length} stills, ${Math.round(bytes / 1024)} kB, in public/images/lineup; ${path.relative(ROOT, MANIFEST)}`);
for (const [id, it] of Object.entries(items)) console.log(`  ${id.padEnd(11)} w ${String(it.w).padEnd(6)} ratio ${String(it.ratio).padEnd(7)} picture ${it.box.w}x${it.box.h} of it, ${it.px.join('x')} px`);
