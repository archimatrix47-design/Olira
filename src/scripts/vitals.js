// Real visitors' page speed, measured in their own browser and sent once, when the
// page is hidden or closed, with the site's first-party beacon (window.oliraTrack in
// SiteLayout.astro). Four numbers and nothing else: how long the main picture or
// heading took to appear (LCP), how fast the page answered a tap or click (INP), how
// much it jumped while loading (CLS), and how quickly the server answered (TTFB).
// The server only adds each to a count per kind of page (lib/vitals.js). Browsers
// that cannot measure one simply leave it out (Safari has no LCP, CLS or INP).
const SAMPLE = 1; // the share of page views measured: all of them while traffic is small
const supported = (type) => { try { return PerformanceObserver.supportedEntryTypes.includes(type); } catch (e) { return false; } };

if ('PerformanceObserver' in window && Math.random() < SAMPLE) {
  const v = {};
  const observe = (type, fn, opts = {}) => {
    if (!supported(type)) return false;
    try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); return true; } catch (e) { return false; }
  };
  // the largest picture or block of text, as it last changed before the visitor did anything
  observe('largest-contentful-paint', (e) => { v.lcp = Math.round(e.startTime); });
  // layout shifts: the worst burst (shifts less than 1 s apart, up to 5 s long), as Google counts it
  let burst = 0, burstStart = 0, lastShift = 0;
  if (observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (burst && e.startTime - lastShift < 1000 && e.startTime - burstStart < 5000) burst += e.value;
    else { burst = e.value; burstStart = e.startTime; }
    lastShift = e.startTime;
    if (burst > (v.cls || 0)) v.cls = +burst.toFixed(4);
  })) v.cls ||= 0;
  // interactions: the slowest one (one in fifty is ignored on a busy page, as Google does)
  const slowest = new Map();
  observe('event', (e) => { if (e.interactionId) slowest.set(e.interactionId, Math.max(slowest.get(e.interactionId) || 0, e.duration)); }, { durationThreshold: 40 });
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    if (nav && nav.responseStart > 0) v.ttfb = Math.round(Math.max(0, nav.responseStart - (nav.activationStart || 0)));
    if (slowest.size) {
      const all = [...slowest.values()].sort((a, b) => b - a);
      v.inp = Math.round(all[Math.min(all.length - 1, Math.floor(all.length / 50))]);
    }
    if (Object.keys(v).length) { try { window.oliraTrack?.('vitals', v); } catch (e) { /* never in the visitor's way */ } }
  };
  // the visitor switches tab, closes it or goes to another page: the last moment to send
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  addEventListener('pagehide', send);
}
