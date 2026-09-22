// Reads an uploaded logo the way a printer would, before the customer finds out
// on the bag. Two problems are common and both are visible in the pixels:
//
//  boxed  the logo sits on a solid light rectangle (usually a JPG). Printed, the
//         rectangle is a patch of ink or a pale box on the kraft.
//  light  the mark itself is very pale. Printed on kraft it all but disappears.
//
// Both come with a fix the studio can apply: remove the box, or print the logo in
// the chosen ink colour.
import { makeCanvas } from './engine.js';

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function checkLogo(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, 256 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  const c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const at = (x, y) => { const o = (y * w + x) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]]; };

  // corners: all opaque, all alike and light means the logo is on a box
  const corners = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]].map(([x, y]) => at(Math.max(0, x), Math.max(0, y)));
  const opaque = corners.every((p) => p[3] > 245);
  const bg = [0, 1, 2].map((i) => corners.reduce((sum, p) => sum + p[i], 0) / 4);
  const alike = corners.every((p) => Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - bg[i]))) < 24);
  const boxed = opaque && alike && lum(...bg) > 0.8;

  // the mark: opaque pixels that are not the box colour
  let sum = 0, n = 0;
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] < 128) continue;
    if (boxed && Math.max(Math.abs(px[o] - bg[0]), Math.abs(px[o + 1] - bg[1]), Math.abs(px[o + 2] - bg[2])) < 40) continue;
    sum += lum(px[o], px[o + 1], px[o + 2]); n++;
  }
  const markShare = n / (w * h);
  const light = n > 0 && sum / n > 0.78;
  return { boxed, light, bg, empty: markShare < 0.002 };
}

/** The logo with its box colour made transparent, feathered at the edges. */
export function removeBox(img, bg) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, 2000 / Math.max(iw, ih));
  const w = Math.round(iw * s), h = Math.round(ih * s);
  const c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h), px = data.data;
  const near = 18, far = 64;
  for (let o = 0; o < px.length; o += 4) {
    const dist = Math.max(Math.abs(px[o] - bg[0]), Math.abs(px[o + 1] - bg[1]), Math.abs(px[o + 2] - bg[2]));
    if (dist >= far) continue;
    px[o + 3] = Math.round(px[o + 3] * Math.max(0, (dist - near) / (far - near)));
  }
  g.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => {
    const out = new Image();
    out.onload = () => resolve(out);
    out.onerror = () => reject(new Error('The logo could not be cleaned up.'));
    out.src = c.toDataURL('image/png');
  });
}
