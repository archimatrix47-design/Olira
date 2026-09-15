import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import multer from 'multer';
import sharp from 'sharp';
import { registerWorkspace, lineOfProduct } from './lib/workspace.js';
import { registerPackaging } from './lib/packaging.js';

// Load environment variables from .env file (if it exists)
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// `--port N` wins over the PORT env var. In dev, the tooling that launches the
// Astro dev server exports PORT for *its* port, and npm passes that down to
// this process too — so the API would steal Astro's port and serve the stale
// built site instead. An explicit flag can't be clobbered that way.
// Production (cPanel/Passenger) sets PORT and passes no flag, so it still wins.
const portFlagIndex = process.argv.indexOf('--port');
const portFlag = portFlagIndex !== -1 ? Number(process.argv[portFlagIndex + 1]) : NaN;
const PORT = Number.isInteger(portFlag) && portFlag > 0 ? portFlag : (process.env.PORT || 3000);

// Trust the reverse proxy in front of us (Apache/Passenger on cPanel, Nginx,
// Cloudflare, etc.) so `req.ip` resolves the real client IP from a
// proxy-set X-Forwarded-For instead of the proxy's own address.
//
// SECURITY: this is why we must NEVER read the raw X-Forwarded-For header
// ourselves — a client can forge it. With `trust proxy` set to the number of
// hops we control, Express strips the untrusted portion and `req.ip` is
// authoritative. Configure TRUST_PROXY to the hop count for your deployment
// (default 1 = a single proxy directly in front of Node).
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// ------------------------------------------------------------------
// Persistent storage locations (cPanel / container friendly).
// On many hosts the app directory is overwritten on every deploy (and can be
// read-only), which would wipe admin-managed content (products, certs,
// contacts, branding, social) and uploaded images. Point DATA_DIR and
// UPLOADS_DIR at a path OUTSIDE the deploy sync to make that content survive.
// Defaults keep the in-repo paths so local dev is unchanged.
// ------------------------------------------------------------------
const REPO_DATA_DIR = path.join(__dirname, 'data');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : REPO_DATA_DIR;
const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'public', 'uploads');
const productImagesDir = path.join(uploadsDir, 'products');

[dataDir, uploadsDir, productImagesDir].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// First boot on a fresh persistent DATA_DIR: seed it from the repo defaults so
// products/certs/etc. aren't empty. Never overwrites existing files.
if (dataDir !== REPO_DATA_DIR && fs.existsSync(REPO_DATA_DIR)) {
  for (const f of fs.readdirSync(REPO_DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    const dest = path.join(dataDir, f);
    if (!fs.existsSync(dest)) {
      try { fs.copyFileSync(path.join(REPO_DATA_DIR, f), dest); } catch {}
    }
  }
}

// Per-limiter request buckets. Each limiter gets its OWN Map so limits on,
// say, /api/inquiry never consume the budget for /api/admin/login (they used
// to share one Map and entangle counters).
function makeRateLimiter(maxPerMinute, label) {
  const buckets = new Map(); // ip → [timestamps]
  // Periodic cleanup so idle IPs don't accumulate forever.
  setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [ip, ts] of buckets) {
      const kept = ts.filter((t) => t > cutoff);
      if (kept.length) buckets.set(ip, kept); else buckets.delete(ip);
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - 60000;
    const timestamps = (buckets.get(ip) || []).filter((t) => t > windowStart);
    if (timestamps.length >= maxPerMinute) {
      console.warn(`Rate limit exceeded (${label}) for IP: ${ip}`);
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    timestamps.push(now);
    buckets.set(ip, timestamps);
    next();
  };
}

// General endpoints: 5/min. Admin login gets its own stricter 3/min limiter.
const rateLimit = makeRateLimiter(Number(process.env.GENERAL_RATE_PER_MIN) || 5, 'general');

// Request logging middleware
const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
};

// CORS configuration - restrict to localhost and local network only
// In development, allow any localhost origin; in production, use strict allowlist
const corsOptions = {
  origin: function (origin, callback) {
    // Parse allowed origins from environment variable
    const corsEnvString = process.env.CORS_ORIGINS || '';
    const allowedOrigins = corsEnvString.split(',').map(o => o.trim()).filter(o => o);

    // In development, also allow any localhost origin for flexibility
    const isDev = process.env.NODE_ENV === 'development';
    const isLocalhost = origin && (
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('192.168')
    );

    if (!origin) {
      // Allow requests with no origin (like mobile apps or curl)
      callback(null, true);
    } else if (isDev && isLocalhost) {
      // In development, allow any localhost/local network origin
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      // In production or for non-localhost, use strict allowlist
      callback(null, true);
    } else {
      // Reject by declining CORS headers, NOT by throwing — a thrown error
      // here becomes a 500 for the caller. The browser still blocks a truly
      // cross-origin response because no CORS headers are sent; we just don't
      // want a rejected origin to surface as a server error.
      console.warn(`CORS rejected origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(requestLogger);

// Enhanced security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // googletagmanager.com: the optional Analytics/Ads tag set in the admin panel
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "fonts.googleapis.com", "https://www.googletagmanager.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'self'", "https://www.google.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  noSniff: true,
  xssFilter: true
}));

// Disable X-Powered-By header (security best practice)
app.disable('x-powered-by');

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Stronger rate limiting for admin login (3 requests per minute per IP), on its
// own bucket so it can't be consumed by other endpoints.
// Coarse flood guard on the login endpoint. The progressive lockout (3 FAILED
// attempts) is the real brute-force defense; this just caps request rate. The
// old value of 3/min was so tight that a few legitimate typos locked you out —
// tunable now, default 10/min.
const adminRateLimit = makeRateLimiter(Number(process.env.ADMIN_LOGIN_RATE_PER_MIN) || 10, 'admin-login');

// Rate limiting on API endpoints
app.use('/api/admin/login', adminRateLimit);
app.use('/api/inquiry', rateLimit);
// Only saving is rate limited: reading needs an admin session anyway, and a
// limited read made the dashboard report working email as "not set up".
app.use('/api/email-config', (req, res, next) => (req.method === 'GET' ? next() : rateLimit(req, res, next)));

// Email config file path
// Overridable so the test suite never writes the real config next to server.js.
const emailConfigPath = process.env.EMAIL_CONFIG_PATH || path.join(__dirname, 'email-config.json');

// Initialize email config if it doesn't exist
function initializeEmailConfig() {
  if (!fs.existsSync(emailConfigPath)) {
    const defaultConfig = {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpUser: '',
      smtpPassword: '',
      recipientEmail: 'info@oliraagroindustry.com',
      fromName: 'Olira Agro Industry'
    };
    fs.writeFileSync(emailConfigPath, JSON.stringify(defaultConfig, null, 2));
  }
}

// Load email configuration (environment variables take precedence over JSON file)
function loadEmailConfig() {
  // Try environment variables first
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    return {
      smtpHost: process.env.SMTP_HOST,
      smtpPort: parseInt(process.env.SMTP_PORT || '587'),
      smtpUser: process.env.SMTP_USER,
      smtpPassword: process.env.SMTP_PASSWORD,
      recipientEmail: process.env.RECIPIENT_EMAIL || 'info@oliraagroindustry.com',
      fromName: process.env.SMTP_FROM_NAME || 'Olira Agro Industry'
    };
  }

  // Fall back to JSON file if env vars not set
  try {
    if (fs.existsSync(emailConfigPath)) {
      const data = fs.readFileSync(emailConfigPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading email config from file:', error);
  }
  return null;
}

// Save email configuration
function saveEmailConfig(config) {
  try {
    fs.writeFileSync(emailConfigPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving email config:', error);
    return false;
  }
}

// Send email using configured SMTP
async function sendEmail(to, subject, htmlContent, extra = {}) {
  const config = loadEmailConfig();

  if (!config || !config.smtpUser || !config.smtpPassword) {
    throw new Error('Email not configured. Please configure SMTP settings in admin panel.');
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword
    }
  });

  // extra: text, replyTo, bcc, attachments, and fromName to send as a team member
  const fromName = String(extra.fromName || config.fromName || '').replace(/[\r\n"<>]/g, '').slice(0, 120);
  const mailOptions = {
    from: `"${fromName}" <${config.smtpUser}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };
  if (extra.text) mailOptions.text = extra.text;
  if (extra.replyTo) mailOptions.replyTo = extra.replyTo;
  if (extra.bcc) mailOptions.bcc = extra.bcc;
  if (Array.isArray(extra.attachments) && extra.attachments.length) mailOptions.attachments = extra.attachments;

  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        reject(error);
      } else {
        resolve(info);
      }
    });
  });
}

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

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_change_in_production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_in_production';
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

