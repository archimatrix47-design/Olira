// lib/lead-store.js: the JSON file and MariaDB stores behave the same, the first
// MariaDB start copies inquiries.json in once, and a buyer's request is never
// lost while the database is down. MariaDB is played by a small stand-in that
// understands exactly the statements the store sends; scripts/db-check.mjs runs
// the same steps against the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileLeadStore, mariaLeadStore, createLeadStore, checkMaria, dbConfigFrom, cleanDbSettings, saveDbFile, readDbFile, StoreUnavailable } from '../lib/lead-store.js';

const readJsonFile = (f, d) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const writeJsonFile = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); return true; } catch { return false; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olira-leads-'));
const lead = (id, at, extra = {}) => ({ id, createdAt: at, name: `Buyer ${id}`, email: `${id}@example.com`, company: 'Co', product: 'Humera Sesame Seeds', line: 'agri', status: 'new', ...extra });

/** A stand-in MariaDB: rows in a Map, the store's statements only. */
function fakeMaria() {
  const rows = new Map();
  const db = { rows, down: false, tables: new Set(), dropped: [], queries: [], locks: 0 };
  const fail = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' });
  async function query(sql, params = []) {
    if (db.down) throw fail();
    db.queries.push(sql);
    const s = sql.replace(/\s+/g, ' ').trim();
    let m;
    if (/^CREATE TABLE IF NOT EXISTS (\w+)/.test(s)) { db.tables.add(RegExp.$1); return [{}]; }
    if (s === 'SELECT 1') return [[{ 1: 1 }]];
    if (/^DROP TABLE IF EXISTS (\w+)$/.test(s)) { db.dropped.push(RegExp.$1); db.tables.delete(RegExp.$1); return [{}]; }
    if (/^SELECT GET_LOCK/.test(s)) { db.locks++; return [[{ got: 1 }]]; }
    if (/^SELECT RELEASE_LOCK/.test(s)) return [[{ released: 1 }]];
    if (/^SELECT COUNT\(\*\) AS n FROM \w+$/.test(s)) return [[{ n: rows.size }]];
    if (/^INSERT IGNORE INTO \w+ \(id, created_at, updated_at, line, status, name, email, company, product, assignee, doc\) VALUES/.test(s)) {
      const [id, created, updated, line, status, name, email, company, product, assignee, doc] = params;
      assert.ok(created instanceof Date && updated instanceof Date, 'times go in as dates');
      if (!rows.has(id)) rows.set(id, { id, created, version: 1, line, status, name, email, company, product, assignee, doc });
      return [{ affectedRows: rows.has(id) ? 1 : 0 }];
    }
    if (/^SELECT doc FROM \w+ ORDER BY created_at DESC, id DESC$/.test(s)) {
      return [[...rows.values()].sort((a, b) => b.created - a.created || (b.id > a.id ? 1 : -1)).map((r) => ({ doc: r.doc }))];
    }
    if (/^SELECT doc FROM \w+ WHERE id = \?$/.test(s)) return [rows.has(params[0]) ? [{ doc: rows.get(params[0]).doc }] : []];
    if ((m = s.match(/^UPDATE \w+ SET updated_at = \?, version = version \+ 1, line = \?, status = \?, name = \?, email = \?, company = \?, product = \?, assignee = \?, doc = \? WHERE id = \?$/))) {
      const [, line, status, name, email, company, product, assignee, doc, id] = params;
      const r = rows.get(id);
      if (!r) return [{ affectedRows: 0 }];
      Object.assign(r, { line, status, name, email, company, product, assignee, doc, version: r.version + 1 });
      return [{ affectedRows: 1 }];
    }
    if (/^DELETE FROM \w+ WHERE id = \?$/.test(s)) { const had = rows.delete(params[0]); return [{ affectedRows: had ? 1 : 0 }]; }
    throw new Error(`the stand-in does not know: ${s}`);
  }
  const conn = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  db.pool = { query, getConnection: async () => { if (db.down) throw fail(); return conn; }, end: async () => {} };
  return db;
}
const maria = (dir, db, extra = {}) => mariaLeadStore({ config: { database: 'oliraagr_site', user: 'u' }, dataDir: dir, readJsonFile, writeJsonFile, createPool: () => db.pool, pingMs: 3600000, logError: () => {}, ...extra });

/* ---------- the same behaviour from both stores ---------- */
for (const kind of ['file', 'mariadb']) {
  test(`${kind}: add, get, change, list newest first, remove`, async () => {
    const dir = tmp();
    const db = fakeMaria();
    const store = kind === 'file' ? fileLeadStore({ file: path.join(dir, 'inquiries.json'), readJsonFile, writeJsonFile }) : maria(dir, db);
    try {
      await store.add(lead('inq_a', '2026-10-01T08:00:00.000Z'));
      await store.add(lead('inq_b', '2026-10-03T08:00:00.000Z'));
      await store.add(lead('inq_c', '2026-10-02T08:00:00.000Z'));
      assert.deepEqual((await store.all()).map((l) => l.id).sort(), ['inq_a', 'inq_b', 'inq_c']);
      if (kind === 'mariadb') assert.deepEqual((await store.all()).map((l) => l.id), ['inq_b', 'inq_c', 'inq_a'], 'newest first by when it was made');
      const b = await store.get('inq_b');
      assert.equal(b.name, 'Buyer inq_b');
      b.status = 'quoted'; b.assignee = { id: 'm1', name: 'Hana' }; b.activity = [{ type: 'note', text: 'Called. Wants 50 MT, CIF Jebel Ali.' }];
      assert.equal(await store.put(b), true);
      const again = await store.get('inq_b');
      assert.equal(again.status, 'quoted');
      assert.equal(again.activity[0].text, 'Called. Wants 50 MT, CIF Jebel Ali.', 'the whole record round-trips');
      if (kind === 'mariadb') {
        const r = db.rows.get('inq_b');
        assert.deepEqual([r.status, r.assignee, r.email, r.version], ['quoted', 'Hana', 'inq_b@example.com', 2], 'the columns follow the record');
      }
      assert.equal(await store.put(lead('inq_missing', '2026-10-01T00:00:00Z')), false, 'changing one that is gone says so');
      assert.equal(await store.get('inq_missing'), null);
      assert.equal(await store.remove('inq_a'), true);
      assert.equal(await store.remove('inq_a'), false);
      assert.deepEqual((await store.all()).map((l) => l.id).sort(), ['inq_b', 'inq_c']);
      assert.equal(store.health(), true);
      const st = await store.status();
      assert.equal(st.ok, true);
      assert.equal(st.count, 2);
    } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('file: keeps the newest 1,000 and lets go of the files of the ones dropped', async () => {
  const dir = tmp();
  const dropped = [];
  const store = fileLeadStore({ file: path.join(dir, 'inquiries.json'), readJsonFile, writeJsonFile, max: 3, onDrop: (old) => dropped.push(old.id) });
  for (const id of ['a', 'b', 'c', 'd']) await store.add(lead(id, '2026-10-01T00:00:00Z'));
  assert.deepEqual((await store.all()).map((l) => l.id), ['d', 'c', 'b']);
  assert.deepEqual(dropped, ['a']);
});

test('file: a damaged file is reported, never read as an empty list', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'inquiries.json'), JSON.stringify({ not: 'a list' }));
  const store = fileLeadStore({ file: path.join(dir, 'inquiries.json'), readJsonFile, writeJsonFile });
  await assert.rejects(store.all(), StoreUnavailable);
  assert.equal(store.health(), false);
});

/* ---------- MariaDB: the first start ---------- */
test('mariadb: makes its table and copies inquiries.json in once, then renames the file', async () => {
  const dir = tmp();
  const old = [lead('inq_1', '2026-09-01T00:00:00Z', { status: 'won', quote: { total: 92500 } }), lead('inq_2', '2026-09-02T00:00:00Z')];
  fs.writeFileSync(path.join(dir, 'inquiries.json'), JSON.stringify(old));
  const db = fakeMaria();
  const store = maria(dir, db);
  try {
    assert.equal((await store.all()).length, 2);
    assert.ok(db.tables.has('olira_enquiries'));
    assert.equal((await store.get('inq_1')).quote.total, 92500);
    assert.ok(!fs.existsSync(path.join(dir, 'inquiries.json')), 'the file is not left to look current');
    const renamed = fs.readdirSync(dir).filter((f) => /^inquiries\.imported-\d{4}-\d\d-\d\d\.json$/.test(f));
    assert.equal(renamed.length, 1, 'kept under a dated name');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, renamed[0]), 'utf8')).length, 2);
    // a second process (or a restart) does not copy anything again
    fs.writeFileSync(path.join(dir, 'inquiries.json'), JSON.stringify([lead('inq_3', '2026-09-03T00:00:00Z')]));
    const second = maria(dir, db);
    assert.equal((await second.all()).length, 2, 'a table that already has enquiries is never filled from a file');
    await second.close();
  } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- MariaDB: down and back ---------- */
