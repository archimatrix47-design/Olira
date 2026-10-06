// The admin's own tools: an activity log of sign-ins and site changes, a test
// email to prove the mail settings work, and the site's health in one place.
//
//   GET  /api/admin/activity   sign-ins, failed sign-ins and every change to the site,
//                              newest first (enquiry work is the teams', so it is left out)
//   POST /api/admin/email-test sends a short email to the enquiry inbox and says what
//                              the mail server answered; the result is kept for the overview
//   GET  /api/admin/health     the health checks, when the site was built, how much the
//                              data and uploads hold, the free disk, the last test email
import fs from 'node:fs';
import path from 'node:path';

/* ---------------- the activity log ---------------- */
// event -> [kind, words]; kind is signin, change or problem (or a function of the event). Events not listed
// (enquiry work, visitors' honeypot hits, expired sessions) are not shown.
const EVENTS = {
  login_success: ['signin', () => 'The administrator signed in'],
  logout: ['signin', () => 'The administrator signed out'],
  team_login_success: ['signin', (e, who) => `${who(e.member)} signed in`],
  login_failed: ['problem', () => 'A wrong admin password was tried'],
  login_locked_out: ['problem', () => 'Admin sign-in locked after repeated wrong passwords'],
  login_disabled: ['problem', () => 'Admin sign-in refused: no admin password is set on the server'],
  login_malformed: ['problem', () => 'A malformed admin sign-in was refused'],
  team_login_failed: ['problem', (e) => (e.reason === 'inactive' ? `Sign-in refused for ${e.email}: the account is switched off` : `A wrong password was tried for ${e.email || 'an unknown email'}`)],
  team_login_locked: ['problem', (e) => `Sign-in locked for ${e.email || 'an account'} after repeated wrong passwords`],
  login_origin_rejected: ['problem', () => 'A sign-in from another website was refused'],
  admin_origin_rejected: ['problem', () => 'A change sent from another website was refused'],
  team_origin_rejected: ['problem', () => 'A change sent from another website was refused'],
  admin_password_changed: ['change', () => 'The admin password was changed'],
  team_password_changed: ['change', (e, who) => `${who(e.member)} changed their password`],
  team_member_saved: ['change', (e, who) => `Staff account saved: ${who(e.member)}${e.active === false ? ' (switched off)' : ''}`],
  team_member_deleted: ['change', (e) => `A staff account was removed (${e.member})`],
  email_config_saved: ['change', () => 'Email delivery settings saved'],
  email_test_sent: [(e) => (e.ok ? 'change' : 'problem'), (e) => (e.ok ? `Test email sent to ${e.to}` : `Test email failed: ${e.error || 'the mail server refused it'}`)],
  integrations_saved: ['change', (e) => `Marketing tags saved (${e.what || 'Google'})`],
  search_verification_saved: ['change', () => 'Search engine verification codes saved'],
  database_checked: [(e) => (e.ok ? 'change' : 'problem'), (e) => (e.ok ? 'The database check passed' : 'The database check failed')],
  contact_details_saved: ['change', () => 'Company details saved'],
  branding_saved: ['change', (e) => (e.logo ? 'A new logo was uploaded' : 'The original logo was put back')],
  certification_saved: ['change', (e) => `Certification saved: ${e.id}${e.proof ? '' : ' (no certificate file)'}`],
  certification_deleted: ['change', (e) => `Certification removed: ${e.id}`],
  certificate_uploaded: ['change', () => 'A certificate file was uploaded'],
  certificate_reminders_sent: ['change', (e) => `Certificate reminders emailed (${(e.sent || []).length})`],
  product_saved: ['change', (e, who) => `${who(e.by)} saved an agriculture product${e.id ? ` (${e.id})` : ''}`],
  product_deleted: ['change', (e, who) => `${who(e.by)} removed an agriculture product${e.id ? ` (${e.id})` : ''}`],
  packaging_product_saved: ['change', (e, who) => `${who(e.by)} saved a packaging product (${e.id})`],
  packaging_product_deleted: ['change', (e, who) => `${who(e.by)} removed a packaging product (${e.id})`],
  packaging_minimum_set: ['change', (e, who) => `${who(e.by)} changed prices and minimums (${e.id})`],
  packaging_image_uploaded: ['change', () => 'A packaging photo was uploaded'],
  social_links_saved: ['change', () => 'Contact links saved'],
  targets_saved: ['change', (e, who) => `${who(e.by)} set the monthly targets`],
  partners_saved: ['change', () => 'Partner logos saved'],
  partner_logo_uploaded: ['change', () => 'A partner logo was uploaded'],
};
export const ACTIVITY_KINDS = ['signin', 'change', 'problem'];

/** A short device description from a user agent: "Chrome on Windows". */
export function deviceOf(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'a script' : '';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}

