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
import { convertTreeToWebp } from './scripts/convert-to-webp.mjs';

// Load environment variables from .env file (if it exists)
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

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

// Request counter for rate limiting
const requestCounts = new Map();

// Rate limiting middleware (5 requests per minute per IP)
const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }

  const timestamps = requestCounts.get(ip).filter(t => t > windowStart);

  if (timestamps.length >= 5) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  timestamps.push(now);
  requestCounts.set(ip, timestamps);
  next();
};

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
      console.warn(`CORS rejected origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "fonts.googleapis.com"],
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

// Stronger rate limiting for admin login (3 requests per minute per IP)
const adminRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }

  const timestamps = requestCounts.get(ip).filter(t => t > windowStart);

  if (timestamps.length >= 3) {
    console.warn(`Admin login rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  timestamps.push(now);
  requestCounts.set(ip, timestamps);
  next();
};

// Rate limiting on API endpoints
app.use('/api/admin/login', adminRateLimit);
app.use('/api/inquiry', rateLimit);
app.use('/api/email-config', rateLimit);

// Email config file path
const emailConfigPath = path.join(__dirname, 'email-config.json');

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
async function sendEmail(to, subject, htmlContent) {
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

  const mailOptions = {
    from: `${config.fromName} <${config.smtpUser}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };

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

// Constant-time string comparison (prevents timing attacks)
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // length is observable but we can't avoid it
  return crypto.timingSafeEqual(ab, bb);
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
function generateToken(ip) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    iph: ipHash(ip)
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

  const ok = safeCompare(password, ADMIN_PASSWORD);
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

  next();
};

// Verify token. Used by the admin page on load to decide whether to show
// login or dashboard. All failure modes (missing/invalid/expired/revoked/
// ip_mismatch) collapse to 401 so probing yields no information.
app.get('/api/admin/verify', (req, res) => {
  const ip = clientIp(req);
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ valid: false });
  const result = verifyTokenDetailed(token, ip);
  if (!result.valid) return res.status(401).json({ valid: false });
  res.json({ valid: true });
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
app.post('/api/inquiry', async (req, res) => {
  const { name, email, company, message, product, phone } = req.body;

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

  if (product && (typeof product !== 'string' || product.length > 50)) {
    return res.status(400).json({ error: 'Invalid product field' });
  }

  if (phone && (typeof phone !== 'string' || phone.length > 20)) {
    return res.status(400).json({ error: 'Invalid phone field' });
  }

  const config = loadEmailConfig();
  if (!config || !config.recipientEmail) {
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
      </div>
      <div style="background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px;">
        <p style="margin: 0;">This is an automated inquiry from Olira Agro Industry website</p>
      </div>
    </div>
  `;

  try {
    await sendEmail(config.recipientEmail, `New Product Inquiry: ${sanitizedProduct}`, htmlContent);

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

    res.json({ success: true, message: 'Inquiry sent successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send inquiry. Please try again.' });
  }
});

// ============================================
// MARKETING INTEGRATIONS API
// ============================================

