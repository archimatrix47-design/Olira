// BOX storage: where everything is kept. The data and upload folders (outside the
// deployed code on the host), seeding a new data folder, safe atomic JSON writes,
// the admin audit log and the error log. Every other box gets its files through this.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clientIp } from './site-basics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What a running site writes about itself: visits, enquiries, accounts, switches, settings.
 * Never a default. A copy left in the repo's data folder (by a server once run without
 * DATA_DIR) must not be handed to a new data folder as if it were one: it gave new folders
 * someone else's visit counts.
 */
export const NEVER_SEEDED = new Set(['analytics.json', 'inquiries.json', 'inquiries-pending.json', 'database.json', 'auth.json', 'team.json', 'targets.json', 'ai-access.json', 'email-status.json', 'packaging-3d.json']);
/** Whether a file in the repo's data folder is a default a new data folder starts from. */
export const isDefault = (file) => file.endsWith('.json') && !NEVER_SEEDED.has(file);

export function registerStorage(app, _wires) {
  // ------------------------------------------------------------------
  // Persistent storage locations (cPanel / container friendly).
  // On many hosts the app directory is overwritten on every deploy (and can be
  // read-only), which would wipe admin-managed content (products, certs,
  // contacts, branding, social) and uploaded images. Point DATA_DIR and
  // UPLOADS_DIR at a path OUTSIDE the deploy sync to make that content survive.
  // Defaults keep the in-repo paths so local dev is unchanged.
  // ------------------------------------------------------------------
  const REPO_DATA_DIR = path.join(ROOT, 'data');
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : REPO_DATA_DIR;
  const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(ROOT, 'public', 'uploads');
  // the built site; DIST_DIR lets the data pipeline test serve a throwaway build
  const distPath = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
  const productImagesDir = path.join(uploadsDir, 'products');

  [dataDir, uploadsDir, productImagesDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // First boot on a fresh persistent DATA_DIR: seed it from the repo defaults so
  // products/certs/etc. aren't empty. Never overwrites existing files.
  if (dataDir !== REPO_DATA_DIR && fs.existsSync(REPO_DATA_DIR)) {
    for (const f of fs.readdirSync(REPO_DATA_DIR)) {
      if (!isDefault(f)) continue;
      const dest = path.join(dataDir, f);
      if (!fs.existsSync(dest)) {
        try { fs.copyFileSync(path.join(REPO_DATA_DIR, f), dest); } catch {}
      }
    }
  }

  // the folders pages and images are served from (build output first)
  const publicDirs = [distPath, path.join(ROOT, 'public')];

  // Settings saved from the admin panel (email delivery, marketing tags) live with
  // the rest of the live data in DATA_DIR. On cPanel a deploy mirrors the repo into
  // the app folder and deletes what the repo does not have, so a settings file
  // beside server.js was lost (or reset to the repo's copy) on every deploy. A file
  // left there by an older version is copied across once. Overridable so the test
  // suite never writes the real config.
  function settingsPath(envName, file) {
    if (process.env[envName]) return process.env[envName];
    const beside = path.join(ROOT, file);
    if (dataDir === REPO_DATA_DIR) return beside;
    const kept = path.join(dataDir, file);
    if (!fs.existsSync(kept) && fs.existsSync(beside)) {
      try { fs.copyFileSync(beside, kept); } catch (e) { console.error(`Could not move ${file} into DATA_DIR:`, e.message); }
    }
    return kept;
  }

  // Append a single line to data/admin-audit.log. Best-effort, errors swallowed
  // so a failed log write never blocks a request.
  const auditLogPath = path.join(dataDir, 'admin-audit.log');
  // Anyone can send refused requests, so they are logged at most once a minute per address and
  // kind, and the log moves to admin-audit.log.1 past 5 MB: a flood can neither bury the real
  // entries in the admin's Activity nor fill the host's disk (white-hat, 23 Nov 2026).
  const LOG_MAX = 5 * 1024 * 1024;
  const NOISY = /_(auth|origin)_rejected$/;
  const quiet = new Map();
  let sizeCheckedAt = 0;
  const rotateIfBig = (p) => { try { if (fs.statSync(p).size > LOG_MAX) fs.renameSync(p, `${p}.1`); } catch { /* missing: nothing to rotate */ } };
  function audit(event, req, extra = {}) {
    try {
      const now = Date.now();
      if (NOISY.test(event)) {
        const key = `${clientIp(req)}|${event}`;
        if ((quiet.get(key) || 0) > now) return;
        if (quiet.size > 5000) quiet.clear();
        quiet.set(key, now + 60_000);
      }
      if (now - sizeCheckedAt > 60_000) { sizeCheckedAt = now; rotateIfBig(auditLogPath); }
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
  let errorSizeCheckedAt = 0;
  function logError(context, err, extra = {}) {
    const entry = {
      t: new Date().toISOString(),
      context,
      message: (err && err.message) ? err.message : String(err),
      stack: (err && err.stack) ? String(err.stack).split('\n').slice(0, 6).join(' | ') : undefined,
      ...extra
    };
    if (Date.now() - errorSizeCheckedAt > 60_000) { errorSizeCheckedAt = Date.now(); rotateIfBig(errorLogPath); } // capped like the audit log
    try { fs.appendFile(errorLogPath, JSON.stringify(entry) + '\n', () => {}); } catch {}
    console.error(`[${entry.t}] ${context}: ${entry.message}`);
  }

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

  return { repoDataDir: REPO_DATA_DIR, dataDir, uploadsDir, distPath, publicDirs, productImagesDir, auditLogPath, settingsPath, audit, logError, readJsonFile, writeJsonFile };
}