/** One audit line as the admin reads it, or null when it is not for the admin. */
export function describeEvent(e, nameOf = (id) => id || 'Someone') {
  const def = e && EVENTS[e.event];
  if (!def) return null;
  const [k, words] = def;
  const kind = typeof k === 'function' ? k(e) : k;
  return { at: e.t, kind, text: words(e, (id) => (id === 'admin' ? 'The administrator' : nameOf(id))), ip: e.ip || '', device: deviceOf(e.ua) };
}

/** The last lines of the audit log (it only grows; the tail is what matters). */
export function readAuditTail(file, maxBytes = 768 * 1024) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // the first line may be cut
    return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const dirSize = (dir) => {
  let n = 0;
  const walk = (d) => { for (const ent of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, ent.name); try { if (ent.isDirectory()) walk(p); else n += fs.statSync(p).size; } catch { /* gone meanwhile */ } } };
  try { walk(dir); } catch { /* missing */ }
  return n;
};

export function registerAdminTools(app, { adminAuth, rateLimit, auditLogPath, dataDir, uploadsDir, distPath, readJsonFile, writeJsonFile, sendEmail, loadEmailConfig, audit, logError, healthChecks, enquiryStore, databaseCheck }) {
  const statusPath = path.join(dataDir, 'email-status.json');
  const names = () => {
    const t = readJsonFile(path.join(dataDir, 'team.json'), { members: [] });
    return new Map((t?.members || []).map((m) => [m.id, m.name]));
  };

  app.get('/api/admin/activity', adminAuth, (req, res) => {
    const kind = ACTIVITY_KINDS.includes(req.query.kind) ? req.query.kind : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const map = names();
    const nameOf = (id) => map.get(id) || (id ? 'A former staff member' : 'Someone');
    const items = readAuditTail(auditLogPath).reverse().map((e) => describeEvent(e, nameOf)).filter((x) => x && (!kind || x.kind === kind)).slice(0, limit);
    res.set('Cache-Control', 'no-store');
    res.json({ items });
  });

  app.post('/api/admin/email-test', rateLimit, adminAuth, async (req, res) => {
    const config = loadEmailConfig();
    if (!config || !config.smtpHost || !config.smtpUser || !config.recipientEmail) return res.status(400).json({ error: 'Fill in and save the email settings first.', code: 'not_set' });
    const at = new Date().toISOString();
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222"><p>This is a test from the Olira website's admin.</p><p>If you can read it, enquiries will reach <strong>${String(config.recipientEmail).replace(/[<>&"]/g, '')}</strong>.</p><p style="color:#888;font-size:12px">Sent ${at}</p></div>`;
    try {
      await sendEmail(config.recipientEmail, 'Test email from the Olira website', html, { text: `This is a test from the Olira website's admin. If you can read it, enquiries will reach ${config.recipientEmail}.\n\nSent ${at}` });
      writeJsonFile(statusPath, { ok: true, at, to: config.recipientEmail });
      audit('email_test_sent', req, { ok: true, to: config.recipientEmail });
      res.json({ ok: true, to: config.recipientEmail, at });
    } catch (e) {
      // the mail server's own words help the admin; the password is never in them
      const said = String(e?.response || e?.message || 'No answer from the mail server').replace(/\s+/g, ' ').slice(0, 300);
      writeJsonFile(statusPath, { ok: false, at, to: config.recipientEmail, error: said });
      audit('email_test_sent', req, { ok: false, to: config.recipientEmail, error: said.slice(0, 120) });
      logError('email_test_failed', e);
      res.status(502).json({ ok: false, error: said, to: config.recipientEmail, at });
    }
  });

  // the store's own code against the real database, in a scratch table (lib/lead-store.js checkMaria)
  app.post('/api/admin/database-check', rateLimit, adminAuth, async (req, res) => {
    const run = databaseCheck ? databaseCheck() : null;
    if (!run) return res.status(400).json({ error: 'The website keeps enquiries in a file on the server. Add DB_NAME, DB_USER and DB_PASSWORD to the app first (CPANEL_DEPLOY.md, Database).' });
    let result;
    try { result = await run; } catch (e) { logError('database_check_failed', e); return res.status(500).json({ error: 'The check itself could not run.' }); }
    audit('database_checked', req, { ok: result.ok });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  });

  app.get('/api/admin/health', adminAuth, async (req, res) => {
    let built = null;
    try { built = fs.statSync(path.join(distPath, 'index.html')).mtime.toISOString(); } catch { /* not built */ }
    let disk = null;
    try { const s = await fs.promises.statfs(dataDir); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* not on this platform */ }
    res.set('Cache-Control', 'no-store');
    res.json({
      checks: healthChecks(),
      built,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      node: process.version,
      dataBytes: dirSize(dataDir) - dirSize(uploadsDir.startsWith(dataDir) ? uploadsDir : path.join(dataDir, '__none__')),
      uploadsBytes: dirSize(uploadsDir),
      disk,
      email: readJsonFile(statusPath, null),
      // where the enquiries are kept and how many (never their content: that is the teams')
      enquiries: enquiryStore ? await enquiryStore().catch((e) => ({ ok: false, error: e.message })) : null,
    });
  });
}
