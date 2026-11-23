// BOX admin-sign-in: the admin password and sessions. Login with lockout, signed
// tokens bound to the caller, sign out, password change and recovery by file, and the
// adminAuth guard that every admin-only route in the other boxes stands behind.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { clientIp } from './site-basics.js';

export function registerAdminAuth(app, { dataDir, writeJsonFile, audit, logError, makeRateLimiter }) {
  // Stronger rate limiting for admin login (3 requests per minute per IP), on its
  // own bucket so it can't be consumed by other endpoints.
  // Coarse flood guard on the login endpoint. The progressive lockout (3 FAILED
  // attempts) is the real brute-force defense; this just caps request rate. The
  // old value of 3/min was so tight that a few legitimate typos locked you out —
  // tunable now, default 10/min.
  const adminRateLimit = makeRateLimiter(Number(process.env.ADMIN_LOGIN_RATE_PER_MIN) || 10, 'admin-login');

  app.use('/api/admin/login', adminRateLimit);

  // ============================================================
  // ADMIN SECURITY
  // ============================================================
  // Layered defense for the admin login:
  //   1. Constant-time password comparison (timingSafeEqual)
  //   2. Progressive per-IP lockout (3 fails/min → 5min, 5 total → 30min)
  //   3. Server-side token blocklist (logout actually revokes)
  //   4. Token bound to client IP hash (replay from another IP fails)
  //   5. Origin header check on state-changing admin endpoints (CSRF)
  //   6. Audit log to data/admin-audit.log
  //   7. Startup validation refuses to run in production with weak secrets
  // ============================================================

  // A missing, default or short secret is never used to sign or check a token: the default is
  // in the public repo, so anyone could forge an admin or manager token with it. Start-up
  // still switches sign-in off and says why (lib/startup.js); with a random secret made here,
  // no token from before and no forged one is accepted (white-hat, 23 Nov 2026).
  const SECRET_SET = process.env.JWT_SECRET || '';
  const JWT_SECRET = SECRET_SET && SECRET_SET !== 'default_secret_change_in_production' && SECRET_SET.length >= 32
    ? SECRET_SET
    : crypto.randomBytes(48).toString('base64url');
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_in_production';
  const TOKEN_TTL_SECONDS = 24 * 60 * 60;

  const failedAttempts = new Map();    // ip → { count, firstFailAt, lockedUntil }
  const tokenBlocklist = new Map();    // tokenHash → expiresAt (timestamp ms)
  // kept in DATA_DIR too, so a signed-out session stays signed out after a restart (before
  // 23 Nov 2026 a restart brought every signed-out token back until it expired)
  const revokedPath = path.join(dataDir, 'revoked-tokens.json');
  try {
    const saved = JSON.parse(fs.readFileSync(revokedPath, 'utf8'));
    if (Array.isArray(saved)) for (const [h, until] of saved) if (typeof h === 'string' && until > Date.now()) tokenBlocklist.set(h, until);
  } catch { /* none yet */ }
  const saveRevoked = () => { writeJsonFile(revokedPath, [...tokenBlocklist].filter(([, until]) => until > Date.now())); };

  // F3: when admin secrets are weak/missing in production, we DISABLE the admin
  // login instead of killing the whole process. /api/admin/login returns 503, but
  // the public storefront and read-only APIs keep serving. A weak ADMIN_PASSWORD
  // should lock the admin door, not take the business site offline (which is
  // exactly what happened during launch when a short password hit process.exit).
  let adminLoginDisabled = false;

  // Cleanup blocklist every 10 min so it doesn't grow unbounded
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of tokenBlocklist) if (v < now) tokenBlocklist.delete(k);
    // forget an address an hour after its first failure once any lock has passed (records with 5+
    // failures used to stay forever, so every later typo locked for 30 minutes)
    for (const [k, v] of failedAttempts) if ((v.lockedUntil || 0) < now && now - v.firstFailAt > 60 * 60_000) failedAttempts.delete(k);
  }, 10 * 60 * 1000).unref();

  function ipHash(ip) {
    return crypto.createHash('sha256').update(ip + JWT_SECRET).digest('base64url').slice(0, 16);
  }

  function tokenHash(token) {
    return crypto.createHash('sha256').update(token).digest('base64url').slice(0, 32);
  }

  // Constant-time string comparison (prevents timing attacks)
  function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false; // length is observable but we can't avoid it
    return crypto.timingSafeEqual(ab, bb);
  }

  // ------------------------------------------------------------------
  // Restart-free admin credentials.
  // This host's process manager does not reliably restart the app, so changing
  // ADMIN_PASSWORD via env var can silently never take effect — that caused a long
  // lockout/outage. These make the admin password changeable AND recoverable
  // WITHOUT a restart, by reading from DATA_DIR (always writable, re-read live):
  //   • DATA_DIR/auth.json       {salt, scrypt, pv} — overrides the env var, written
  //                              by the in-panel "change password" endpoint.
  //   • DATA_DIR/admin-reset.txt — drop a plaintext new password here (via cPanel
  //                              File Manager, no restart). It's adopted into
  //                              auth.json on the next login, the plaintext file is
  //                              deleted, lockouts cleared, and login re-enabled.
  // The env ADMIN_PASSWORD stays the fallback when no override file exists.
  // ------------------------------------------------------------------
  const authPath = path.join(dataDir, 'auth.json');
  const resetPath = path.join(dataDir, 'admin-reset.txt');

  // The old way (one SHA-256 with the server secret): still read, so a saved password keeps
  // working, and replaced by scrypt at its next successful sign-in.
  function hashPassword(pw) {
    return crypto.createHash('sha256').update(`${pw}|${JWT_SECRET}`).digest('hex');
  }
  // scrypt with its own salt, like the staff accounts (lib/staff-accounts.js): slow to guess
  // even if auth.json and the server secret were both copied
  const scryptHex = (pw, salt) => crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  function credential(pw, pv) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { salt, scrypt: scryptHex(pw, salt), pv, updatedAt: new Date().toISOString() };
  }

  /** The saved admin credential ({ salt, scrypt, pv } or the old { passwordSha256 }), or null. */
  function readAuthOverride() {
    try {
      if (fs.existsSync(authPath)) {
        const a = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        if (a && typeof a.scrypt === 'string' && a.scrypt.length === 128 && typeof a.salt === 'string' && a.salt) return a;
        if (a && typeof a.passwordSha256 === 'string' && a.passwordSha256.length === 64) return a;
      }
    } catch (e) { logError('auth_json_read_failed', e); }
    return null;
  }
  // the admin password's version: a change raises it, which ends every older admin session
  const passwordVersion = () => Number(readAuthOverride()?.pv) || 1;

  // Restart-free recovery: if someone dropped DATA_DIR/admin-reset.txt, adopt it.
  function adoptResetIfPresent() {
    try {
      if (!fs.existsSync(resetPath)) return;
      const pw = fs.readFileSync(resetPath, 'utf8').trim();
      if (pw.length >= 12) {
        writeJsonFile(authPath, { ...credential(pw, passwordVersion() + 1), source: 'admin-reset.txt' });
        adminLoginDisabled = false;
        failedAttempts.clear();
        logError('admin_reset_adopted', 'admin-reset.txt adopted; login re-enabled, lockouts cleared', {});
      } else {
        logError('admin_reset_rejected', 'admin-reset.txt ignored (needs >= 12 chars)', {});
      }
      try { fs.unlinkSync(resetPath); } catch {}
    } catch (e) { logError('admin_reset_failed', e); }
  }

  // Timing-safe check of a submitted password against the active credential
  // (auth.json override if present, else the env ADMIN_PASSWORD).
  function checkAdminPassword(submitted) {
    const saved = readAuthOverride();
    if (saved?.scrypt) return safeCompare(scryptHex(submitted, saved.salt), saved.scrypt);
    const active = saved?.passwordSha256 || (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : null);
    if (!active) return false;
    const ok = safeCompare(hashPassword(submitted), active);
    // an old-style saved password moves to scrypt now that it is known (same version: no one is signed out)
    if (ok && saved?.passwordSha256) writeJsonFile(authPath, { ...credential(submitted, Number(saved.pv) || 1), source: saved.source || 'panel', upgradedFrom: 'sha256' });
    return ok;
  }

  // Whether any usable admin credential exists (drives adminLoginDisabled).
  function hasUsableAdminCredential() {
    if (readAuthOverride()) return true;
    const pw = process.env.ADMIN_PASSWORD;
    return !!pw && pw !== 'change_me_in_production' && pw.length >= 12;
  }

  // Progressive lockout. Returns null if allowed, or { lockedUntil } if locked.
  function checkLockout(ip) {
    const rec = failedAttempts.get(ip);
    if (!rec) return null;
    const now = Date.now();
    if (rec.lockedUntil && rec.lockedUntil > now) {
      return { lockedUntil: rec.lockedUntil, secondsLeft: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    return null;
  }

  function recordFailedAttempt(ip) {
    const now = Date.now();
    const old = failedAttempts.get(ip);
    const rec = old && (old.lockedUntil > now || now - old.firstFailAt < 60 * 60_000) ? old : { count: 0, firstFailAt: now, lockedUntil: 0 };
    rec.count++;
    // Tier 1: 3 fails within 60s → 5 min lockout
    if (rec.count >= 3 && now - rec.firstFailAt < 60_000 && rec.count < 5) {
      rec.lockedUntil = now + 5 * 60_000;
    }
    // Tier 2: 5 total fails → 30 min lockout
    if (rec.count >= 5) {
      rec.lockedUntil = now + 30 * 60_000;
    }
    failedAttempts.set(ip, rec);
    return rec;
  }

  function clearFailedAttempts(ip) {
    failedAttempts.delete(ip);
  }

  // Origin / Referer check — mitigates CSRF on state-changing endpoints.
  // We accept same-origin only (no admin endpoint should be called cross-origin).
  function checkOrigin(req) {
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return true; // some proxies strip these; rely on token + IP-binding
    try {
      const u = new URL(origin);
      const host = u.host;
      // Allow localhost variants in dev + the configured production host
      const isDev = process.env.NODE_ENV !== 'production';
      // the whole name, not its start: "localhost.evil.example" passed the old prefix test
      if (isDev && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(u.hostname))) return true;
      const corsEnv = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      return corsEnv.some(o => { try { return new URL(o).host === host; } catch { return false; } });
    } catch {
      return false;
    }
  }

  // JWT Token Generator — embeds IP hash so a stolen token replayed from a
  // different network is rejected.
  function generateToken(ip, claims = {}) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      iph: ipHash(ip),
      jti: crypto.randomBytes(9).toString('base64url'), // each session its own token: two sign-ins in one second were identical, so signing out one ended both
      ...claims // team members: role, uid, pv (see lib/staff-accounts.js)
    })).toString('base64url');

    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  // Verify token — signature + expiry + blocklist + IP binding.
  // Returns { valid: true, payload } or { valid: false, reason: string }.
  function verifyTokenDetailed(token, ip) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return { valid: false, reason: 'malformed' };

      const expected = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${parts[0]}.${parts[1]}`)
        .digest('base64url');
      // Compare in constant time
      if (!safeCompare(expected, parts[2])) return { valid: false, reason: 'signature' };

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' };

      // Blocklist check
      if (tokenBlocklist.has(tokenHash(token))) return { valid: false, reason: 'revoked' };

      // IP binding check (only if IP claim was set at issue time)
      if (payload.iph && ip && payload.iph !== ipHash(ip)) {
        return { valid: false, reason: 'ip_mismatch' };
      }

      // an admin session from before the admin password last changed has ended (tokens
      // from before versions existed count as version 1)
      if ((!payload.role || payload.role === 'admin') && (Number(payload.apv) || 1) !== passwordVersion()) {
        return { valid: false, reason: 'password_changed' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, reason: 'parse_error' };
    }
  }


  // Admin Login — hardened.
  //   • Origin check (CSRF mitigation)
  //   • Progressive lockout (defended in checkLockout/recordFailedAttempt)
  //   • Constant-time password compare
  //   • Token bound to client IP hash
  //   • Audit log for every attempt
  app.post('/api/admin/login', (req, res) => {
    const ip = clientIp(req);

    // Restart-free recovery: adopt DATA_DIR/admin-reset.txt if present. This runs
    // BEFORE the disabled check so dropping a reset file re-enables login without a
    // process restart (which this host can't reliably do).
    adoptResetIfPresent();

    // F3: admin login disabled due to weak/missing secrets — fail here, not at boot.
    if (adminLoginDisabled) {
      audit('login_disabled', req);
      return res.status(503).json({ error: 'Admin login is temporarily unavailable. Contact the site administrator.' });
    }

    if (!checkOrigin(req)) {
      audit('login_origin_rejected', req);
      return res.status(403).json({ error: 'Forbidden' });
    }

    const lock = checkLockout(ip);
    if (lock) {
      audit('login_locked_out', req, { secondsLeft: lock.secondsLeft });
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(lock.secondsLeft / 60)} minute(s).`
      });
    }

    const { password } = req.body || {};

    if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
      audit('login_malformed', req);
      recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = checkAdminPassword(password);
    if (!ok) {
      const rec = recordFailedAttempt(ip);
      audit('login_failed', req, { attempts: rec.count });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearFailedAttempts(ip);
    const token = generateToken(ip, { apv: passwordVersion() });
    audit('login_success', req);
    res.json({ token, message: 'Login successful', expiresIn: TOKEN_TTL_SECONDS });
  });

  // Admin Logout — server-side token revocation. The token is added to the
  // blocklist for the remainder of its TTL so it can't be replayed even if
  // it was extracted from localStorage before the user clicked logout.
  app.post('/api/admin/logout', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    // only a real session is revoked and logged: made-up tokens once filled the admin's
    // Activity with "signed out" lines and this list with junk (white-hat, 23 Nov 2026)
    if (token && verifyTokenDetailed(token, clientIp(req)).valid) {
      tokenBlocklist.set(tokenHash(token), Date.now() + TOKEN_TTL_SECONDS * 1000);
      saveRevoked();
      audit('logout', req);
    }
    res.json({ success: true });
  });

  // Admin auth middleware — used to gate state-changing endpoints.
  // Combines token verification + Origin check + audit log on rejection.
  const adminAuth = (req, res, next) => {
    const ip = clientIp(req);
    const token = req.headers.authorization?.split(' ')[1];

    // Origin check on state-changing methods (CSRF mitigation)
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkOrigin(req)) {
      audit('admin_origin_rejected', req, { path: req.path });
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = verifyTokenDetailed(token || '', ip);
    if (!result.valid) {
      audit('admin_auth_rejected', req, { path: req.path, reason: result.reason });
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // a sales team token is signed with the same secret but is not an admin session
    if (!isAdminPayload(result.payload)) {
      audit('admin_auth_rejected', req, { path: req.path, reason: 'team_token' });
      return res.status(403).json({ error: 'This account cannot use the admin panel.' });
    }

    next();
  };
  function isAdminPayload(p) { return !!p && (!p.role || p.role === 'admin'); }

  // Verify token. Used by the admin page on load to decide whether to show
  // login or dashboard. All failure modes (missing/invalid/expired/revoked/
  // ip_mismatch) collapse to 401 so probing yields no information.
  app.get('/api/admin/verify', (req, res) => {
    const ip = clientIp(req);
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ valid: false });
    const result = verifyTokenDetailed(token, ip);
    if (!result.valid || !isAdminPayload(result.payload)) return res.status(401).json({ valid: false });
    res.json({ valid: true });
  });

  // Change the admin password from the panel — takes effect IMMEDIATELY, no
  // restart. Writes a hashed override to DATA_DIR/auth.json, so it survives and
  // supersedes the env var. This is the routine, restart-free way to rotate the
  // password (the env var / reset file are for recovery).
  // The current password is asked for too, so a session left open (or a copied token)
  // cannot lock the owner out. Every other admin session ends; this one gets a new token.
  app.post('/api/admin/change-password', adminAuth, (req, res) => {
    const { newPassword, currentPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
      return res.status(400).json({ error: 'New password must be 12–256 characters.' });
    }
    const ip = clientIp(req);
    const lock = checkLockout(ip);
    if (lock) return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(lock.secondsLeft / 60)} minute(s).` });
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 256) {
      return res.status(400).json({ error: 'Enter the current password.', field: 'currentPassword' });
    }
    if (!checkAdminPassword(currentPassword)) { // a wrong guess counts towards the same lockout as signing in
      recordFailedAttempt(ip);
      audit('admin_password_change_refused', req);
      return res.status(400).json({ error: 'The current password is not right.', field: 'currentPassword' });
    }
    const pv = passwordVersion() + 1;
    const ok = writeJsonFile(authPath, { ...credential(newPassword, pv), source: 'panel' });
    if (!ok) return res.status(500).json({ error: 'Failed to save the new password.' });
    audit('admin_password_changed', req);
    res.json({ success: true, token: generateToken(ip, { apv: pv }), message: 'Password updated. Other admin sessions have ended.' });
  });

  function isAdminRequest(req) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return false;
    const r = verifyTokenDetailed(token, clientIp(req));
    return r.valid && isAdminPayload(r.payload);
  }

  return { adminAuth, verifyTokenDetailed, generateToken, checkOrigin, isAdminRequest, adoptResetIfPresent, hasUsableAdminCredential, isLoginDisabled: () => adminLoginDisabled, disableLogin: () => { adminLoginDisabled = true; }, tokenSecret: JWT_SECRET };
}