// Path to integrations config file
const integrationsConfigPath = path.join(__dirname, 'integrations-config.json');

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
    console.log('✅ Integrations config initialized');
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
    console.log('✅ Integrations config saved');
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
app.post('/api/integrations/analytics', rateLimit, (req, res) => {
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
app.post('/api/integrations/ads', rateLimit, (req, res) => {
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

// Generic JSON file helpers
function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
  }
  return defaultValue;
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    return false;
  }
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

app.get('/api/contact-details', (req, res) => {
  res.json(readJsonFile(contactsPath, { phones: [], emails: [] }));
});

app.post('/api/contact-details', adminAuth, (req, res) => {
  const { phones, emails, address, office, factory } = req.body;

  const data = {
    phones: Array.isArray(phones) ? phones.slice(0, 20).map(p => String(p).slice(0, 50)) : [],
    emails: Array.isArray(emails) ? emails.slice(0, 20).map(e => String(e).slice(0, 200)) : [],
    address: address && typeof address === 'object' ? address : null,
    office: office && typeof office === 'object' ? office : null,
    factory: factory && typeof factory === 'object' ? factory : null
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
  res.json(readJsonFile(socialPath, {}));
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
 *   - SVG passes through unchanged (already vector-scalable, tiny files)
 *   - Raster images are resized to a max width and converted to WebP
 *   - Optionally writes a thumbnail at 480px wide
 *
 * Returns { fullPath, thumbPath } as public-relative URLs.
 */
async function processAndSaveImage(buffer, mimeType, outputDir, baseName, options = {}) {
  const { maxWidth = 1200, thumbWidth = 480, makeThumb = true, quality = 82 } = options;

  // SVG: write as-is (sharp can rasterize SVG but keeping vector preserves quality + saves CPU)
  if (mimeType === 'image/svg+xml') {
    const filename = `${baseName}.svg`;
    fs.writeFileSync(path.join(outputDir, filename), buffer);
    return { fullPath: filename, thumbPath: filename };
  }

  // Raster: resize + convert to WebP
  const fullName = `${baseName}.webp`;
  const fullOut = path.join(outputDir, fullName);
  await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toFile(fullOut);

  let thumbName = fullName;
  if (makeThumb) {
    thumbName = `${baseName}-thumb.webp`;
    await sharp(buffer)
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'API running', timestamp: new Date().toISOString() });
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

// SPA fallback - serve index.html for all non-API routes
// This catches all remaining GET requests and serves the single page app
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// Startup validation — fails closed in production for any weak admin secret.
function validateStartup() {
  const errors = [];
  const warnings = [];
  const isProd = process.env.NODE_ENV === 'production';

  // Build artifacts (only required in production, dev runs from src)
  if (isProd) {
    if (!fs.existsSync(distPath)) errors.push('❌ dist directory not found. Run "npm run build" first.');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) errors.push('❌ dist/index.html not found.');
  }

  // JWT secret — hard fail in production, warn in dev
  const jwtDefault = !process.env.JWT_SECRET || process.env.JWT_SECRET === 'default_secret_change_in_production';
  const jwtWeak = process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32;
  if (jwtDefault) (isProd ? errors : warnings).push(
    `${isProd ? '❌' : '⚠️ '} JWT_SECRET ${isProd ? 'must' : 'should'} be set to a strong random value (≥32 chars).`
  );
  if (jwtWeak) warnings.push('⚠️  JWT_SECRET is shorter than 32 chars — increase entropy.');

  // Admin password — hard fail in production
  const pwDefault = !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'change_me_in_production';
  const pwWeak = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12;
  if (pwDefault) (isProd ? errors : warnings).push(
    `${isProd ? '❌' : '⚠️ '} ADMIN_PASSWORD ${isProd ? 'must' : 'should'} be set to a strong password (≥12 chars).`
  );
  if (pwWeak) (isProd ? errors : warnings).push(
    `${isProd ? '❌' : '⚠️ '} ADMIN_PASSWORD is shorter than 12 chars — strengthen it.`
  );

  // SMTP (warning only — site runs without email)
  if (isProd && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
    warnings.push('⚠️  SMTP not configured. Email features (contact form) will not work.');
  }

  if (errors.length > 0) {
    console.error('\n❌ STARTUP VALIDATION FAILED');
    errors.forEach(err => console.error('  ' + err));
    console.error('\nFix the above and restart. In production these are hard failures by design.');
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.warn('\n⚠️  STARTUP WARNINGS');
    warnings.forEach(warn => console.warn('  ' + warn));
  }
  return true;
}

// Initialize and start server
validateStartup();
initializeEmailConfig();

// Auto-convert any PNG/JPEG in public/ to WebP companions on every server boot.
// Skips files that already have a .webp twin and the runtime upload pipeline's
// uploads/ directory (those are processed inline by sharp at upload time).
const publicDir = path.join(__dirname, 'public');
convertTreeToWebp(publicDir, { quality: 82 })
  .then((stats) => {
    if (stats.converted > 0) {
      console.log(`🌿 WebP pass: converted=${stats.converted} skipped=${stats.skipped} failed=${stats.failed}`);
    }
  })
  .catch((err) => console.warn('WebP startup pass failed:', err.message));

app.listen(PORT, () => {
  console.log(`\n🌿 Olira Agro API Server running on http://localhost:${PORT}`);
  console.log(`📧 Email configuration: ${process.env.SMTP_USER ? 'Environment variables' : 'File-based'}`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n⚡ API endpoints:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/admin/login`);
  console.log(`   GET  /api/email-config (admin)`);
  console.log(`   POST /api/email-config (admin)`);
  console.log(`   POST /api/inquiry`);
  console.log(`\n📍 Static files: ${fs.existsSync(distPath) ? '✓ Found' : '✗ Not found'}\n`);
});
