// BOX web-guards: what stands in front of every request, in this order: one site
// address, request log, security headers (the Content-Security-Policy is lib/csp.js),
// allowed origins, JSON bodies. Also makes the rate limiters the other boxes use.
// Express runs these in the order they are added, so the order here matters.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { builtScriptHashes, scriptSources, PERMISSIONS_POLICY } from './csp.js';

// Per-limiter request buckets. Each limiter gets its OWN Map so limits on,
// say, /api/inquiry never consume the budget for /api/admin/login (they used
// to share one Map and entangle counters).
export function makeRateLimiter(maxPerMinute, label) {
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

export function registerWebGuards(app, { distPath, connectSource }) {
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

  // One address for the whole site: https://oliraagroindustry.com. "www." and plain
  // http answer with a permanent redirect, so search engines index one copy and a
  // visitor's enquiry is never sent unencrypted. Only in production, only for page
  // reads, and only when the proxy says the request arrived over http (with no
  // such header nothing is redirected, so this can never loop).
  const CANONICAL_HOST = (process.env.CANONICAL_HOST || 'oliraagroindustry.com').toLowerCase();
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'production' || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const wrongHost = host === `www.${CANONICAL_HOST}`;
    const insecure = proto === 'http' && (host === CANONICAL_HOST || wrongHost);
    if (wrongHost || insecure) return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
    next();
  });

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

  // Enhanced security headers with Helmet. Scripts: the site's own files, its built
  // inline scripts by hash (lib/csp.js, read again whenever a build replaces the
  // pages), and googletagmanager.com for the optional Analytics/Ads tag set in the
  // admin panel. No 'unsafe-inline', no 'unsafe-eval'.
  const scriptSrc = scriptSources(builtScriptHashes(distPath));

  // The staff screens (/admin, /team) load nothing from other sites and carry no Google tag, so
  // their policy is narrower: if a script were ever injected there, it could not send a staff
  // token anywhere or run a tag container (white-hat, 23 Nov 2026). Public pages are unchanged.
  const staffPage = (req) => /^\/(admin|team)(\/|$)/.test(req.path);
  const publicOnly = (src) => (req) => (staffPage(req) ? "'self'" : src);
  const scriptSrcFor = scriptSrc.map((s) => (s === 'https://www.googletagmanager.com' ? publicOnly(s) : s));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: scriptSrcFor,
        styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", publicOnly('https:'), "blob:"],
        fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
        connectSrc: ["'self'", publicOnly('https:'), (req) => connectSource(req) || "'self'"],
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

  // camera, microphone, location and the rest: never used by the site, switched off
  app.use((req, res, next) => { res.setHeader('Permissions-Policy', PERMISSIONS_POLICY); next(); });

  // Disable X-Powered-By header (security best practice)
  app.disable('x-powered-by');

  app.use(cors(corsOptions));
  // 1 MB is far above any form or staff save here (the facts import is about 300 KB); 10 MB
  // let anyone make the server read and parse large bodies on every path (white-hat, 23 Nov 2026)
  app.use(express.json({ limit: '1mb' }));
  // answers for signed-in people (enquiries, staff lists, the company's phone numbers) are never
  // kept by a browser or a cache in between; a public answer may still set its own caching
  app.use('/api', (req, res, next) => {
    if (req.headers.authorization || req.path.startsWith('/team') || req.path.startsWith('/admin')) res.set('Cache-Control', 'no-store');
    next();
  });

  return { rateLimit, makeRateLimiter };
}
