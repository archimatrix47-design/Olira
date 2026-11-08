// Real visitors' page speed (Core Web Vitals), as measured in their own browsers
// (src/scripts/vitals.js) and sent once per page view with the 'vitals' event.
// The server keeps no single measurement: each one only adds 1 to a bucket, per
// kind of page and kind of device, so a day holds at most 18 small histograms.
// From those the log reads the 75th percentile (Google's measure: three in four
// visits were at least this fast) and the share of visits within the "good" limit.

/** Bucket upper edges for each measure; the last bucket is "above the last edge". */
export const EDGES = {
  lcp: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000], // ms, largest contentful paint
  inp: [50, 100, 150, 200, 300, 500, 750, 1000], // ms, interaction to next paint
  cls: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5], // unitless, cumulative layout shift
  ttfb: [100, 200, 400, 600, 800, 1200, 1800, 3000], // ms, time to first byte
};
/** Google's "good" limits (web.dev/vitals): each is also a bucket edge, so the share is exact. */
export const GOOD = { lcp: 2500, inp: 200, cls: 0.1, ttfb: 800 };
/** ... and its "poor" limits: between the two is "needs improvement". */
export const POOR = { lcp: 4000, inp: 500, cls: 0.25, ttfb: 1800 };
const MAX = { lcp: 60000, inp: 10000, cls: 10, ttfb: 60000 };
export const METRICS = Object.keys(EDGES);
export const DEVICES = ['mobile', 'desktop', 'tablet'];
export const PAGE_GROUPS = ['home', 'agriculture', 'agriculture-product', 'packaging', 'packaging-product', 'other'];

/** The kind of page a path is, from the site's own structure. */
export function pageGroup(p) {
  if (p === '/' || p === '/index.html') return 'home';
  if (p === '/agriculture/' || p === '/agriculture') return 'agriculture';
  if (p === '/packaging/' || p === '/packaging') return 'packaging';
  if (/^\/agriculture\/[a-z0-9-]+\/?$/.test(p)) return 'agriculture-product';
  if (/^\/packaging\/[a-z0-9-]+\/?$/.test(p)) return 'packaging-product';
  return 'other';
}

/** One beacon's measures, each a finite number in range, or left out. Returns null when none is usable. */
export function cleanSample(body) {
  const out = {};
  for (const m of METRICS) {
    const v = Number(body?.[m]);
    if (body?.[m] !== undefined && body?.[m] !== null && body?.[m] !== '' && Number.isFinite(v) && v >= 0 && v <= MAX[m]) out[m] = v;
  }
  return Object.keys(out).length ? out : null;
}

const bucketOf = (m, v) => { const i = EDGES[m].findIndex((e) => v <= e); return i === -1 ? EDGES[m].length : i; };

/** Add one cleaned sample to a day's store: store[`${group}|${device}`] = { n, lcp: [...], ... }. */
export function addSample(store, group, device, sample) {
  const key = `${PAGE_GROUPS.includes(group) ? group : 'other'}|${DEVICES.includes(device) ? device : 'desktop'}`;
  const h = (store[key] ||= { n: 0 });
  h.n++;
  for (const [m, v] of Object.entries(sample)) {
    const arr = (h[m] ||= new Array(EDGES[m].length + 1).fill(0));
    arr[bucketOf(m, v)]++;
  }
  return store;
}

/** Sum histograms (days, or groups) into one. */
export function mergeInto(target, src) {
  for (const [key, h] of Object.entries(src || {})) {
    const t = (target[key] ||= { n: 0 });
    t.n += Number(h?.n) || 0;
    for (const m of METRICS) {
      if (!Array.isArray(h?.[m])) continue;
      const arr = (t[m] ||= new Array(EDGES[m].length + 1).fill(0));
      h[m].forEach((c, i) => { if (i < arr.length) arr[i] += Number(c) || 0; });
    }
  }
  return target;
}

/**
 * One measure's histogram read as the log reports it: samples, the 75th
 * percentile as "at most X" (the bucket's upper edge; null when above the last
 * edge, reported as "over X"), the share within "good", and Google's rating.
 */
export function readHistogram(m, counts) {
  const n = (counts || []).reduce((a, b) => a + b, 0);
  if (!n) return null;
  const edges = EDGES[m];
  let cum = 0, idx = edges.length;
  for (let i = 0; i < counts.length; i++) { cum += counts[i]; if (cum / n >= 0.75) { idx = i; break; } }
  const goodIdx = edges.indexOf(GOOD[m]);
  const good = counts.slice(0, goodIdx + 1).reduce((a, b) => a + b, 0);
  const p75 = idx < edges.length ? edges[idx] : null;
  const rating = p75 !== null && p75 <= GOOD[m] ? 'good' : p75 !== null && p75 <= POOR[m] ? 'needs improvement' : 'poor';
  return { samples: n, p75AtMost: p75, p75Over: p75 === null ? edges.at(-1) : null, goodShare: +(good / n).toFixed(3), rating };
}

/** All measures for a set of keys of a merged store (a filter picks groups or devices). */
export function summarise(store, keep = () => true) {
  const merged = { n: 0 };
  for (const [key, h] of Object.entries(store || {})) if (keep(key)) mergeInto({ x: merged }, { x: h });
  if (!merged.n) return null;
  const out = { pageViews: merged.n };
  for (const m of METRICS) { const r = readHistogram(m, merged[m]); if (r) out[m] = r; }
  return out;
}