const failedAttempts = new Map();    // ip → { count, firstFailAt, lockedUntil }
const tokenBlocklist = new Map();    // tokenHash → expiresAt (timestamp ms)

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
  for (const [k, v] of failedAttempts) if (v.lockedUntil && v.lockedUntil < now && v.count < 5) failedAttempts.delete(k);
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  // Use req.ip only — with `trust proxy` set (above) Express has already
  // parsed X-Forwarded-For safely. Reading the raw header here would let a
  // client spoof its IP and evade per-IP lockout / rate limits.
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}

function ipHash(ip) {
  return crypto.createHash('sha256').update(ip + JWT_SECRET).digest('base64url').slice(0, 16);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('base64url').slice(0, 32);
}

// Append a single line to data/admin-audit.log. Best-effort, errors swallowed
// so a failed log write never blocks a request.
const auditLogPath = path.join(dataDir, 'admin-audit.log');
function audit(event, req, extra = {}) {
  try {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      event,
      ip: clientIp(req),
      ua: (req.headers['user-agent'] || '').slice(0, 200),
      ...extra
    }) + '\n';
    fs.appendFile(auditLogPath, line, () => {});
  } catch {}
}

// F2: persistent error/event log. One JSON line per entry to DATA_DIR/logs/
// error.log, so production failures leave a durable, findable record — console
// output is effectively unreachable under LiteSpeed/Passenger, which is why the
// CORS 500s took hours to diagnose. Best-effort; a failed log never blocks a
// request. Also echoes to stderr for local/dev.
const logsDir = path.join(dataDir, 'logs');
try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }); } catch {}
const errorLogPath = path.join(logsDir, 'error.log');
function logError(context, err, extra = {}) {
  const entry = {
    t: new Date().toISOString(),
    context,
    message: (err && err.message) ? err.message : String(err),
    stack: (err && err.stack) ? String(err.stack).split('\n').slice(0, 6).join(' | ') : undefined,
    ...extra
  };
  try { fs.appendFile(errorLogPath, JSON.stringify(entry) + '\n', () => {}); } catch {}
  console.error(`[${entry.t}] ${context}: ${entry.message}`);
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
//   • DATA_DIR/auth.json       {passwordSha256} — overrides the env var, written
//                              by the in-panel "change password" endpoint.
//   • DATA_DIR/admin-reset.txt — drop a plaintext new password here (via cPanel
//                              File Manager, no restart). It's adopted into
//                              auth.json on the next login, the plaintext file is
//                              deleted, lockouts cleared, and login re-enabled.
// The env ADMIN_PASSWORD stays the fallback when no override file exists.
// ------------------------------------------------------------------
const authPath = path.join(dataDir, 'auth.json');
const resetPath = path.join(dataDir, 'admin-reset.txt');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(`${pw}|${JWT_SECRET}`).digest('hex');
}

function readAuthOverride() {
  try {
    if (fs.existsSync(authPath)) {
      const a = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (a && typeof a.passwordSha256 === 'string' && a.passwordSha256.length === 64) return a.passwordSha256;
    }
  } catch (e) { logError('auth_json_read_failed', e); }
  return null;
}

// Restart-free recovery: if someone dropped DATA_DIR/admin-reset.txt, adopt it.
function adoptResetIfPresent() {
  try {
    if (!fs.existsSync(resetPath)) return;
    const pw = fs.readFileSync(resetPath, 'utf8').trim();
    if (pw.length >= 12) {
      writeJsonFile(authPath, { passwordSha256: hashPassword(pw), updatedAt: new Date().toISOString(), source: 'admin-reset.txt' });
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
  const active = readAuthOverride() || (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : null);
  if (!active) return false;
  return safeCompare(hashPassword(submitted), active);
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
  const rec = failedAttempts.get(ip) || { count: 0, firstFailAt: now, lockedUntil: 0 };
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
    if (isDev && (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('192.168.'))) return true;
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
    ...claims // team members: role, uid, pv (see lib/workspace.js)
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

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'parse_error' };
  }
}

// Backwards-compat boolean wrapper used by older code paths
function verifyToken(token, ip) {
  return verifyTokenDetailed(token, ip).valid;
}

// API Routes

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
  const token = generateToken(ip);
  audit('login_success', req);
  res.json({ token, message: 'Login successful', expiresIn: TOKEN_TTL_SECONDS });
});

// Admin Logout — server-side token revocation. The token is added to the
// blocklist for the remainder of its TTL so it can't be replayed even if
// it was extracted from localStorage before the user clicked logout.
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    // Even invalid tokens get blocklisted (cheap, prevents probing)
    tokenBlocklist.set(tokenHash(token), Date.now() + TOKEN_TTL_SECONDS * 1000);
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
app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
    return res.status(400).json({ error: 'New password must be 12–256 characters.' });
  }
  const ok = writeJsonFile(authPath, {
    passwordSha256: hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
    source: 'panel'
  });
  if (!ok) return res.status(500).json({ error: 'Failed to save the new password.' });
  audit('admin_password_changed', req);
  res.json({ success: true, message: 'Password updated. Use it on your next login.' });
});

// ----- INQUIRIES INBOX (admin) -----
// The public /api/inquiry handler persists every lead to inquiries.json. These
// endpoints let the admin review, triage (new → read → archived), and remove
// them from the panel, so inquiries are no longer email-only.

// List all inquiries, newest first, with per-status counts for the UI badges.
app.get('/api/admin/inquiries', adminAuth, (req, res) => {
  const list = readJsonFile(inquiriesPath, []);
  const arr = Array.isArray(list) ? list : [];
  const counts = { total: arr.length, new: 0, read: 0, contacted: 0, quoted: 0, won: 0, lost: 0, archived: 0 };
  for (const i of arr) {
    if (counts[i.status] === undefined) counts[i.status] = 0;
    counts[i.status]++;
  }
  res.json({ inquiries: arr, counts });
});

