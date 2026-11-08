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
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
