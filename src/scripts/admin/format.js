// One formatter per metric type (dataviz.md §5): units, precision, the true
// minus sign, and "no data" kept distinct from zero.
export const NO_DATA = 'No data';
const nf0 = new Intl.NumberFormat();
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const MINUS = '−';
const signed = (s) => s.replace(/^-/, MINUS);

export const int = (v) => (v == null || Number.isNaN(v) ? NO_DATA : signed(nf0.format(Math.round(v))));
export const compact = (v) => (v == null ? NO_DATA : Math.abs(v) < 10000 ? int(v) : signed(compactFmt.format(v)));
export const pct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? NO_DATA : `${signed(new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(v))}%`);
export const decimal = (v) => (v == null || !Number.isFinite(v) ? NO_DATA : signed(nf1.format(v)));

export function duration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return NO_DATA;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
export function hours(h) {
  if (h == null || !Number.isFinite(h)) return NO_DATA;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${nf1.format(h)} h`;
  return `${nf1.format(h / 24)} days`;
}

/**
 * Change against the previous period. `higherIsBetter` decides the colour, never
 * the sign. Returns { text, spoken, tone: 'good' | 'bad' | 'flat', dir }.
 */
export function delta(cur, prev, { higherIsBetter = true, points = false } = {}) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return { text: 'No comparison', spoken: 'no earlier data to compare', tone: 'flat', dir: 0 };
  let change, text;
  if (points) { change = cur - prev; text = `${signed(nf1.format(Math.abs(change) < 0.05 ? 0 : change))} pts`; }
  else if (prev === 0) { if (cur === 0) return { text: 'No change', spoken: 'no change', tone: 'flat', dir: 0 }; return { text: 'New', spoken: 'new this period', tone: higherIsBetter ? 'good' : 'bad', dir: 1 }; }
  else { change = ((cur - prev) / prev) * 100; text = `${change > 0 ? '+' : ''}${signed(nf0.format(Math.round(change)))}%`; }
  const dir = Math.abs(change) < (points ? 0.05 : 0.5) ? 0 : Math.sign(change);
  const tone = dir === 0 ? 'flat' : (dir > 0) === higherIsBetter ? 'good' : 'bad';
  const spoken = dir === 0 ? 'about the same as the previous period' : `${dir > 0 ? 'up' : 'down'} ${text.replace(/^[+−]/, '')} on the previous period`;
  return { text: dir === 0 ? 'No change' : text, spoken, tone, dir };
}

export const shortDate = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const longDate = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { return null; } })();
const languageNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) { return null; } })();
export const countryName = (cc) => { try { return regionNames?.of(cc) || cc; } catch (e) { return cc; } };
export const languageName = (tag) => { try { return languageNames?.of(tag) || tag; } catch (e) { return tag; } };

export const PAGE_NAMES = { '/': 'Home', '/agriculture/': 'Agriculture', '/packaging/': 'Packaging', '/404.html': 'Page not found' };
export const pageName = (p) => PAGE_NAMES[p] || p;
export const CHANNEL_NAMES = { direct: 'Direct', search: 'Search engines', social: 'Social media', referral: 'Other websites', campaign: 'Campaign links', paid: 'Paid ads', email: 'Email' };
export const CHANNEL_HELP = {
  direct: 'Typed in, bookmarked, or opened from an app such as WhatsApp that hides where the link came from',
  search: 'Google, Bing and other search engines',
  social: 'Facebook, LinkedIn, X, YouTube, Telegram and similar',
  referral: 'Links on other websites, such as directories and trade platforms',
  campaign: 'Links carrying utm_ tags',
  paid: 'Links tagged as paid (utm_medium cpc, ppc, paid or ads)',
  email: 'Newsletters and webmail links',
};
