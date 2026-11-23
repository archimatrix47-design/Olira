// What every box needs to know about a request and the site itself: nothing here
// holds state or reads a file.

/** The caller's address, as Express worked it out from the trusted proxy. */
export function clientIp(req) {
  // Use req.ip only — with `trust proxy` set (above) Express has already
  // parsed X-Forwarded-For safely. Reading the raw header here would let a
  // client spoof its IP and evade per-IP lockout / rate limits.
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}

/** Bots, monitors and headless browsers: not counted, and never shown a phone number. */
export const BOT_RE = /bot|crawler|spider|crawling|slurp|bingpreview|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|monitor|preview/i;

/** The site's own address, for links in emails. */
export const siteUrl = () => String(process.env.SITE_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || 'https://oliraagroindustry.com').trim().replace(/\/+$/, '');

/** Text from a form: control characters out, trimmed, capped. */
export const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
/** One line of text (a subject, a name that goes into a mail header): line breaks become spaces. */
export const oneLine = (v, max) => clean(typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ') : v, max);
/** Every value that comes in (a JSON body, a form's text fields), cleaned once at the door:
 *  Unicode in one form (NFC), line ends as \n, invisible control characters and the
 *  direction-override marks used to disguise text (U+202A-U+202E, U+2066-U+2069) removed,
 *  and the key names that reach an object's prototype dropped. Passwords are left exactly
 *  as typed: they are only compared, never shown. Each route still checks its own fields;
 *  pages, emails and staff screens still escape what they show (white-hat, 23 Nov 2026). */
const SKIP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function cleanDeep(v, key = '', depth = 0) {
  if (typeof v === 'string') {
    if (/pass(word)?$/i.test(key)) return v;
    return v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '');
  }
  if (Array.isArray(v)) return depth > 20 ? [] : v.map((x) => cleanDeep(x, key, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 20) return {};
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) out[k] = cleanDeep(x, k, depth + 1);
    return out;
  }
  return v;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** An email address, checked safely: the length first (an address is at most 254 characters),
 *  because EMAIL_RE takes time that grows with the square of a long input, and Node runs it
 *  on its only thread (a 1 MB "address" froze the server for minutes, white-hat 23 Nov 2026). */
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
