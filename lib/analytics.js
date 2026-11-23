// BOX analytics: the site's own visitor counts. No cookies, no third party, no IP
// address kept: a visitor is a hash that changes every day, and only totals are stored.
// Takes page views, actions and page speed, and answers the Traffic and Insights screens.
import path from 'path';
import crypto from 'crypto';
import { clientIp, BOT_RE } from './site-basics.js';
import { lineOfProduct } from './enquiry.js';
import { cleanSample, addSample, mergeInto, pageGroup } from './vitals.js';

/** Adds n under a name a visitor may have sent (a product, a referring site). Only the
 *  object's own keys are read: a name like "toString" or "constructor" would otherwise add
 *  to what every object inherits and store text where a count belongs, breaking the
 *  reports. Such names go under "other", and past `cap` names new ones do too, so a
 *  flood of made-up names cannot grow the statistics file. */
export function tally(obj, key, n = 1, cap = 200) {
  if (key in Object.prototype) key = 'other'; // __proto__, toString, constructor...: never a real product or site
  if (!Object.hasOwn(obj, key) && Object.keys(obj).length >= cap) key = 'other';
  obj[key] = (Object.hasOwn(obj, key) ? Number(obj[key]) || 0 : 0) + n;
}

export function registerAnalytics(app, { dataDir, readJsonFile, writeJsonFile, tokenSecret, makeRateLimiter, roleAuth, catalogue, agriProducts }) {
  // ============================================
  // FIRST-PARTY ANALYTICS
  // ============================================
  // Privacy-preserving, no third party, no cookies. We never store an IP or any
  // raw identifier: a visitor is counted via sha256(ip + UA + date + secret)
  // truncated, and because the date is in the hash the value rotates every day —
  // so visitors cannot be correlated across days. Only aggregates are persisted.

  const analyticsPath = path.join(dataDir, 'analytics.json');
  const ANALYTICS_RETENTION_DAYS = 400; // a year plus, for same-period-last-year comparisons
  const MAX_VISITOR_HASHES_PER_DAY = 20000; // bound memory on a traffic spike



  // Loaded once, mutated in memory, flushed on a timer so a burst of pageviews
  // doesn't hammer the disk.
  let analytics = readJsonFile(analyticsPath, { days: {} });
  if (!analytics || typeof analytics !== 'object' || !analytics.days) analytics = { days: {} };
  let analyticsDirty = false;

  function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  }

  function visitorHash(ip, ua, dayKey) {
    return crypto.createHash('sha256').update(`${ip}|${ua}|${dayKey}|${tokenSecret}`).digest('base64url').slice(0, 16);
  }

  function deviceFromUa(ua = '') {
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobi|android|iphone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function emptyDay() {
    return {
      views: 0, visitors: {}, pages: {}, referrers: {},
      devices: { desktop: 0, mobile: 0, tablet: 0 },
      inquiries: 0,
      // Per-product interest:
      //   products        → product details opened on the agriculture page
      //   inquiryProducts → product named on an enquiry that was captured
      products: {}, inquiryProducts: {},
      // Added 2026-09 for the admin insights (all aggregates, nothing personal):
      channels: {},      // direct / search / social / referral / campaign / paid / email
      campaigns: {},     // "source / medium / campaign" from utm_ parameters
      langs: {},         // browser language, a rough signal for the buyer's market
      countries: {},     // only when a CDN supplies CF-IPCountry; never derived from the IP here
      entries: {},       // first page a visitor opened that day
      heat: {},          // "weekday-hour" in Addis Ababa time (EAT, UTC+3)
      eng: {},           // per page: leaves, engaged, seconds, time buckets, deep scrolls
      events: {},        // contact, bag designer and form actions
      inquiryLines: {},  // agri / pack
      vitals: {}         // real visitors' page speed: counts per bucket, per kind of page and device (lib/vitals.js)
    };
  }

  function getDay(key) {
    if (!analytics.days[key]) analytics.days[key] = emptyDay();
    const d = analytics.days[key];
    // Defensive: older/partial records
    // a compacted day keeps counts (uniq, fn) instead of hashes; don't recreate them
    if (d.uniq === undefined) d.visitors ||= {};
    d.pages ||= {}; d.referrers ||= {};
    d.devices ||= { desktop: 0, mobile: 0, tablet: 0 };
    d.products ||= {}; d.inquiryProducts ||= {};
    d.views ||= 0; d.inquiries ||= 0;
    d.channels ||= {}; d.campaigns ||= {}; d.langs ||= {}; d.countries ||= {};
    d.entries ||= {}; d.heat ||= {}; d.eng ||= {}; d.events ||= {}; d.inquiryLines ||= {};
    d.vitals ||= {};
    return d;
  }

  // ---- insight helpers ----
  // Same-day funnel: each daily visitor hash keeps a bitmask of what that visitor
  // did. Hashes rotate daily, so a person is never followed across days.
  const STEP = { visit: 1, agri: 2, pack: 4, product: 8, studio: 16, contactAgri: 32, enquiryAgri: 64, enquiryPack: 128, contactPack: 256, contactHome: 512 };
  // lineOfProduct (agriculture or packaging, from the product name) comes from lib/enquiry.js
  const bump = tally;
  function markVisitor(day, req, bits) {
    const h = visitorHash(clientIp(req), String(req.headers['user-agent'] || ''), todayKey());
    if (!day.visitors) return false; // compacted day
    const known = day.visitors[h] !== undefined;
    if (!known && Object.keys(day.visitors).length >= MAX_VISITOR_HASHES_PER_DAY) return false;
    day.visitors[h] = (Number(day.visitors[h]) || 0) | STEP.visit | bits;
    return !known;
  }
  const SEARCH_RE = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|naver|seznam|qwant|startpage|brave|so|sogou)\.[a-z.]+$/i;
  const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'lnkd.in', 't.co', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'tiktok.com', 't.me', 'telegram.org', 'whatsapp.com', 'wa.me', 'reddit.com', 'pinterest.com'];
  const onHost = (h, list) => list.some((d) => h === d || h.endsWith('.' + d));
  function channelOf(refHost, utm) {
    if (utm.medium && /^(cpc|ppc|paid|paidsearch|paid_social|display|ads?)$/i.test(utm.medium)) return 'paid';
    if (utm.medium && /e-?mail|newsletter/i.test(utm.medium)) return 'email';
    if (utm.source) return 'campaign';
    if (refHost === 'direct') return 'direct';
    if (SEARCH_RE.test(refHost)) return 'search';
    if (onHost(refHost, SOCIAL_HOSTS)) return 'social';
    if (/(^|\.)(mail|outlook|gmail)\./i.test(refHost)) return 'email';
    return 'referral';
  }
  const cleanTag = (v) => (typeof v === 'string' ? v.trim().replace(/[^\w .+\-]/g, '').slice(0, 60) : '');
  // Weekday and hour in Addis Ababa (UTC+3, no daylight saving)
  function eatHeatKey(now = Date.now()) {
    const t = new Date(now + 3 * 3600000);
    return `${t.getUTCDay()}-${t.getUTCHours()}`;
  }
  // studio_quote_only: asked for a quote on a bag that has no photo in the studio yet.
  // studio_logo_warn / studio_logo_fix: the logo check flagged an upload, and the
  // visitor applied its one-click fix. home_product: pointed at a product on the
  // home page to see its photo.
  const TRACK_EVENTS = new Set(['reveal_phone', 'reveal_whatsapp', 'telegram', 'email', 'studio_logo', 'studio_artwork', 'studio_download', 'view_3d', 'lid_3d', 'flat_3d', 'art_3d', 'save_3d', 'quote_3d', 'bundle_add_page', 'studio_quote', 'studio_change', 'studio_quote_only', 'studio_logo_warn', 'studio_logo_fix', 'home_product', 'bundle_add', 'bundle_remove', 'bundle_below_min', 'bundle_send', 'catalogue_filter', 'form_start', 'form_invalid', 'form_fail']);

  function pruneAnalytics() {
    const cutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 86400000);
    const cutoffKey = todayKey(cutoff);
    // Compact finished days: once a day is over its visitor hashes are replaced by
    // counts (uniques and funnel steps), so no per-visitor value outlives the day
    // and a year of history stays small.
    const yesterdayKey = todayKey(new Date(Date.now() - 86400000));
    for (const key of Object.keys(analytics.days)) {
      if (key < cutoffKey) { delete analytics.days[key]; continue; }
      const d = analytics.days[key];
      if (key < yesterdayKey && d.visitors) {
        d.uniq = Object.keys(d.visitors).length;
        d.fn = dayFunnel(d);
        delete d.visitors;
      }
    }
  }

  function flushAnalytics() {
    if (!analyticsDirty) return;
    pruneAnalytics();
    if (writeJsonFile(analyticsPath, analytics)) analyticsDirty = false;
  }
  setInterval(flushAnalytics, 10000).unref();
  process.on('SIGINT', () => { flushAnalytics(); process.exit(0); });
  process.on('SIGTERM', () => { flushAnalytics(); process.exit(0); });

  // Record a conversion (an inquiry actually sent). Called from /api/inquiry.
  // `product` is the option the visitor picked, so the dashboard can show which
  // products actually convert — not just which ones get clicked.
  // Every captured lead counts, whether or not the notification email went out
  // (previously only emailed leads were counted, so an SMTP problem hid demand).
  function recordInquiry(product, req, knownLine) {
    const day = getDay(todayKey());
    day.inquiries++;
    const name = typeof product === 'string' && product.trim() ? product.trim().slice(0, 80) : 'Not specified';
    tally(day.inquiryProducts, name, 1, 200);
    // the enquiry's own line when the caller knows it: "Pizza boxes" is packaging though it says no "bag"
    const line = knownLine === 'pack' || knownLine === 'agri' ? knownLine : lineOfProduct(name);
    bump(day.inquiryLines, line);
    if (req && !BOT_RE.test(String(req.headers['user-agent'] || ''))) markVisitor(day, req, line === 'pack' ? STEP.enquiryPack : STEP.enquiryAgri);
    analyticsDirty = true;
  }

  // POST /api/track — public beacon fired by the client on page view.
  // Rate-limited so it can't be used to inflate numbers cheaply.
  app.post('/api/track', makeRateLimiter(60, 'track'), (req, res) => {
    // Analytics is non-critical: a failure here must never surface an error to
    // the visitor's browser. On any unexpected problem, log it server-side and
    // quietly no-op (204) instead of returning 500.
    try {
    const ua = String(req.headers['user-agent'] || '');
    // Never count bots/monitors, and never track the admin area.
    if (BOT_RE.test(ua)) return res.status(204).end();

    const dayKey = todayKey();
    const body = req.body || {};
    let rawPath = typeof body.path === 'string' ? body.path : '/';
    if (!rawPath.startsWith('/')) rawPath = '/';
    rawPath = rawPath.split('?')[0].split('#')[0].slice(0, 120) || '/';
    if (rawPath.startsWith('/admin')) return res.status(204).end();
    const lineOfPath = rawPath.startsWith('/packaging') ? 'pack' : rawPath.startsWith('/agriculture') ? 'agri' : 'home';

    // Product-interest event: product details opened on the agriculture page.
    // Counted separately from pageviews so it doesn't inflate traffic.
    if (body.event === 'product') {
      const name = typeof body.product === 'string' ? body.product.trim().slice(0, 80) : '';
      if (!name) return res.status(204).end();
      const d = getDay(dayKey);
      tally(d.products, name, 1, 200);
      markVisitor(d, req, STEP.product | STEP.agri);
      analyticsDirty = true;
      return res.status(204).end();
    }

    // Engagement, sent once when a visitor leaves or hides the page: seconds the
    // page was visible and the deepest scroll. Engaged = 15s+ or half the page.
    if (body.event === 'leave') {
      const secs = Math.max(0, Math.min(1800, Math.round(Number(body.seconds) || 0)));
      const scroll = Math.max(0, Math.min(100, Math.round(Number(body.scroll) || 0)));
      const d = getDay(dayKey);
      if (d.eng[rawPath] === undefined && Object.keys(d.eng).length >= 60) return res.status(204).end();
      const e = (d.eng[rawPath] ||= { n: 0, engaged: 0, secs: 0, deep: 0, b: [0, 0, 0, 0, 0] });
      e.n++; e.secs += secs;
      if (secs >= 15 || scroll >= 50) e.engaged++;
      if (scroll >= 75) e.deep++;
      e.b[secs < 10 ? 0 : secs < 30 ? 1 : secs < 60 ? 2 : secs < 180 ? 3 : 4]++;
      analyticsDirty = true;
      return res.status(204).end();
    }

    // Page speed, measured in the visitor's browser (src/scripts/vitals.js): each
    // number only adds 1 to a bucket for its kind of page and device (lib/vitals.js)
    if (body.event === 'vitals') {
      const sample = cleanSample(body);
      if (!sample) return res.status(204).end();
      addSample(getDay(dayKey).vitals, pageGroup(rawPath), deviceFromUa(ua), sample);
      analyticsDirty = true;
      return res.status(204).end();
    }

    // Contact, bag designer and form actions (fixed list; anything else ignored)
    if (typeof body.event === 'string') {
      if (!TRACK_EVENTS.has(body.event)) return res.status(204).end();
      const d = getDay(dayKey);
      const name = body.event === 'form_start' ? `form_start_${lineOfPath}` : body.event;
      bump(d.events, name, 1, 40);
      const contact = /^(reveal_|telegram|email|form_start)/.test(body.event);
      const bits = body.event.startsWith('studio_') ? STEP.studio | STEP.pack
        : contact ? (lineOfPath === 'pack' ? STEP.contactPack : lineOfPath === 'agri' ? STEP.contactAgri : STEP.contactHome) : 0;
      if (bits) markVisitor(d, req, bits);
      analyticsDirty = true;
      return res.status(204).end();
    }

    const day = getDay(dayKey);

    day.views++;
    day.devices[deviceFromUa(ua)]++;
    tally(day.pages, rawPath, 1, 300);
    bump(day.heat, eatHeatKey(), 1, 7 * 24);

    const utm = { source: cleanTag(body.utm?.source), medium: cleanTag(body.utm?.medium), campaign: cleanTag(body.utm?.campaign) };
    if (utm.source) bump(day.campaigns, [utm.source, utm.medium || '(none)', utm.campaign || '(none)'].join(' / '), 1, 60);
    const lang = typeof body.lang === 'string' && /^[a-z]{2,3}(-[a-z]{2})?$/i.test(body.lang) ? body.lang.slice(0, 2).toLowerCase() + body.lang.slice(2).toUpperCase() : '';
    if (lang) bump(day.langs, lang, 1, 60);
    // only when a CDN in front sets it (TRUST_CDN_COUNTRY=1): otherwise any visitor could write
    // made-up countries into the Traffic report (white-hat, 23 Nov 2026)
    const cc = process.env.TRUST_CDN_COUNTRY === '1' ? String(req.headers['cf-ipcountry'] || '').toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1') bump(day.countries, cc, 1, 80);

    // Referrer: store hostname only (aggregate + privacy). Self-referrals and
    // empty referrers collapse to "direct".
    let refHost = 'direct';
    const ref = typeof req.body?.referrer === 'string' ? req.body.referrer : '';
    if (ref) {
      try {
        const h = new URL(ref).hostname.replace(/^www\./, '');
        const selfHost = String(req.headers.host || '').split(':')[0].replace(/^www\./, '');
        refHost = h && h !== selfHost ? h.slice(0, 100) : 'direct';
      } catch { refHost = 'direct'; }
    }
    tally(day.referrers, refHost, 1, 200);
    bump(day.channels, channelOf(refHost, utm), 1, 20);

    // Unique visitor (daily-rotating hash, never an IP), with the section reached
    const firstToday = markVisitor(day, req, lineOfPath === 'agri' ? STEP.agri : lineOfPath === 'pack' ? STEP.pack : 0);
    if (firstToday) bump(day.entries, rawPath, 1, 60);

    analyticsDirty = true;
    res.status(204).end();
    } catch (err) {
      console.error('track error:', (err && err.stack) || err);
      if (!res.headersSent) res.status(204).end();
    }
  });

  // GET /api/analytics?days=30 (admin) — aggregated summary. Visitor hashes are
  // counted server-side and never returned.
  const FUNNEL_KEYS = Object.keys(STEP);
  // visitors of one day, from live hashes or, for compacted days, stored counts
  function dayUniques(d) { return d?.visitors ? Object.keys(d.visitors).length : (d?.uniq || 0); }
  function dayFunnel(d) {
    if (!d) return {};
    if (!d.visitors) return d.fn || {};
    const out = {};
    for (const v of Object.values(d.visitors)) {
      const bits = Number(v) || 1;
      for (const k of FUNNEL_KEYS) if (bits & STEP[k]) out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  // Sum `days` days ending `offset` days before today.
  function aggregateAnalytics(days, offset = 0) {
    const a = {
      series: [], views: 0, uniques: 0, inquiries: 0,
      pages: {}, referrers: {}, devices: { desktop: 0, mobile: 0, tablet: 0 }, productClicks: {}, productInquiries: {},
      productDaily: {}, channels: {}, campaigns: {}, langs: {}, countries: {}, entries: {}, heat: {}, events: {},
      inquiryLines: {}, funnel: {}, eng: {}, leaves: 0, engaged: 0, secs: 0, trackedDays: 0, vitals: {}
    };
    const add = (target, src) => { for (const [k, v] of Object.entries(src || {})) tally(target, k, Number(v) || 0, Infinity); };
    for (let i = days - 1; i >= 0; i--) {
      const key = todayKey(new Date(Date.now() - (i + offset) * 86400000));
      const d = analytics.days[key];
      const uniques = dayUniques(d);
      let dayLeaves = 0, dayEngaged = 0;
      for (const e of Object.values(d?.eng || {})) { dayLeaves += e.n || 0; dayEngaged += e.engaged || 0; }
      a.series.push({ date: key, views: d?.views || 0, uniques, inquiries: d?.inquiries || 0, leaves: dayLeaves, engaged: dayEngaged });
      if (!d) continue;
      if (d.heat) a.trackedDays++;
      a.views += d.views || 0; a.uniques += uniques; a.inquiries += d.inquiries || 0;
      add(a.pages, d.pages); add(a.referrers, d.referrers); add(a.devices, d.devices);
      add(a.productClicks, d.products); add(a.productInquiries, d.inquiryProducts);
      for (const [name, n] of Object.entries(d.products || {})) (a.productDaily[name] ||= new Array(days).fill(0))[days - 1 - i] += n;
      add(a.channels, d.channels); add(a.campaigns, d.campaigns); add(a.langs, d.langs); add(a.countries, d.countries);
      add(a.entries, d.entries); add(a.heat, d.heat); add(a.events, d.events); add(a.inquiryLines, d.inquiryLines);
      add(a.funnel, dayFunnel(d));
      mergeInto(a.vitals, d.vitals);
      for (const [p, e] of Object.entries(d.eng || {})) {
        const t = (a.eng[p] ||= { n: 0, engaged: 0, secs: 0, deep: 0, b: [0, 0, 0, 0, 0] });
        t.n += e.n || 0; t.engaged += e.engaged || 0; t.secs += e.secs || 0; t.deep += e.deep || 0;
        (e.b || []).forEach((v, j) => { t.b[j] += v || 0; });
        a.leaves += e.n || 0; a.engaged += e.engaged || 0; a.secs += e.secs || 0;
      }
    }
    return a;
  }

  function summaryOf(a) {
    return {
      views: a.views,
      // Sum of daily uniques (a returning visitor counts once per day).
      uniques: a.uniques,
      inquiries: a.inquiries,
      conversionRate: a.views ? +((a.inquiries / a.views) * 100).toFixed(2) : 0,
      enquiriesPer100Visitors: a.uniques ? +((a.inquiries / a.uniques) * 100).toFixed(2) : 0,
      engagedRate: a.leaves ? +((a.engaged / a.leaves) * 100).toFixed(1) : null,
      avgSeconds: a.leaves ? Math.round(a.secs / a.leaves) : null,
      viewsPerVisitor: a.uniques ? +(a.views / a.uniques).toFixed(2) : null
    };
  }

  // GET /api/analytics?days=30 (manager) — aggregated summary for the period and
  // the one before it. Visitor hashes are counted server-side and never returned.
  // A marketing team's own line (the manager may ask for either): views of its pages
  // day by day, its products' opens and enquiries, its enquiries, and where the
  // website's visitors come from (that part is site-wide and labelled so).
  app.get('/api/team/insights', roleAuth(['agri', 'pack', 'manager'], 'Insights are for the marketing teams and the manager.'), (req, res) => {
    const role = req.user.role;
    const line = role === 'manager' ? (req.query.line === 'pack' ? 'pack' : 'agri') : role;
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 365);
    const cur = aggregateAnalytics(days, 0), prev = aggregateAnalytics(days, days);
    const prefix = line === 'pack' ? '/packaging' : '/agriculture';
    const mine = (p) => p === prefix || p === `${prefix}/` || p.startsWith(`${prefix}/`);
    const viewsOf = (pages) => Object.entries(pages || {}).reduce((n, [p, v]) => n + (mine(p) ? Number(v) || 0 : 0), 0);
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = todayKey(new Date(Date.now() - i * 86400000)), before = todayKey(new Date(Date.now() - (i + days) * 86400000));
      series.push({ date: key, views: viewsOf(analytics.days[key]?.pages), prevViews: viewsOf(analytics.days[before]?.pages) });
    }
    const pages = Object.entries(cur.pages).filter(([p]) => mine(p)).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([path, views]) => {
      const e = cur.eng[path];
      return { path, views, prevViews: prev.pages[path] || 0, avgSeconds: e?.n ? Math.round(e.secs / e.n) : null, engagedRate: e?.n ? +((e.engaged / e.n) * 100).toFixed(1) : null };
    });
    const names = line === 'pack' ? catalogue().filter((p) => p.site !== false).map((p) => p.name) : agriProducts().map((p) => p.name);
    const products = names.map((name) => ({ name, opens: cur.productClicks[name] || 0, prevOpens: prev.productClicks[name] || 0, enquiries: cur.productInquiries[name] || 0, daily: cur.productDaily[name] || new Array(days).fill(0) }))
      .sort((x, y) => y.opens - x.opens || y.enquiries - x.enquiries || x.name.localeCompare(y.name));
    const top = (obj, n = 8) => Object.entries(obj).sort((x, y) => y[1] - x[1]).slice(0, n).map(([name, count]) => ({ name, count }));
    res.set('Cache-Control', 'no-store');
    res.json({
      line, days,
      views: viewsOf(cur.pages), prevViews: viewsOf(prev.pages),
      enquiries: cur.inquiryLines[line] || 0, prevEnquiries: prev.inquiryLines[line] || 0,
      series, pages, products,
      site: { channels: top(cur.channels, 7), countries: top(cur.countries, 8), devices: cur.devices },
    });
  });

  app.get('/api/analytics', roleAuth(['manager'], 'Traffic reports are for managers.'), (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const cur = aggregateAnalytics(days, 0);
    const prev = aggregateAnalytics(days, days);

    const top = (obj, n = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

    // One row per product the visitor showed interest in, so the admin can see
    // opens and actual enquiries side by side rather than in two lists.
    const products = [...new Set([...Object.keys(cur.productClicks), ...Object.keys(cur.productInquiries)])]
      .map((name) => ({ name, clicks: cur.productClicks[name] || 0, inquiries: cur.productInquiries[name] || 0, daily: cur.productDaily[name] || new Array(days).fill(0), prevClicks: prev.productClicks[name] || 0 }))
      .sort((a, b) => (b.clicks - a.clicks) || (b.inquiries - a.inquiries))
      .slice(0, 20);

    // 7 x 24 grid, weekday 0 = Sunday, Addis Ababa time
    const heatmap = Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, h) => cur.heat[`${dow}-${h}`] || 0));

    const pages = Object.entries(cur.pages).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([path, views]) => {
      const e = cur.eng[path];
      return {
        path, views, entries: cur.entries[path] || 0,
        leaves: e?.n || 0,
        engagedRate: e?.n ? +((e.engaged / e.n) * 100).toFixed(1) : null,
        avgSeconds: e?.n ? Math.round(e.secs / e.n) : null,
        deepRate: e?.n ? +((e.deep / e.n) * 100).toFixed(1) : null,
        timeBuckets: e?.b || [0, 0, 0, 0, 0]
      };
    });

    // first day holding the newer fields, so the panel can say "since"
    const firstTracked = Object.keys(analytics.days).filter((k) => analytics.days[k].heat).sort()[0] || null;

    res.json({
      range: days,
      firstTracked,
      totals: summaryOf(cur),
      previous: summaryOf(prev),
      series: cur.series,
      previousSeries: prev.series,
      topPages: top(cur.pages),
      topReferrers: top(cur.referrers, 12),
      devices: cur.devices,
      products,
      channels: cur.channels,
      previousChannels: prev.channels,
      campaigns: top(cur.campaigns, 12),
      languages: top(cur.langs, 12),
      countries: top(cur.countries, 12),
      entries: top(cur.entries, 10),
      pages,
      heatmap,
      events: cur.events,
      previousEvents: prev.events,
      funnel: cur.funnel,
      previousFunnel: prev.funnel,
      inquiryLines: cur.inquiryLines
    });
  });

  return { recordInquiry, aggregateAnalytics, analyticsPath, todayKey, firstTracked: () => Object.keys(analytics.days).filter((k) => analytics.days[k].heat).sort()[0] || null };
}
