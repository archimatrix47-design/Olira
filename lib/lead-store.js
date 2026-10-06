// Where the enquiries live. server.js and lib/workspace.js read and write them
// only through this, so the two stores below are interchangeable:
//
//   all()        every enquiry, newest first
//   get(id)      one enquiry, or null
//   add(rec)     a new enquiry from the website form
//   put(rec)     save a changed enquiry; false when it no longer exists
//   remove(id)   delete one; false when it was not there
//   health()     true while the store answers (for /api/health, kept current)
//   status()     for the admin's site health: { store, ok, count, pending, error }
//
// file      DATA_DIR/inquiries.json as before: the newest 1,000 are kept.
// mariadb   the olira_enquiries table, used when DB_NAME, DB_USER and DB_PASSWORD are set
//           (cPanel > MySQL Databases; the password in DB_PASSWORD). No cap.
//           One row per enquiry: the whole record as JSON in `doc`, and the
//           fields worth sorting and filtering in phpMyAdmin as columns.
//           On its first start an existing inquiries.json is copied in once and
//           renamed inquiries.imported-<date>.json. If the database cannot be
//           reached, a new enquiry from the website waits in
//           DATA_DIR/inquiries-pending.json and moves in when the database is
//           back, so a buyer's request is never lost; the staff screens say the
//           list is unavailable meanwhile, and /api/health reports it (the
//           uptime check mails about it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class StoreUnavailable extends Error {
  constructor(cause) {
    super('The enquiry store cannot be reached.');
    this.code = 'store_unavailable';
    this.cause = cause;
  }
}

/* ---------------- the JSON file ---------------- */
export function fileLeadStore({ file, readJsonFile, writeJsonFile, max = 1000, onDrop = () => {} }) {
  const read = () => {
    const list = readJsonFile(file, []);
    if (!Array.isArray(list)) throw new StoreUnavailable(new Error(`${path.basename(file)} is not a list`));
    return list;
  };
  const write = (list) => { if (!writeJsonFile(file, list)) throw new StoreUnavailable(new Error(`${path.basename(file)} could not be written`)); };
  let ok = true;
  const watch = async (fn) => { try { const v = await fn(); ok = true; return v; } catch (e) { ok = false; throw e; } };
  return {
    kind: 'file',
    all: () => watch(() => read()),
    get: (id) => watch(() => read().find((i) => i.id === id) || null),
    add: (rec) => watch(() => {
      const list = read();
      list.unshift(rec);
      if (list.length > max) { for (const old of list.slice(max)) onDrop(old); list.length = max; }
      write(list);
      return rec;
    }),
    put: (rec) => watch(() => {
      const list = read();
      const at = list.findIndex((i) => i.id === rec.id);
      if (at < 0) return false;
      list[at] = rec;
      write(list);
      return true;
    }),
    remove: (id) => watch(() => {
      const list = read();
      const next = list.filter((i) => i.id !== id);
      if (next.length === list.length) return false;
      write(next);
      return true;
    }),
    health: () => ok,
    status: async () => { try { return { store: 'file', ok: true, count: read().length, cap: max }; } catch (e) { return { store: 'file', ok: false, error: e.message }; } },
    close: async () => {},
  };
}