// Update one inquiry's triage status.
// Sales pipeline: new -> read (opened) -> contacted -> quoted -> won / lost,
// plus archived. Every change is appended to `history` with a timestamp so the
// panel can measure how fast leads are answered; `note` is a private note.
const INQUIRY_STATUSES = ['new', 'read', 'contacted', 'quoted', 'won', 'lost', 'archived'];
app.post('/api/admin/inquiries/:id', adminAuth, (req, res) => {
  const { status, note } = req.body || {};
  if (status === undefined && note === undefined) {
    return res.status(400).json({ error: 'Send a status, a note, or both.' });
  }
  if (status !== undefined && !INQUIRY_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Use ${INQUIRY_STATUSES.join(', ')}.` });
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) {
    return res.status(400).json({ error: 'A note is text up to 2000 characters.' });
  }
  const list = readJsonFile(inquiriesPath, []);
  if (!Array.isArray(list)) return res.status(500).json({ error: 'Inquiry store unreadable.' });
  const rec = list.find((i) => i.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Inquiry not found.' });
  const at = new Date().toISOString();
  if (status !== undefined && status !== rec.status) {
    if (!Array.isArray(rec.history)) rec.history = [];
    rec.history.push({ status, at, from: rec.status || 'new' });
    if (rec.history.length > 50) rec.history.splice(0, rec.history.length - 50);
    rec.status = status;
  }
  if (note !== undefined) { rec.note = note.trim(); rec.noteAt = at; }
  if (!writeJsonFile(inquiriesPath, list)) return res.status(500).json({ error: 'Failed to save.' });
  res.json({ success: true, inquiry: rec });
});

// Delete one inquiry.
app.delete('/api/admin/inquiries/:id', adminAuth, (req, res) => {
  const list = readJsonFile(inquiriesPath, []);
  if (!Array.isArray(list)) return res.status(500).json({ error: 'Inquiry store unreadable.' });
  const next = list.filter((i) => i.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'Inquiry not found.' });
  if (!writeJsonFile(inquiriesPath, next)) return res.status(500).json({ error: 'Failed to delete.' });
  workspace.removeLeadFiles(req.params.id);
  audit('inquiry_deleted', req, { id: req.params.id });
  res.json({ success: true });
});

// Get email configuration (admin only)
app.get('/api/email-config', adminAuth, (req, res) => {
  const config = loadEmailConfig();
  if (!config) {
    return res.status(500).json({ error: 'Failed to load email configuration' });
  }

  // Don't send password back to client
  const safeConfig = { ...config };
  delete safeConfig.smtpPassword;
  res.json(safeConfig);
});

// Update email configuration (admin only)
app.post('/api/email-config', adminAuth, (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, recipientEmail, fromName } = req.body;

  if (!smtpHost || !smtpPort || !smtpUser || !recipientEmail) {
    return res.status(400).json({ error: 'Missing required email configuration fields' });
  }

  const config = {
    smtpHost,
    smtpPort: parseInt(smtpPort),
    smtpUser,
    smtpPassword: smtpPassword || loadEmailConfig()?.smtpPassword || '',
    recipientEmail,
    fromName: fromName || 'Olira Agro Industry'
  };

  if (saveEmailConfig(config)) {
    res.json({ success: true, message: 'Email configuration updated successfully' });
  } else {
    res.status(500).json({ error: 'Failed to save email configuration' });
  }
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).trim());
}

// Helper function to sanitize HTML content
function sanitizeHtml(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Submit product inquiry
app.post('/api/inquiry', (req, res, next) => workspace.parseIntake(req, res, next), async (req, res) => {
  const { name, email, company, message, product, phone, website } = req.body || {};
  const uploads = Object.values(req.files || {}).flat();

  // Honeypot: the hidden `website` field is invisible to humans. If it's
  // filled, this is almost certainly a bot — return success so the bot sees no
  // signal to adapt, but send nothing. This blocks the confirmation-email
  // amplification vector without adding friction for real users.
  if (typeof website === 'string' && website.trim() !== '') {
    audit('inquiry_honeypot', req);
    return res.json({ success: true, message: 'Inquiry sent successfully' });
  }

  // Validate required fields
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields: name, email, message' });
  }

  // Validate field types and lengths
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return res.status(400).json({ error: 'Invalid name field' });
  }

  if (typeof email !== 'string' || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 2000) {
    return res.status(400).json({ error: 'Invalid message field' });
  }

  // Validate optional fields
  if (company && (typeof company !== 'string' || company.length > 100)) {
    return res.status(400).json({ error: 'Invalid company field' });
  }

  // 200 matches the cap the products API applies to a product name, since the
  // dropdown now submits the product name itself rather than a short slug.
  if (product && (typeof product !== 'string' || product.length > 200)) {
    return res.status(400).json({ error: 'Invalid product field' });
  }

  if (phone && (typeof phone !== 'string' || phone.length > 20)) {
    return res.status(400).json({ error: 'Invalid phone field' });
  }

  // Files and the studio design are only taken with a packaging request, and
  // only when the visitor ticked the box to send them.
  const line = lineOfProduct(product);
  if (uploads.length && line !== 'pack') {
    return res.status(400).json({ error: 'Files can only be sent with a packaging request.' });
  }
  if (uploads.length && req.body.consent !== '1') {
    return res.status(400).json({ error: 'Tick the box to send your files with the request.' });
  }
  let design = null;
  if (line === 'pack' && typeof req.body.design === 'string' && req.body.design.length <= 2000) {
    try { design = cleanDesign(JSON.parse(req.body.design)); } catch { design = null; }
  }

  // The lead is saved before any email is attempted, so a mail problem never loses it.
  const rec = recordInquiryRecord({ name, email, company, message, product, phone, design }, false);
  let fileNote = '';
  if (rec && uploads.length) {
    const r = workspace.saveIntakeFiles(rec, uploads);
    updateInquiryRecord(rec.id, { files: rec.files || [], ...(r.rejected.length ? { filesRejected: r.rejected.slice(0, 5) } : {}) });
    fileNote = r.saved.length ? `${r.saved.length} file${r.saved.length === 1 ? '' : 's'} attached` : '';
    if (r.rejected.length) {
      audit('inquiry_files_rejected', req, { count: r.rejected.length, full: !!r.full });
      if (!r.saved.length) {
        // tell the visitor, but the enquiry itself is in
        recordInquiry(product, req);
        return res.status(400).json({ error: r.full ? 'Your request is in, but the files could not be stored. Send them by email when we reply.' : 'Your request is in, but the files were not a type we accept (PDF, AI, EPS, SVG, PNG, JPG or WebP). Send them by email when we reply.', saved: true });
      }
    }
  }

  const config = loadEmailConfig();
  if (!config || !config.recipientEmail) {
    // Still capture the lead so a mail-config gap never loses a customer; the
    // admin can see it (flagged un-emailed) in the Inquiries inbox.
    recordInquiry(product, req);
    return res.status(500).json({ error: 'Email not configured' });
  }

  // Create HTML email with sanitized content
  const sanitizedName = sanitizeHtml(name);
  const sanitizedEmail = sanitizeHtml(email);
  const sanitizedCompany = sanitizeHtml(company);
  const sanitizedProduct = sanitizeHtml(product || 'Not specified');
  const sanitizedMessage = sanitizeHtml(message).replace(/\n/g, '<br/>');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #39572f 0%, #2a3f20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">New Product Inquiry</h2>
      </div>
      <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #ddd;">
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Product:</strong><br/>
          ${sanitizedProduct}
        </div>
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Name:</strong><br/>
          ${sanitizedName}
        </div>
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Email:</strong><br/>
          <a href="mailto:${sanitizedEmail}">${sanitizedEmail}</a>
        </div>
        ${sanitizedCompany ? `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Company:</strong><br/>
          ${sanitizedCompany}
        </div>` : ''}
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Message:</strong><br/>
          ${sanitizedMessage}
        </div>
        ${fileNote || design ? `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Design and files:</strong><br/>
          ${sanitizeHtml([design ? 'Bag design from the mockup studio' : '', fileNote].filter(Boolean).join(', '))}
        </div>` : ''}
        ${rec ? `<p style="margin: 18px 0 0;"><a href="${sanitizeHtml(workspace.workspaceUrl(rec))}" style="color: #186078; font-weight: bold;">Open it in the ${line === 'pack' ? 'packaging' : 'agriculture'} workspace</a></p>` : ''}
      </div>
      <div style="background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px;">
        <p style="margin: 0;">This is an automated inquiry from Olira Agro Industry website</p>
      </div>
    </div>
  `;

  try {
    // the sales team for this line gets the notification too, on blind copy
    const teamCopies = workspace.teamEmailsFor(line).filter((m) => m.toLowerCase() !== String(config.recipientEmail).toLowerCase());
    await sendEmail(config.recipientEmail, `New Product Inquiry: ${sanitizedProduct}`, htmlContent, teamCopies.length ? { bcc: teamCopies.join(', ') } : {});

    // Also send confirmation to customer
    const confirmationHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #39572f 0%, #2a3f20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Thank You for Your Inquiry</h2>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #ddd;">
          <p>Dear ${sanitizedName},</p>
          <p>Thank you for your interest in Olira Agro Industry products. We have received your inquiry and will get back to you within 24 hours.</p>
          <p style="margin-top: 20px;">Best regards,<br/><strong>Olira Agro Industry Team</strong></p>
        </div>
      </div>
    `;

    await sendEmail(sanitizedEmail, 'Thank You - Olira Agro Industry Inquiry', confirmationHtml);

    if (rec) updateInquiryRecord(rec.id, { emailed: true });
    recordInquiry(product, req); // count as a conversion, attributed to the product
    res.json({ success: true, message: 'Inquiry sent successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    // Email delivery failed, but the lead is already saved (emailed: false) and
    // can be actioned from the admin panel and the team workspace.
    recordInquiry(product, req);
    res.status(500).json({ error: 'Failed to send inquiry. Please try again.' });
  }
});

// ============================================
// MARKETING INTEGRATIONS API
// ============================================

// Path to integrations config file
const integrationsConfigPath = process.env.INTEGRATIONS_CONFIG_PATH || path.join(__dirname, 'integrations-config.json');

// Initialize integrations config if it doesn't exist
function initializeIntegrationsConfig() {
  if (!fs.existsSync(integrationsConfigPath)) {
    const defaultConfig = {
      analytics: {
        measurementId: '',
        propertyId: ''
      },
      ads: {
        conversionId: '',
        conversionLabel: '',
        conversionValue: 10
      },
      lastUpdated: null
    };
    fs.writeFileSync(integrationsConfigPath, JSON.stringify(defaultConfig, null, 2));
    console.log('Integrations config initialized');
  }
}

// Load integrations configuration
function loadIntegrationsConfig() {
  try {
    if (fs.existsSync(integrationsConfigPath)) {
      const data = fs.readFileSync(integrationsConfigPath, 'utf8');
      return JSON.parse(data);
    }
    return {
      analytics: { measurementId: '', propertyId: '' },
      ads: { conversionId: '', conversionLabel: '', conversionValue: 10 }
    };
  } catch (error) {
    console.error('Error loading integrations config:', error);
    return {
      analytics: { measurementId: '', propertyId: '' },
      ads: { conversionId: '', conversionLabel: '', conversionValue: 10 }
    };
  }
}

// Save integrations configuration
function saveIntegrationsConfig(config) {
  try {
    config.lastUpdated = new Date().toISOString();
    fs.writeFileSync(integrationsConfigPath, JSON.stringify(config, null, 2));
    console.log('Integrations config saved');
    return true;
  } catch (error) {
    console.error('Error saving integrations config:', error);
    return false;
  }
}

// Initialize on startup
initializeIntegrationsConfig();

// GET /api/integrations - Get current integration settings
app.get('/api/integrations', (req, res) => {
  const config = loadIntegrationsConfig();
  res.json(config);
});

// POST /api/integrations/analytics - Update Google Analytics settings
// Writes require an admin session: an open endpoint let anyone point the site's
// analytics or ads tags at their own Google account.
app.post('/api/integrations/analytics', rateLimit, adminAuth, (req, res) => {
  try {
    const { measurementId, propertyId } = req.body;

    // Validate Measurement ID format
    if (measurementId && !measurementId.match(/^G-[A-Z0-9]{10}$/)) {
      return res.status(400).json({ error: 'Invalid Measurement ID format. Must be G-XXXXXXXXXX' });
    }

    const config = loadIntegrationsConfig();
    config.analytics = {
      measurementId: measurementId || '',
      propertyId: propertyId || ''
    };

    if (saveIntegrationsConfig(config)) {
      res.json({ success: true, message: 'Analytics configuration saved', config: config.analytics });
    } else {
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  } catch (error) {
    console.error('Error updating analytics config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// POST /api/integrations/ads - Update Google Ads settings
app.post('/api/integrations/ads', rateLimit, adminAuth, (req, res) => {
  try {
    const { conversionId, conversionLabel, conversionValue } = req.body;

    // Validate Conversion ID format
    if (conversionId && !conversionId.match(/^[0-9]{10}$/)) {
      return res.status(400).json({ error: 'Invalid Conversion ID format. Must be 10 digits' });
    }

    const config = loadIntegrationsConfig();
    config.ads = {
      conversionId: conversionId || '',
      conversionLabel: conversionLabel || '',
      conversionValue: parseFloat(conversionValue) || 10
    };

    if (saveIntegrationsConfig(config)) {
      res.json({ success: true, message: 'Ads configuration saved', config: config.ads });
    } else {
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  } catch (error) {
    console.error('Error updating ads config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// ============================================
// CONTENT MANAGEMENT API (products, certs, contacts, branding)
// ============================================

// dataDir + these dirs are declared/created near the top (persistent-storage
// block) so they respect DATA_DIR / UPLOADS_DIR overrides.
const productsPath = path.join(dataDir, 'products.json');
const certsPath = path.join(dataDir, 'certifications.json');
const contactsPath = path.join(dataDir, 'contact-details.json');
const brandingPath = path.join(dataDir, 'branding.json');
const socialPath = path.join(dataDir, 'social-links.json');
const inquiriesPath = path.join(dataDir, 'inquiries.json');
const MAX_INQUIRIES = 1000;

// Generic JSON file helpers
function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    // A corrupt file must not crash a read — return the default and log loudly
    // so the health check / logs surface it rather than the whole endpoint 500ing.
    logError('json_read_failed', error, { file: path.basename(filePath) });
  }
  return defaultValue;
}

// F4: atomic write. Writing directly with writeFileSync means a crash or a
// concurrent write mid-write leaves a truncated, unparseable file — and this is
// the live source of truth for products/contacts/etc. Instead write to a temp
// file in the same directory, fsync it, then rename() over the target (atomic on
// the same filesystem). A rejected write leaves the previous good file intact.
function atomicWriteFileSync(filePath, contents) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

// Synchronous + atomic. writeFileSync is blocking, so within this single-process
// server two writes cannot interleave; the atomic temp+rename covers the
// crash-mid-write and multi-worker cases. Keeps the boolean contract callers use
// (a false return still becomes a 500 for the admin, so a real failure is seen).
function writeJsonFile(filePath, data) {
  try {
    atomicWriteFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    logError('json_write_failed', error, { file: path.basename(filePath) });
    return false;
  }
}

// Persist a submitted inquiry so it's reviewable in the admin "Inquiries" tab.
// The lead is captured here regardless of whether the notification email is
// delivered, so an SMTP outage never silently loses a customer. Newest first,
// capped at MAX_INQUIRIES so the file can't grow unbounded. Values are stored
// raw (not HTML) — the admin UI renders them as text content, never as markup.
function recordInquiryRecord(data, emailed) {
  try {
    const list = readJsonFile(inquiriesPath, []);
    if (!Array.isArray(list)) return null;
    const rec = {
      id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      name: String(data.name || '').trim().slice(0, 100),
      email: String(data.email || '').trim().slice(0, 200),
      company: String(data.company || '').trim().slice(0, 100),
      product: String(data.product || '').trim().slice(0, 200),
      phone: String(data.phone || '').trim().slice(0, 40),
      message: String(data.message || '').trim().slice(0, 2000),
      line: lineOfProduct(data.product),
      emailed: !!emailed,
      status: 'new'
    };
    if (data.design) rec.design = data.design;
    list.unshift(rec);
    if (list.length > MAX_INQUIRIES) {
      for (const old of list.slice(MAX_INQUIRIES)) if (old.files?.length) workspace.removeLeadFiles(old.id);
      list.length = MAX_INQUIRIES;
    }
    writeJsonFile(inquiriesPath, list);
    return rec;
  } catch (err) {
    logError('inquiry_record_failed', err);
    return null;
  }
}

function updateInquiryRecord(id, patchFields) {
  try {
    const list = readJsonFile(inquiriesPath, []);
    const rec = Array.isArray(list) && list.find((i) => i.id === id);
    if (!rec) return false;
    Object.assign(rec, patchFields);
    return writeJsonFile(inquiriesPath, list);
  } catch (err) {
    logError('inquiry_update_failed', err);
    return false;
  }
}

// The bag design a visitor made in the packaging studio, kept so the packaging
// team can re-render it. Only known settings, in range, are stored.
function cleanDesign(d) {
  if (!d || typeof d !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');
  const numIn = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  return {
    template: str(d.template, 40), templateName: str(d.templateName, 60),
    size: ['small', 'medium', 'large'].includes(d.size) ? d.size : 'medium',
    ink: ['black', 'teal', 'leaf', 'red', 'white'].includes(d.ink) ? d.ink : 'black',
    text1: str(d.text1, 18), text2: str(d.text2, 28),
    scale: numIn(d.scale, 0.5, 1.4, 1), dx: numIn(d.dx, -400, 400, 0), dy: numIn(d.dy, -600, 600, 0),
    oneInk: d.oneInk === true, hasLogo: d.hasLogo === true,
  };
}

// Slug helper for product/cert IDs
function makeSlug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ----- PRODUCTS -----

// GET /api/products (public)
app.get('/api/products', (req, res) => {
  const products = readJsonFile(productsPath, []);
  res.json(products);
});

// POST /api/products (admin) — replace entire list OR upsert single
// Body: { products: [...] } to replace all
//   OR  { product: {...} } to add/update a single product (matched by id)
app.post('/api/products', adminAuth, (req, res) => {
  const { products, product } = req.body;

  if (Array.isArray(products)) {
    if (!writeJsonFile(productsPath, products)) {
      return res.status(500).json({ error: 'Failed to save products' });
    }
    return res.json({ success: true, count: products.length });
  }

  if (product && typeof product === 'object') {
    // Validate required fields
    if (!product.name || !product.description) {
      return res.status(400).json({ error: 'Product name and description are required' });
    }
    const list = readJsonFile(productsPath, []);
    const id = product.id || makeSlug(product.name);
    const idx = list.findIndex(p => p.id === id);
    const normalized = {
      id,
      name: String(product.name).slice(0, 200),
      category: String(product.category || 'General').slice(0, 50),
      description: String(product.description).slice(0, 2000),
      purity: String(product.purity || '').slice(0, 50),
      moq: String(product.moq || '').slice(0, 50),
      specs: Array.isArray(product.specs) ? product.specs.slice(0, 20).map(s => String(s).slice(0, 200)) : [],
      image: product.image || null
    };
    if (idx >= 0) list[idx] = normalized;
    else list.push(normalized);

    if (!writeJsonFile(productsPath, list)) {
      return res.status(500).json({ error: 'Failed to save product' });
    }
    return res.json({ success: true, product: normalized });
  }

  res.status(400).json({ error: 'Body must contain either { products: [...] } or { product: {...} }' });
});

// POST /api/products/order (admin) — body { ids: [...] }. Reorders the existing
// products only (unknown ids are ignored, missing ones keep their relative order
// at the end), so a stale admin tab can never drop or invent a product. The
// first product is the front card of the agriculture page's stack.
app.post('/api/products/order', adminAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return res.status(400).json({ error: 'Body must be { ids: [string, ...] }' });
  }
  const list = readJsonFile(productsPath, []);
  const byId = new Map(list.map((p) => [p.id, p]));
  const seen = new Set();
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
  }
  for (const p of list) if (!seen.has(p.id)) ordered.push(p);
  if (!writeJsonFile(productsPath, ordered)) {
    return res.status(500).json({ error: 'Failed to save order' });
  }
  res.json({ success: true, ids: ordered.map((p) => p.id) });
});

// DELETE /api/products/:id (admin)
app.delete('/api/products/:id', adminAuth, (req, res) => {
  const list = readJsonFile(productsPath, []);
  const next = list.filter(p => p.id !== req.params.id);
  if (next.length === list.length) {
    return res.status(404).json({ error: 'Product not found' });
  }
  if (!writeJsonFile(productsPath, next)) {
    return res.status(500).json({ error: 'Failed to delete' });
  }
  res.json({ success: true });
});

// ----- CERTIFICATIONS -----

app.get('/api/certifications', (req, res) => {
  res.json(readJsonFile(certsPath, []));
});

app.post('/api/certifications', adminAuth, (req, res) => {
  const { certifications, certification } = req.body;

  if (Array.isArray(certifications)) {
    if (!writeJsonFile(certsPath, certifications)) {
      return res.status(500).json({ error: 'Failed to save certifications' });
    }
    return res.json({ success: true, count: certifications.length });
  }

  if (certification && typeof certification === 'object') {
    if (!certification.name || !certification.description) {
      return res.status(400).json({ error: 'Name and description required' });
    }
    const list = readJsonFile(certsPath, []);
    const id = certification.id || makeSlug(certification.name);
    const idx = list.findIndex(c => c.id === id);
    const normalized = {
      id,
      name: String(certification.name).slice(0, 200),
      description: String(certification.description).slice(0, 500),
      image: certification.image || null
    };
    if (idx >= 0) list[idx] = normalized;
    else list.push(normalized);

    if (!writeJsonFile(certsPath, list)) {
      return res.status(500).json({ error: 'Failed to save certification' });
    }
    return res.json({ success: true, certification: normalized });
  }

  res.status(400).json({ error: 'Body must contain either { certifications: [...] } or { certification: {...} }' });
});

app.delete('/api/certifications/:id', adminAuth, (req, res) => {
  const list = readJsonFile(certsPath, []);
  const next = list.filter(c => c.id !== req.params.id);
  if (next.length === list.length) {
    return res.status(404).json({ error: 'Certification not found' });
  }
  if (!writeJsonFile(certsPath, next)) {
    return res.status(500).json({ error: 'Failed to delete' });
  }
  res.json({ success: true });
});

// ----- CONTACT DETAILS -----

// Phone numbers are kept away from scrapers: the public response leaves them
// out, and a visitor gets them only by pressing a call or WhatsApp icon, which
// calls POST /api/contact/reveal. A signed-in admin gets the full record.
function isAdminRequest(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return false;
  const r = verifyTokenDetailed(token, clientIp(req));
  return r.valid && isAdminPayload(r.payload);
}

app.get('/api/contact-details', (req, res) => {
  const data = readJsonFile(contactsPath, { phones: [], emails: [] });
  if (isAdminRequest(req)) return res.json(data);
  const { phones, ...rest } = data;
  res.set('Cache-Control', 'no-store');
  res.json({ ...rest, phones: [] });
});

// POST /api/contact/reveal: the numbers behind the call and WhatsApp icons.
// POST (not a link a crawler follows), rate limited, never cached, bots refused.
const revealLimit = makeRateLimiter(Number(process.env.REVEAL_RATE_PER_MIN) || 20, 'contact-reveal');
app.post('/api/contact/reveal', revealLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  if (BOT_RE.test(String(req.headers['user-agent'] || ''))) return res.status(403).json({ error: 'Forbidden' });
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  const c = readJsonFile(contactsPath, { phones: [] });
  const social = readJsonFile(socialPath, {});
  const dial = (p) => String(p || '').replace(/[^\d+]/g, '');
  const phones = (Array.isArray(c.phones) ? c.phones : []).filter(Boolean).slice(0, 4)
    .map((p, i) => ({ label: i === 0 ? 'Sales' : i === 1 ? 'Office' : 'Phone', display: String(p).slice(0, 50), href: 'tel:' + dial(p) }));
  const mainDigits = dial(c.phones?.[0]).replace('+', '');
  const waUrl = sanitizeSocialUrl(social.whatsapp || '') || (mainDigits ? 'https://wa.me/' + mainDigits : '');
  const waDigits = (waUrl.match(/wa\.me\/(\d{8,15})/) || [])[1];
  res.json({
    phones,
    whatsapp: waUrl ? { href: waUrl, display: waDigits ? (waDigits === mainDigits ? phones[0].display : '+' + waDigits) : 'WhatsApp chat' } : null
  });
});

// Keep only known text fields (trimmed, capped) plus numeric coordinates. The
// public pages print these at build time, so a stray object or a non-numeric
// latitude must never reach them.
function cleanPlace(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) out[k] = obj[k].trim().slice(0, 120);
  for (const [k, lim] of [['lat', 90], ['lng', 180]]) {
    const v = typeof obj[k] === 'string' ? Number(obj[k]) : obj[k];
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

app.post('/api/contact-details', adminAuth, (req, res) => {
  const { phones, emails, address, office, factory } = req.body;

  const data = {
    phones: Array.isArray(phones) ? phones.slice(0, 20).map(p => String(p).slice(0, 50)) : [],
    emails: Array.isArray(emails) ? emails.slice(0, 20).map(e => String(e).slice(0, 200)) : [],
    address: cleanPlace(address, ['line1', 'line2', 'poBox', 'city', 'country']),
    office: cleanPlace(office, ['label', 'name', 'city']),
    factory: cleanPlace(factory, ['label', 'name', 'city'])
  };

  if (!writeJsonFile(contactsPath, data)) {
    return res.status(500).json({ error: 'Failed to save contact details' });
  }
  res.json({ success: true, data });
});

// ----- BRANDING (logo + tagline) -----

app.get('/api/branding', (req, res) => {
  res.json(readJsonFile(brandingPath, { logo: null, tagline: '' }));
});

app.post('/api/branding', adminAuth, (req, res) => {
  const { logo, tagline } = req.body;
  const current = readJsonFile(brandingPath, { logo: null, tagline: '' });
  const next = {
    logo: logo !== undefined ? logo : current.logo,
    tagline: tagline !== undefined ? String(tagline).slice(0, 500) : current.tagline
  };
  if (!writeJsonFile(brandingPath, next)) {
    return res.status(500).json({ error: 'Failed to save branding' });
  }
  res.json({ success: true, data: next });
});

// ----- SOCIAL LINKS -----

const SOCIAL_PLATFORMS = ['facebook', 'linkedin', 'x', 'youtube', 'telegram', 'whatsapp'];

// Accept only empty string or a valid http(s) URL (≤300 chars) per platform.
function sanitizeSocialUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 300);
  if (s === '') return '';
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  return ''; // reject anything that isn't a clean http(s) URL
}

app.get('/api/social-links', (req, res) => {
  const data = readJsonFile(socialPath, {});
  if (isAdminRequest(req)) return res.json(data);
  // a WhatsApp link carries a phone number; the public gets it via /api/contact/reveal
  const { whatsapp, ...rest } = data;
  res.json({ ...rest, whatsapp: whatsapp ? 'set' : '' });
});

app.post('/api/social-links', adminAuth, (req, res) => {
  const body = req.body || {};
  const data = {};
  for (const key of SOCIAL_PLATFORMS) {
    data[key] = sanitizeSocialUrl(body[key]);
  }
  if (!writeJsonFile(socialPath, data)) {
    return res.status(500).json({ error: 'Failed to save social links' });
  }
  res.json({ success: true, data });
});

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

const BOT_RE = /bot|crawler|spider|crawling|slurp|bingpreview|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|monitor|preview/i;

// Loaded once, mutated in memory, flushed on a timer so a burst of pageviews
// doesn't hammer the disk.
let analytics = readJsonFile(analyticsPath, { days: {} });
if (!analytics || typeof analytics !== 'object' || !analytics.days) analytics = { days: {} };
let analyticsDirty = false;

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function visitorHash(ip, ua, dayKey) {
  return crypto.createHash('sha256').update(`${ip}|${ua}|${dayKey}|${JWT_SECRET}`).digest('base64url').slice(0, 16);
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
    inquiryLines: {}   // agri / pack
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
  return d;
}

// ---- insight helpers ----
// Same-day funnel: each daily visitor hash keeps a bitmask of what that visitor
// did. Hashes rotate daily, so a person is never followed across days.
const STEP = { visit: 1, agri: 2, pack: 4, product: 8, studio: 16, contactAgri: 32, enquiryAgri: 64, enquiryPack: 128, contactPack: 256, contactHome: 512 };
// lineOfProduct (agriculture or packaging, from the product name) comes from lib/workspace.js
const bump = (obj, key, n = 1, cap = 200) => {
  if (obj[key] === undefined && Object.keys(obj).length >= cap) key = 'other';
  obj[key] = (obj[key] || 0) + n;
};
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
const TRACK_EVENTS = new Set(['reveal_phone', 'reveal_whatsapp', 'telegram', 'email', 'studio_logo', 'studio_download', 'studio_quote', 'studio_change', 'form_start', 'form_invalid', 'form_fail']);

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
function recordInquiry(product, req) {
  const day = getDay(todayKey());
  day.inquiries++;
  const name = typeof product === 'string' && product.trim() ? product.trim().slice(0, 80) : 'Not specified';
  day.inquiryProducts[name] = (day.inquiryProducts[name] || 0) + 1;
  const line = lineOfProduct(name);
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
    d.products[name] = (d.products[name] || 0) + 1;
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
  day.pages[rawPath] = (day.pages[rawPath] || 0) + 1;
  bump(day.heat, eatHeatKey(), 1, 7 * 24);

  const utm = { source: cleanTag(body.utm?.source), medium: cleanTag(body.utm?.medium), campaign: cleanTag(body.utm?.campaign) };
  if (utm.source) bump(day.campaigns, [utm.source, utm.medium || '(none)', utm.campaign || '(none)'].join(' / '), 1, 60);
  const lang = typeof body.lang === 'string' && /^[a-z]{2,3}(-[a-z]{2})?$/i.test(body.lang) ? body.lang.slice(0, 2).toLowerCase() + body.lang.slice(2).toUpperCase() : '';
  if (lang) bump(day.langs, lang, 1, 60);
  const cc = String(req.headers['cf-ipcountry'] || '').toUpperCase();
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
  day.referrers[refHost] = (day.referrers[refHost] || 0) + 1;
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
    inquiryLines: {}, funnel: {}, eng: {}, leaves: 0, engaged: 0, secs: 0, trackedDays: 0
  };
  const add = (target, src) => { for (const [k, v] of Object.entries(src || {})) target[k] = (target[k] || 0) + (Number(v) || 0); };
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

// GET /api/analytics?days=30 (admin) — aggregated summary for the period and
// the one before it. Visitor hashes are counted server-side and never returned.
app.get('/api/analytics', adminAuth, (req, res) => {
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

// ----- FILE UPLOADS (multer) -----
// uploadsDir + productImagesDir declared/created in the persistent-storage
// block near the top (respect UPLOADS_DIR override).

// Use memory storage so we can pipe through sharp before writing to disk
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB raw upload cap (will be compressed)
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, SVG, or GIF images are allowed'));
  }
});

/**
 * Process an uploaded image buffer:
 *   - Everything (including SVG) is rasterized + resized + converted to WebP.
 *     SVGs are rasterized rather than stored verbatim to remove any embedded
 *     scripting (stored-XSS protection).
 *   - Optionally writes a thumbnail at 480px wide.
 *
 * Returns { fullPath, thumbPath } as public-relative URLs.
 */
async function processAndSaveImage(buffer, mimeType, outputDir, baseName, options = {}) {
  const { maxWidth = 1200, thumbWidth = 480, makeThumb = true, quality = 82 } = options;

  // SECURITY: never store an uploaded SVG verbatim. An SVG can embed
  // <script>/on* handlers, and when opened directly at its /uploads URL it
  // executes in our origin (the page CSP doesn't govern a directly-viewed
  // SVG) — a stored-XSS vector. Rasterizing through sharp discards all
  // scripting and yields a safe WebP. `density` keeps small vector logos crisp.
  // (Falls through to the raster path below with the same output as any image.)

  // Raster (and rasterized SVG): resize + convert to WebP. Higher density on
  // SVG input so vector logos rasterize crisply rather than blurry.
  const isSvg = mimeType === 'image/svg+xml';
  const sharpOpts = isSvg ? { density: 300 } : {};
  const fullName = `${baseName}.webp`;
  const fullOut = path.join(outputDir, fullName);
  await sharp(buffer, sharpOpts)
    .rotate() // honor EXIF orientation
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toFile(fullOut);

  let thumbName = fullName;
  if (makeThumb) {
    thumbName = `${baseName}-thumb.webp`;
    await sharp(buffer, sharpOpts)
      .rotate()
      .resize({ width: thumbWidth, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(path.join(outputDir, thumbName));
  }

  return { fullPath: fullName, thumbPath: thumbName };
}

// POST /api/upload/product-image (admin) — auto-resize to 1200px WebP + 480px thumb
app.post('/api/upload/product-image', adminAuth, (req, res) => {
  memoryUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const baseName = `${makeSlug(req.body.productId || 'product')}-${Date.now()}`;
      const { fullPath, thumbPath } = await processAndSaveImage(
        req.file.buffer,
        req.file.mimetype,
        productImagesDir,
        baseName,
        { maxWidth: 1200, thumbWidth: 480 }
      );
      res.json({
        success: true,
        path: `/uploads/products/${fullPath}`,
        thumb: `/uploads/products/${thumbPath}`,
        originalSize: req.file.size
      });
    } catch (error) {
      console.error('Image processing error:', error);
      res.status(500).json({ error: 'Failed to process image' });
    }
  });
});

// POST /api/upload/logo (admin) — resize to 600px WebP, no thumb (logos are small)
app.post('/api/upload/logo', adminAuth, (req, res) => {
  memoryUpload.single('logo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const baseName = `logo-${Date.now()}`;
      const { fullPath } = await processAndSaveImage(
        req.file.buffer,
        req.file.mimetype,
        uploadsDir,
        baseName,
        { maxWidth: 600, makeThumb: false, quality: 90 }
      );
      const publicPath = `/uploads/${fullPath}`;
      // Persist new logo path in branding.json so all pages can read it
      const branding = readJsonFile(brandingPath, { logo: null, tagline: '' });
      branding.logo = publicPath;
      writeJsonFile(brandingPath, branding);
      res.json({ success: true, path: publicPath, originalSize: req.file.size });
    } catch (error) {
      console.error('Logo processing error:', error);
      res.status(500).json({ error: 'Failed to process logo' });
    }
  });
});

// ----- TEAM WORKSPACES AND PACKAGING PRODUCTS (lib/workspace.js, lib/packaging.js) -----
const siteUrl = () => String(process.env.SITE_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || 'https://oliraagroindustry.com').trim().replace(/\/+$/, '');
const workspace = registerWorkspace(app, {
  dataDir, readJsonFile, writeJsonFile, audit, logError, sendEmail, loadEmailConfig,
  verifyTokenDetailed, generateToken, checkOrigin, clientIp, makeRateLimiter,
  inquiriesPath, isLoginDisabled: () => adminLoginDisabled, siteUrl,
});
registerPackaging(app, {
  dataDir, uploadsDir, publicDirs: [path.join(__dirname, 'dist'), path.join(__dirname, 'public')],
  readJsonFile, writeJsonFile, audit, logError, adminAuth, resolveUser: workspace.resolveUser,
});

// Health check
// F5: a health check that actually checks health. Verifies the things that have
// silently broken in production — data/uploads writable, analytics parseable,
// build present, admin login state. Returns 503 (with reasons) when degraded so
// an uptime monitor has something real to watch.
app.get('/api/health', (req, res) => {
  const checks = {};
  const canWrite = (dir) => {
    try {
      const probe = path.join(dir, `.health-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return true;
    } catch { return false; }
  };

  checks.dataDirWritable = canWrite(dataDir);
  checks.uploadsDirWritable = canWrite(uploadsDir);
  checks.distPresent = !process.env.NODE_ENV || process.env.NODE_ENV !== 'production' || fs.existsSync(path.join(distPath, 'index.html'));
  try { JSON.parse(fs.readFileSync(analyticsPath, 'utf8')); checks.analyticsParseable = true; }
  catch (e) { checks.analyticsParseable = !fs.existsSync(analyticsPath); } // absent is fine (fresh)
  checks.adminLoginEnabled = !adminLoginDisabled;

  // adminLoginEnabled is informational, not a failure condition (the public site
  // is healthy even when admin login is intentionally disabled).
  const failing = Object.entries(checks)
    .filter(([k, v]) => v === false && k !== 'adminLoginEnabled')
    .map(([k]) => k);

  const healthy = failing.length === 0;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    failing,
    timestamp: new Date().toISOString()
  });
});