test('mariadb: while the database is down a request from the website waits in a file, and moves in when it is back', async () => {
  const dir = tmp();
  const db = fakeMaria();
  const store = maria(dir, db);
  const pending = path.join(dir, 'inquiries-pending.json');
  try {
    await store.add(lead('inq_before', '2026-10-01T00:00:00Z'));
    db.down = true;
    const rec = await store.add(lead('inq_during', '2026-10-02T00:00:00Z'));
    assert.equal(rec.id, 'inq_during', 'the form still gets its record back');
    assert.deepEqual(readJsonFile(pending, []).map((r) => r.id), ['inq_during']);
    // the form's own follow-up (files, emailed) reaches the waiting copy
    rec.emailed = true;
    assert.equal(await store.put(rec), true);
    assert.equal(readJsonFile(pending, [])[0].emailed, true);
    // the staff screens are told, not shown an empty list
    await assert.rejects(store.all(), StoreUnavailable);
    await assert.rejects(store.put(lead('inq_before', '2026-10-01T00:00:00Z')), StoreUnavailable);
    assert.equal(store.health(), false);
    const st = await store.status();
    assert.deepEqual([st.ok, st.pending], [false, 1]);
    db.down = false;
    // the first call that reaches the database again moves it in, before it reads
    assert.deepEqual((await store.all()).map((l) => l.id).sort(), ['inq_before', 'inq_during']);
    assert.equal((await store.get('inq_during')).emailed, true);
    assert.ok(!fs.existsSync(pending), 'nothing is left waiting');
    assert.equal(store.health(), true);
    // and a server that starts while some are waiting moves them in too
    db.down = true; await store.add(lead('inq_restart', '2026-10-03T00:00:00Z')); db.down = false;
    const second = maria(dir, db);
    assert.ok((await second.all()).some((l) => l.id === 'inq_restart'));
    await second.close();
  } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mariadb: a request that cannot be stored anywhere is reported, not dropped silently', async () => {
  const dir = tmp();
  const db = fakeMaria();
  db.down = true;
  const store = maria(dir, db, { writeJsonFile: () => false });
  try { await assert.rejects(store.add(lead('inq_x', '2026-10-02T00:00:00Z')), StoreUnavailable); } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the database is used only when DB_NAME, DB_USER and DB_PASSWORD are all set', async () => {
  const dir = tmp();
  const a = createLeadStore({ env: {}, dataDir: dir, readJsonFile, writeJsonFile });
  const b = createLeadStore({ env: { DB_NAME: 'oliraagr_site' }, dataDir: dir, readJsonFile, writeJsonFile });
  const c = createLeadStore({ env: { DB_NAME: 'oliraagr_site', DB_USER: 'oliraagr_site' }, dataDir: dir, readJsonFile, writeJsonFile });
  assert.equal(a.kind, 'file');
  assert.equal(b.kind, 'file', 'a name without a user is not enough');
  assert.equal(c.kind, 'file', 'without the password (saved half-way in cPanel) the site stays on the file');
  await a.close(); await b.close(); await c.close();
  assert.equal(dbConfigFrom({ DB_NAME: 'n', DB_USER: 'u' }), null);
  assert.throws(() => mariaLeadStore({ config: {}, dataDir: dir, readJsonFile, writeJsonFile, table: 'x; DROP TABLE y', createPool: () => fakeMaria().pool }), /bad table name/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- the admin's "Check the database" ---------- */
test('the database check runs the store in a scratch table and removes it, leaving the enquiries alone', async () => {
  const db = fakeMaria();
  const r = await checkMaria({ config: { database: 'oliraagr_site', host: 'localhost', user: 'u' }, createPool: () => db.pool, readJsonFile, writeJsonFile });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.deepEqual(r.steps.map((s) => s.step), ['Signs in and makes a scratch table', 'Saves an enquiry and reads it back whole', 'Changes it', 'Lists and deletes it', 'Removes the scratch table']);
  const scratch = [...db.queries].find((q) => /CREATE TABLE IF NOT EXISTS olira_enquiries_check_\d+/.test(q));
  assert.ok(scratch, 'a scratch table, not the enquiries table');
  assert.ok(!db.queries.some((q) => /CREATE TABLE IF NOT EXISTS olira_enquiries \(/.test(q)), 'the real table is never created or touched');
  assert.equal(db.dropped.length, 1);
  assert.match(db.dropped[0], /^olira_enquiries_check_\d+$/);
  assert.equal(db.rows.size, 0, 'nothing left behind');
});

test('the database check says which step failed, and still tries to clean up', async () => {
  const db = fakeMaria();
  db.down = true;
  const r = await checkMaria({ config: { database: 'oliraagr_site', host: 'localhost', user: 'u' }, createPool: () => db.pool, readJsonFile, writeJsonFile });
  assert.equal(r.ok, false);
  assert.equal(r.steps[0].ok, false);
  assert.match(r.steps[0].detail, /ECONNREFUSED/);
  assert.equal(r.steps.at(-1).step, 'Removes the scratch table');
  assert.equal(dbConfigFrom({ DB_NAME: 'oliraagr_site', DB_USER: 'oliraagr_site', DB_PASSWORD: 'x' }).host, 'localhost');
  assert.equal(dbConfigFrom({}), null);
});

/* ---------- settings saved from the admin, read again without a restart ---------- */
test('saved settings switch the store on its next call; removing them goes back to the file', async () => {
  const dir = tmp();
  const db = fakeMaria();
  let pools = 0;
  const store = createLeadStore({ env: {}, dataDir: dir, readJsonFile, writeJsonFile, createPool: () => { pools++; return db.pool; } });
  try {
    assert.equal(store.kind, 'file');
    assert.equal((await store.status()).source, 'none');
    saveDbFile(store.configFile, { host: 'localhost', port: 3306, database: 'oliraagr_site', user: 'oliraagr_site', password: 'first-pass' });
    assert.equal(store.kind, 'mariadb', 'no restart needed');
    await store.add(lead('inq_live', '2026-10-06T10:00:00Z'));
    assert.ok(db.rows.has('inq_live'));
    const st = await store.status();
    assert.deepEqual([st.store, st.source, st.database], ['mariadb', 'admin', 'oliraagr_site']);
    assert.equal(store.settings().user, 'oliraagr_site');
    const before = pools;
    saveDbFile(store.configFile, { host: 'localhost', port: 3306, database: 'oliraagr_site', user: 'oliraagr_site', password: 'second-pass' });
    await store.all();
    assert.equal(pools, before + 1, 'a new password makes a new connection');
    fs.rmSync(store.configFile);
    assert.equal(store.kind, 'file');
  } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the admin\'s saved settings win over environment variables', async () => {
  const dir = tmp();
  const db = fakeMaria();
  const env = { DB_NAME: 'from_env', DB_USER: 'env_user', DB_PASSWORD: 'x' };
  const store = createLeadStore({ env, dataDir: dir, readJsonFile, writeJsonFile, createPool: () => db.pool });
  try {
    assert.equal(store.settings().database, 'from_env');
    assert.equal((await store.status()).source, 'environment');
    saveDbFile(store.configFile, { database: 'oliraagr_site', user: 'oliraagr_site', password: 'p' });
    assert.equal(store.settings().database, 'oliraagr_site');
    assert.equal((await store.status()).source, 'admin');
  } finally { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('what the admin types is checked, and a blank password keeps the saved one only for the same user', () => {
  const saved = { host: 'localhost', port: 3306, database: 'oliraagr_site', user: 'oliraagr_site', password: 'kept' };
  assert.deepEqual(cleanDbSettings({ database: 'oliraagr_site', user: 'oliraagr_site', password: '' }, saved).config.password, 'kept');
  assert.match(cleanDbSettings({ database: 'oliraagr_site', user: 'someone_else', password: '' }, saved).error, /password/);
  assert.match(cleanDbSettings({ database: 'olira site; DROP', user: 'u', password: 'p' }).error, /database name/);
  assert.match(cleanDbSettings({ database: 'd', user: "u'--", password: 'p' }).error, /database user/);
  assert.match(cleanDbSettings({ database: 'd', user: 'u', password: 'p', host: 'bad host/' }).error, /host/);
  assert.match(cleanDbSettings({ database: 'd', user: 'u', password: 'p', port: 70000 }).error, /port/);
  assert.deepEqual(cleanDbSettings({ database: 'd', user: 'u', password: 'p' }).config, { host: 'localhost', port: 3306, database: 'd', user: 'u', password: 'p' });
});

test('database.json: written whole, read back, and an incomplete one counts as none', () => {
  const dir = tmp();
  const f = path.join(dir, 'database.json');
  saveDbFile(f, { host: 'localhost', port: 3306, database: 'oliraagr_site', user: 'oliraagr_site', password: 'p' });
  assert.equal(readDbFile(f).password, 'p');
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')), 'no half-written file left');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600, 'readable by this account only');
  fs.writeFileSync(f, JSON.stringify({ database: 'oliraagr_site', user: 'oliraagr_site' }));
  assert.equal(readDbFile(f), null);
  fs.writeFileSync(f, '{not json');
  assert.equal(readDbFile(f), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
