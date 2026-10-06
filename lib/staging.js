// A second copy of the site for checking a change before it goes live
// (staging.oliraagroindustry.com, its own Node app and data folder in cPanel).
// With SITE_ENV=staging the copy:
//  - asks for a password on every request (HTTP Basic, then a cookie so the
//    staff tools' own sign-in headers still work), except /api/health for the
//    uptime check;
//  - tells search engines to stay out: X-Robots-Tag on every answer and a
//    robots.txt that disallows everything;
//  - never mails buyers or staff: every message goes to STAGING_MAIL_TO with
//    "[Staging]" in the subject, or is not sent at all;
//  - loads no Google Analytics or Ads tag, so tests are not counted as visits.
// Without SITE_ENV=staging nothing here runs.
import crypto from 'node:crypto';

export const isStaging = (env = process.env) => String(env.SITE_ENV || '').trim().toLowerCase() === 'staging';

const COOKIE = 'olira_staging';
const equal = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
/** The cookie value: a keyed hash of the password, so changing the password signs everyone out. */
const pass = (password) => crypto.createHmac('sha256', `olira-staging:${password}`).update('ok').digest('hex');
const cookieOf = (header) => (String(header || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`)) || '').slice(COOKIE.length + 1);

/** Express middleware for the staging copy (mount it first). */
export function stagingGate(env = process.env) {
  const user = String(env.STAGING_USER || 'olira');
  const password = String(env.STAGING_PASSWORD || '');
  const token = password ? pass(password) : '';
  return (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/robots.txt') return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    if (req.path === '/api/health') return next();
    if (!password) return res.status(503).type('text/plain').send('This staging copy is closed: STAGING_PASSWORD is not set.');
    if (equal(cookieOf(req.headers.cookie), token)) return next();
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const text = Buffer.from(encoded, 'base64').toString('utf8');
      const at = text.indexOf(':');
      if (at > 0 && equal(text.slice(0, at), user) && equal(text.slice(at + 1), password)) {
        res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 12}`);
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Olira staging", charset="UTF-8"');
    res.status(401).type('text/plain').send('Olira staging copy: sign in to continue.');
  };
}

/** A message the staging copy may send: redirected to STAGING_MAIL_TO, or null to drop it. */
export function stagingMail(mail, env = process.env) {
  const to = String(env.STAGING_MAIL_TO || '').trim();
  if (!to) return null;
  const { bcc, cc, ...rest } = mail;
  return { ...rest, to, subject: `[Staging] ${mail.subject || ''}`.trim() };
}

/** Wires the staging copy into the app. Returns whether it is one. */
export function registerStaging(app, env = process.env) {
  if (!isStaging(env)) return false;
  app.use(stagingGate(env));
  return true;
}