// Serve static files from dist directory (Astro build output)
// Must come after all API routes to not interfere with them
const distPath = path.join(__dirname, 'dist');

// Cache control middleware for static assets
app.use((req, res, next) => {
  // Set cache headers based on file type
  if (req.url.match(/\.(js|css|woff|woff2|ttf|otf|eot)$/i)) {
    // Versioned assets (hashed filenames) can be cached long-term
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i)) {
    // Images can be cached for a month
    res.setHeader('Cache-Control', 'public, max-age=2592000');
  } else if (req.url.match(/\.(html|json)$/i)) {
    // HTML and JSON files should have shorter cache or no cache
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
  next();
});

// Serve uploaded files (logos, product images) — these live outside dist/
// because they're created at runtime, not build time. Uses uploadsDir so a
// persistent UPLOADS_DIR is served correctly.
app.use('/uploads', express.static(uploadsDir));

app.use(express.static(distPath));

// Fallback for unmatched routes. express.static above already served every
// real page (/, /admin/, etc.), so anything reaching here is genuinely not
// found: serve the custom 404 page with a real 404 status (not a soft-404
// that returns the homepage with 200 and hurts SEO).
app.get('*', (req, res) => {
  const notFoundPath = path.join(distPath, '404.html');
  if (fs.existsSync(notFoundPath)) {
    return res.status(404).sendFile(notFoundPath);
  }
  res.status(404).send('Not found');
});