/* ---------------- MariaDB ---------------- */
export const TABLE = 'olira_enquiries';
const schema = (TABLE) => `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  line VARCHAR(8) NULL,
  status VARCHAR(16) NULL,
  name VARCHAR(100) NULL,
  email VARCHAR(200) NULL,
  company VARCHAR(100) NULL,
  product VARCHAR(200) NULL,
  assignee VARCHAR(100) NULL,
  doc LONGTEXT NOT NULL CHECK (JSON_VALID(doc)),
  PRIMARY KEY (id),
  KEY by_created (created_at),
  KEY by_line_status (line, status),
  KEY by_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const cut = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const when = (iso) => { const t = Date.parse(iso); return new Date(Number.isFinite(t) ? t : Date.now()); };
/** The row's columns, in the order of COLS. */
const COLS = 'id, created_at, updated_at, line, status, name, email, company, product, assignee, doc';
const row = (rec) => [cut(rec.id, 64), when(rec.createdAt), new Date(), cut(rec.line, 8), cut(rec.status, 16), cut(rec.name, 100), cut(rec.email, 200), cut(rec.company, 100), cut(rec.product, 200), cut(rec.assignee?.name, 100), JSON.stringify(rec)];
const insertSql = (TABLE) => `INSERT IGNORE INTO ${TABLE} (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const parse = (doc) => (typeof doc === 'string' ? JSON.parse(doc) : doc);

/**
 * opts: { config: { host, port, user, password, database }, dataDir, readJsonFile,
 *         writeJsonFile, logError, table (scripts/db-check.mjs uses a scratch one),
 *         createPool (for tests), pingMs }
 */
export function mariaLeadStore({ config, dataDir, readJsonFile, writeJsonFile, logError = () => {}, table = TABLE, createPool, pingMs = 60000 }) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error('bad table name');
  const TABLE = table, SCHEMA = schema(table), INSERT = insertSql(table);
  const jsonFile = path.join(dataDir, 'inquiries.json');
  const pendingFile = path.join(dataDir, 'inquiries-pending.json');
  // healthy until a call says otherwise (the first one goes out at once), so a
  // restart is not reported as an outage
  let pool = null, ready = null, ok = true, lastError = null;

  async function makePool() {
    if (pool) return pool;
    const make = createPool || (await import('mysql2/promise')).createPool;
    pool = make({
      host: config.host || 'localhost', port: Number(config.port) || 3306,
      user: config.user, password: config.password, database: config.database,
      connectionLimit: 3, connectTimeout: 5000, timezone: 'Z', charset: 'utf8mb4_unicode_ci',
      enableKeepAlive: true,
    });
    return pool;
  }

  // the first time the table is empty and inquiries.json has enquiries, copy
  // them in (one process does it: GET_LOCK), then rename the file
  async function importOnce(p) {
    if (!fs.existsSync(jsonFile)) return;
    const conn = await p.getConnection();
    try {
      const [[lock]] = await conn.query(`SELECT GET_LOCK('${TABLE}_import', 20) AS got`);
      if (!lock.got) return;
      try {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${TABLE}`);
        if (Number(n) === 0 && fs.existsSync(jsonFile)) {
          const list = readJsonFile(jsonFile, []);
          if (Array.isArray(list) && list.length) {
            await conn.beginTransaction();
            try {
              for (const rec of list) if (rec && rec.id) await conn.query(INSERT, row(rec));
              await conn.commit();
            } catch (e) { await conn.rollback(); throw e; }
          }
          const stamp = new Date().toISOString().slice(0, 10);
          fs.renameSync(jsonFile, path.join(dataDir, `inquiries.imported-${stamp}.json`));
          console.log(`[enquiries] ${Array.isArray(list) ? list.length : 0} enquiries copied from inquiries.json into ${TABLE}`);
        }
      } finally { await conn.query(`SELECT RELEASE_LOCK('${TABLE}_import')`); }
    } finally { conn.release(); }
  }

  const readPending = () => { const l = readJsonFile(pendingFile, []); return Array.isArray(l) ? l : []; };
  async function flushPending(p) {
    const waiting = readPending();
    if (!waiting.length) return 0;
    for (const rec of waiting) await p.query(INSERT, row(rec));
    // only what was moved is taken off: one may have been added meanwhile
    const left = readPending().filter((r) => !waiting.some((w) => w.id === r.id));
    if (left.length) writeJsonFile(pendingFile, left); else fs.rmSync(pendingFile, { force: true });
    console.log(`[enquiries] ${waiting.length} waiting enquiries moved into ${TABLE}`);
    return waiting.length;
  }

  function ensure() {
    if (!ready) {
      ready = (async () => {
        const p = await makePool();
        await p.query(SCHEMA);
        await importOnce(p);
        await flushPending(p);
        return p;
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  }

  // every call goes through here: a failure marks the store down and is logged
  async function run(fn) {
    try {
      const p = await ensure();
      // anything that waited out an outage goes in before anything else is read
      if (fs.existsSync(pendingFile)) await flushPending(p);
      const v = await fn(p);
      ok = true; lastError = null;
      return v;
    } catch (e) {
      ok = false; lastError = e.code || e.message;
      logError('enquiry_store_failed', e);
      throw e instanceof StoreUnavailable ? e : new StoreUnavailable(e);
    }
  }

  // keep health() current, and move waiting enquiries in once the database is back
  const timer = setInterval(() => { run((p) => p.query('SELECT 1')).catch(() => {}); }, pingMs);
  timer.unref?.();
  run((p) => p.query('SELECT 1')).catch(() => {}); // connect now, not on the first visitor

  return {
    kind: 'mariadb',
    all: () => run(async (p) => {
      const [rows] = await p.query(`SELECT doc FROM ${TABLE} ORDER BY created_at DESC, id DESC`);
      return rows.map((r) => parse(r.doc));
    }),
    get: (id) => run(async (p) => {
      const [rows] = await p.query(`SELECT doc FROM ${TABLE} WHERE id = ?`, [String(id)]);
      return rows.length ? parse(rows[0].doc) : null;
    }),
    // a buyer's request is never lost: when the database is down it waits in a file
    add: async (rec) => {
      try {
        await run((p) => p.query(INSERT, row(rec)));
      } catch (e) {
        if (!writeJsonFile(pendingFile, [...readPending(), rec])) throw e;
      }
      return rec;
    },
    put: async (rec) => {
      try {
        return await run(async (p) => {
          const r = row(rec);
          const [res] = await p.query(
            `UPDATE ${TABLE} SET updated_at = ?, version = version + 1, line = ?, status = ?, name = ?, email = ?, company = ?, product = ?, assignee = ?, doc = ? WHERE id = ?`,
            [r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[0]],
          );
          return res.affectedRows > 0;
        });
      } catch (e) {
        // the website form's own follow-up (files, "emailed") on a waiting enquiry
        const waiting = readPending();
        const at = waiting.findIndex((w) => w.id === rec.id);
        if (at < 0) throw e;
        waiting[at] = rec;
        if (!writeJsonFile(pendingFile, waiting)) throw e;
        return true;
      }
    },
    remove: (id) => run(async (p) => {
      const [res] = await p.query(`DELETE FROM ${TABLE} WHERE id = ?`, [String(id)]);
      return res.affectedRows > 0;
    }),
    health: () => ok,
    status: async () => {
      const pending = readPending().length;
      try {
        const n = await run(async (p) => { const [[r]] = await p.query(`SELECT COUNT(*) AS n FROM ${TABLE}`); return Number(r.n); });
        return { store: 'mariadb', ok: true, database: config.database, count: n, pending };
      } catch (e) {
        return { store: 'mariadb', ok: false, database: config.database, pending, error: lastError };
      }
    },
    close: async () => { clearInterval(timer); if (pool) await pool.end().catch(() => {}); },
  };
}

/**
 * The database settings, from DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
 * null until name, user and password are all set: a half-filled form in cPanel
 * keeps the site on the file instead of taking the enquiry list offline.
 */
export const dbConfigFrom = (env = process.env) => (env.DB_NAME && env.DB_USER && env.DB_PASSWORD
  ? { host: env.DB_HOST || 'localhost', port: env.DB_PORT || 3306, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME }
  : null);

/* ---------------- the database settings the admin saves ---------------- */
// On this host a changed environment variable can take effect only when the
// hosting company restarts the web server (see "Restart-free admin
// credentials" in server.js). So the admin saves the database settings from the
// panel into DATA_DIR/database.json (readable by this account only), and the
// store reads that file again whenever it changes: no restart. The file wins
// over DB_* environment variables.
const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;

/** database.json as a config, or null when it is missing or incomplete. */
export function readDbFile(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return c && NAME_RE.test(c.database || '') && NAME_RE.test(c.user || '') && typeof c.password === 'string' && c.password
      ? { host: HOST_RE.test(c.host || '') ? c.host : 'localhost', port: Number(c.port) || 3306, database: c.database, user: c.user, password: c.password }
      : null;
  } catch { return null; }
}

/** Checks what the admin typed. Returns { config } or { error }. A blank password keeps the saved one for the same user. */
export function cleanDbSettings(input, saved) {
  const host = String(input?.host || 'localhost').trim(), database = String(input?.database || '').trim(), user = String(input?.user || '').trim();
  const port = input?.port == null || input.port === '' ? 3306 : Number(input.port);
  if (!HOST_RE.test(host)) return { error: 'The host is a server name such as localhost.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'The port is a number, usually 3306.' };
  if (!NAME_RE.test(database)) return { error: 'Type the database name as cPanel shows it, for example oliraagr_site.' };
  if (!NAME_RE.test(user)) return { error: 'Type the database user as cPanel shows it, for example oliraagr_site.' };
  let password = typeof input?.password === 'string' ? input.password : '';
  if (!password && saved && saved.user === user) password = saved.password;
  if (!password) return { error: 'Type the database user’s password.' };
  if (password.length > 200) return { error: 'That password is too long.' };
  return { config: { host, port, database, user, password } };
}

/** Writes database.json for this account only (0600), atomically. */
export function saveDbFile(file, config) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...config, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* not on this platform */ }
}

/**
 * The store this server uses, chosen again whenever the settings change:
 * MariaDB when DATA_DIR/database.json (or DB_NAME, DB_USER and DB_PASSWORD)
 * holds complete settings, the JSON file otherwise.
 */
export function createLeadStore({ env = process.env, dataDir, readJsonFile, writeJsonFile, logError, onDrop, max, createPool, configFile = path.join(dataDir, 'database.json') }) {
  let current = null, key = null, source = 'none', seen = null, fromFile = null;
  const settings = () => {
    let stamp = null;
    try { const s = fs.statSync(configFile); stamp = `${s.mtimeMs}:${s.size}`; } catch { /* no file */ }
    if (stamp !== seen) { seen = stamp; fromFile = stamp ? readDbFile(configFile) : null; }
    if (fromFile) return { config: fromFile, source: 'admin' };
    const fromEnv = dbConfigFrom(env);
    return fromEnv ? { config: fromEnv, source: 'environment' } : { config: null, source: 'none' };
  };
  const pick = () => {
    const s = settings();
    const c = s.config;
    const k = c ? `${c.host}|${c.port}|${c.database}|${c.user}|${crypto.createHash('sha256').update(c.password).digest('hex')}` : 'file';
    if (k !== key) {
      const old = current;
      current = c
        ? mariaLeadStore({ config: c, dataDir, readJsonFile, writeJsonFile, logError, createPool })
        : fileLeadStore({ file: path.join(dataDir, 'inquiries.json'), readJsonFile, writeJsonFile, onDrop, max });
      key = k;
      if (old) old.close().catch(() => {});
    }
    source = s.source;
    return current;
  };
  return {
    get kind() { return pick().kind; },
    all: () => pick().all(),
    get: (id) => pick().get(id),
    add: (rec) => pick().add(rec),
    put: (rec) => pick().put(rec),
    remove: (id) => pick().remove(id),
    health: () => pick().health(),
    status: async () => ({ ...(await pick().status()), source }),
    /** the settings in use (with the password: for the server only, never sent out) */
    settings: () => settings().config,
    configFile,
    close: async () => { if (current) await current.close(); },
  };
}

/**
 * The admin's "Check the database": the store's own code against the real
 * server, in a scratch table that is dropped afterwards, so the enquiries are
 * never touched. Each step says what it proved.
 */
export async function checkMaria({ config, createPool, readJsonFile, writeJsonFile }) {
  const os = await import('node:os');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-dbcheck-'));
  const table = `olira_enquiries_check_${process.pid}`;
  const steps = [];
  const step = async (name, fn) => {
    try { const detail = await fn(); steps.push({ step: name, ok: true, detail: detail || '' }); return true; }
    catch (e) { steps.push({ step: name, ok: false, detail: String(e.cause?.code || e.cause?.message || e.code || e.message).slice(0, 200) }); return false; }
  };
  const store = mariaLeadStore({ config, dataDir: scratch, readJsonFile, writeJsonFile, table, createPool, pingMs: 3600000 });
  const at = new Date().toISOString();
  const rec = { id: `inq_check_${Date.now()}`, createdAt: at, name: 'Database check', email: 'check@example.com', product: 'Check', line: 'agri', status: 'new', message: 'Ünïcödé and emoji ✓ survive the round trip.' };
  try {
    if (await step('Signs in and makes a scratch table', async () => { await store.status().then((s) => { if (!s.ok) throw new Error(s.error || 'no answer'); }); return `${config.database} on ${config.host}`; })) {
      await step('Saves an enquiry and reads it back whole', async () => {
        await store.add(rec);
        const back = await store.get(rec.id);
        if (!back || back.message !== rec.message) throw new Error('what came back is not what went in');
        return 'text with accents and symbols intact';
      });
      await step('Changes it', async () => {
        rec.status = 'quoted'; rec.activity = [{ type: 'note', text: 'checked' }];
        if (!(await store.put(rec))) throw new Error('the change found no row');
        if ((await store.get(rec.id)).status !== 'quoted') throw new Error('the change did not stick');
      });
      await step('Lists and deletes it', async () => {
        if (!(await store.all()).some((r) => r.id === rec.id)) throw new Error('not in the list');
        if (!(await store.remove(rec.id))) throw new Error('nothing was deleted');
      });
    }
  } finally {
    const pool = createPool ? createPool() : null;
    await step('Removes the scratch table', async () => {
      const p = pool || (await import('mysql2/promise')).createPool({ ...config, port: Number(config.port) || 3306, connectionLimit: 1, connectTimeout: 5000 });
      try { await p.query(`DROP TABLE IF EXISTS ${table}`); } finally { if (!pool) await p.end().catch(() => {}); }
    });
    await store.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return { ok: steps.every((s) => s.ok), steps };
}