// F1: global error handler — MUST be last. Any error thrown or passed to
// next(err) anywhere lands here instead of leaking a generic HTML 500 with no
// server-side record (which is exactly how the CORS bug hid for hours). Logs the
// full error with a short correlation id that's also returned to the client, so
// a user-reported failure can be matched to a log line. Never leaks internals.
app.use((err, req, res, next) => {
  const id = crypto.randomBytes(5).toString('hex');
  logError('unhandled_request_error', err, { id, method: req.method, path: req.path });
  if (res.headersSent) return next(err);
  res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500)
    .json({ error: 'Internal server error', id });
});

// F13: masked config summary — logged at startup so a misconfiguration is
// visible immediately instead of surfacing as a mysterious failure later.
// Never prints secret VALUES, only whether each is set and looks sane.
function logConfigSummary() {
  const isProd = process.env.NODE_ENV === 'production';
  const mask = (v) => (v ? `set (${v.length} chars)` : 'MISSING');
  const rows = [
    ['NODE_ENV', process.env.NODE_ENV || 'development'],
    ['PORT', String(PORT)],
    ['JWT_SECRET', mask(process.env.JWT_SECRET)],
    ['ADMIN_PASSWORD', mask(process.env.ADMIN_PASSWORD)],
    ['DATA_DIR', dataDir],
    ['UPLOADS_DIR', uploadsDir],
    ['CORS_ORIGINS', process.env.CORS_ORIGINS || (isProd ? 'MISSING (same-origin still allowed)' : 'dev: localhost allowed')],
    ['SMTP', (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) ? 'configured' : 'not configured (email disabled)'],
  ];
  console.log('\nConfiguration:');
  for (const [k, v] of rows) console.log(`   ${k.padEnd(15)} ${v}`);

  // Catch a common fat-finger: env var names with hyphens instead of underscores
  // (DATA-DIR vs DATA_DIR) are silently ignored by the code — surface them.
  const suspects = Object.keys(process.env).filter((k) => /-(DIR|SECRET|PASSWORD|ORIGINS|HOST|USER|PORT)$/i.test(k) || /^(DATA|UPLOADS|JWT|ADMIN|SMTP|CORS)-/i.test(k));
  if (suspects.length) {
    console.warn(`   WARNING: env vars with hyphens look like typos (use underscores): ${suspects.join(', ')}`);
  }
}

// Startup validation.
// F3: weak/missing ADMIN secrets DISABLE admin login but do NOT stop the server
// — the public storefront must stay up. Only conditions that make the app unable
// to serve at all are surfaced as errors (and even those no longer exit, so a
// deploy always comes up and the /api/health check can report what's wrong).
function validateStartup() {
  const warnings = [];
  const adminIssues = [];
  const isProd = process.env.NODE_ENV === 'production';

  // Build artifacts (only required in production, dev runs from src)
  if (isProd) {
    if (!fs.existsSync(distPath)) warnings.push('dist directory not found — run "npm run build". Static site will 404 until built.');
    else if (!fs.existsSync(path.join(distPath, 'index.html'))) warnings.push('dist/index.html not found — build is incomplete.');
  }

  // Adopt a dropped reset file at boot too (restart-free recovery also works the
  // moment the app does start).
  adoptResetIfPresent();

  // Admin secrets — weakness disables admin login, never kills the site.
  const jwtDefault = !process.env.JWT_SECRET || process.env.JWT_SECRET === 'default_secret_change_in_production';
  const jwtWeak = process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32;
  if (jwtDefault) adminIssues.push('JWT_SECRET is missing or default');
  else if (jwtWeak) adminIssues.push('JWT_SECRET is shorter than 32 chars');

  // A DATA_DIR/auth.json override (set via the panel or a reset file) is a valid
  // 12+ char credential and keeps login enabled even if the env var is weak.
  if (!hasUsableAdminCredential()) {
    const pwDefault = !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'change_me_in_production';
    adminIssues.push(pwDefault ? 'no usable admin credential (ADMIN_PASSWORD missing/default and no auth.json)' : 'ADMIN_PASSWORD is shorter than 12 chars and no auth.json override');
  }

  // In production, unsafe admin secrets lock the admin door. In dev they're only
  // a warning (localhost convenience).
  if (isProd && adminIssues.length) {
    adminLoginDisabled = true;
  }

  if (isProd && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
    warnings.push('SMTP not configured — the contact form cannot send email.');
  }

  if (adminIssues.length) {
    (isProd ? console.error : console.warn)(
      `\n${isProd ? 'ADMIN LOGIN DISABLED' : 'ADMIN WARNINGS (dev)'}: ${adminIssues.join('; ')}.`
    );
    if (isProd) console.error('  The public site is serving normally; fix these and restart to re-enable /admin.');
  }
  if (warnings.length) {
    console.warn('\nSTARTUP WARNINGS');
    warnings.forEach((w) => console.warn('  ' + w));
  }
  return true;
}

// NOTE: WebP conversion of public/ assets is a BUILD step (see package.json
// `build`), not a per-boot task. Running it on every boot cost startup time and
// wrote into public/ — which is read-only on some hosts (cPanel/containers).
// Runtime uploads are still converted inline by the sharp pipeline above.

// Only run startup side effects (validation, email init, listen) when this file
// is executed directly — NOT when it's imported (e.g. by the test suite). This
// is what makes the app testable: `import { app } from './server.js'` builds the
// Express app without binding a port or exiting the process.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function startServer() {
  logConfigSummary();
  validateStartup();
  initializeEmailConfig();

  // F1 backstops. These catch errors that escape the request lifecycle (stray
  // async rejections, etc.). We log but do NOT exit: a single stray error should
  // not take the whole storefront down. Registered only when actually serving,
  // so the test runner's own error handling is left untouched.
  process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
  process.on('uncaughtException', (err) => logError('uncaughtException', err));

  return app.listen(PORT, () => {
    console.log(`\nOlira Agro API Server running on http://localhost:${PORT}`);
    console.log(`Email configuration: ${process.env.SMTP_USER ? 'Environment variables' : 'File-based'}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Admin login: ${adminLoginDisabled ? 'DISABLED (weak/missing ADMIN_PASSWORD)' : 'enabled'}`);
    console.log(`\nStatic files: ${fs.existsSync(distPath) ? 'Found' : 'Not found'}\n`);
  });
}

if (isMainModule) {
  startServer();
}

export { app, startServer };
