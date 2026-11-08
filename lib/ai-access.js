// AI access to the website's performance log (lib/ai-log.js).
//
// AI reader accounts: the admin creates one per AI tool (Claude, for one). Each is a
// key shown once, when it is made; only its SHA-256 hash is stored, so the key cannot
// be read back from the server. A key reads the log and nothing else: it is not a
// staff token, so every other route refuses it. The admin can remove a key, and one
// switch turns all of them off at once. The admin never sees the log itself.
//
// Local model: a model on the owner's own computer or office network (Ollama, or an
// OpenAI-compatible server such as LM Studio) answers the manager's questions about
// the log. The manager's browser sends the question and the log straight to it; this
// server never connects to it. Its address must be this computer or a private
// network, and it is allowed in the page's Content-Security-Policy only on the admin
// (to check the connection) and the manager's pages (connectSource below).
//
// Stored in DATA_DIR/ai-access.json. Nothing here is ever written to the repository.
import crypto from 'node:crypto';
import path from 'node:path';
import { SCHEMA } from './ai-log.js';

export const KEY_PREFIX = 'olira_ai_';
const MAX_KEYS = 10;
export const KINDS = { ollama: 'Ollama', openai: 'OpenAI-compatible (LM Studio, llama.cpp, vLLM)' };

export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
export const newKey = () => `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;

/** This computer or a private network: 127/8, ::1, localhost, 10/8, 172.16/12, 192.168/16. */
export function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The local model's settings from the admin's form: { llm } or { error }. */
export function cleanLlm(input) {
  const kind = KINDS[input?.kind] ? input.kind : 'ollama';
  const enabled = input?.enabled === true;
  const model = String(input?.model ?? '').trim();
  const raw = String(input?.url ?? '').trim();
  if (model && !/^[\w.:/@-]{1,100}$/.test(model)) return { error: 'The model name has letters, numbers and . : / - _ only, as the program lists it (for example llama3.1:8b).' };
  let url = '';
  if (raw) {
    let u;
    try { u = new URL(raw); } catch (e) { return { error: 'The address is not a web address. For Ollama on this computer it is http://localhost:11434.' }; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) return { error: 'The address is http:// or https://, a computer and a port, with nothing after it but a path such as /v1.' };
    if (!isLocalHost(u.hostname)) return { error: 'Only a model on this computer (localhost) or your office network (such as 192.168.x.x) is accepted, so the data never leaves your own machines.' };
    url = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }
  if (enabled && (!url || !model)) return { error: 'Give the address and the model name before switching the local model on.' };
  return { llm: { enabled, kind, url, model } };
}

/** The origin a page may connect to for the local model, or null. */
export function llmOrigin(llm) {
  try { return llm?.url ? new URL(llm.url).origin : null; } catch (e) { return null; }
}

const EMPTY = () => ({ enabled: false, keys: [], llm: { enabled: false, kind: 'ollama', url: '', model: '' } });
const publicKey = (k) => ({ id: k.id, name: k.name, hint: k.hint, createdAt: k.createdAt, lastReadAt: k.lastReadAt || null, reads: k.reads || 0, removedAt: k.removedAt || null });

/**
 * Routes and helpers. buildLog({ days }) and history() come from server.js;
 * readerAuth guards the AI routes.
 */
export function registerAiAccess(app, { dataDir, readJsonFile, writeJsonFile, adminAuth, managerOnly, rateLimit, audit = () => {}, buildLog, history }) {
  const file = path.join(dataDir, 'ai-access.json');
  const read = () => {
    const d = readJsonFile(file, null);
    const base = EMPTY();
    if (!d || typeof d !== 'object') return base;
    return { enabled: d.enabled === true, keys: Array.isArray(d.keys) ? d.keys : [], llm: { ...base.llm, ...(d.llm || {}) } };
  };
  const write = (d) => writeJsonFile(file, { ...d, updatedAt: new Date().toISOString() });

  /** An AI reader key, in the Authorization header only: 401 unknown or removed, 403 while switched off. */
  function readerAuth(req, res, next) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    const key = m?.[1] || '';
    res.set('Cache-Control', 'no-store');
    if (!key.startsWith(KEY_PREFIX)) return res.status(401).json({ error: 'An AI reader key is needed, in the Authorization header.' });
    const d = read();
    const want = Buffer.from(hashKey(key), 'hex');
    const k = d.keys.find((x) => !x.removedAt && typeof x.hash === 'string' && x.hash.length === 64 && crypto.timingSafeEqual(Buffer.from(x.hash, 'hex'), want));
    if (!k) return res.status(401).json({ error: 'This key is not known, or it was removed.' });
    if (!d.enabled) return res.status(403).json({ error: 'AI access is switched off by the website admin.' });
    // when it was last used, so the admin can remove an account nobody uses (reads are few and rate-limited)
    k.reads = (k.reads || 0) + 1;
    k.lastReadAt = new Date().toISOString();
    write(d);
    req.aiReader = { id: k.id, name: k.name };
    next();
  }

  const days = (q) => Math.min(Math.max(parseInt(q, 10) || 30, 7), 365);
  // the enquiry store may be a database that is down for a moment: say so, never half a log
  const sendLog = async (req, res) => {
    try { res.json(await buildLog({ days: days(req.query.days) })); }
    catch (e) { res.status(503).json({ error: 'The log cannot be built just now (the enquiry store did not answer). Try again in a few minutes.' }); }
  };

  /* ---------- the AI reader ---------- */
  app.get('/api/ai/log', rateLimit, readerAuth, sendLog);
  app.get('/api/ai/history', rateLimit, readerAuth, (req, res) => res.json({ days: history() }));
  app.get('/api/ai/schema', rateLimit, readerAuth, (req, res) => res.json(SCHEMA));

  /* ---------- the admin: accounts, the switch, the local model (never the log) ---------- */
  app.get('/api/admin/ai-access', adminAuth, (req, res) => {
    const d = read();
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: d.enabled, keys: d.keys.map(publicKey), llm: d.llm, kinds: KINDS });
  });
  app.post('/api/admin/ai-access', adminAuth, (req, res) => {
    const d = read();
    const body = req.body || {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'Switch it on or off.' });
      if (body.enabled !== d.enabled) audit(body.enabled ? 'ai_access_on' : 'ai_access_off', req);
      d.enabled = body.enabled;
    }
    if (body.llm !== undefined) {
      const out = cleanLlm(body.llm);
      if (out.error) return res.status(400).json({ error: out.error });
      d.llm = out.llm;
      audit('ai_local_model_saved', req, { kind: out.llm.kind, on: out.llm.enabled });
    }
    if (!write(d)) return res.status(500).json({ error: 'The setting could not be saved. Try again.' });
    res.json({ enabled: d.enabled, keys: d.keys.map(publicKey), llm: d.llm, kinds: KINDS });
  });
  app.post('/api/admin/ai-access/keys', adminAuth, (req, res) => {
    const d = read();
    const name = String(req.body?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Name the account after the tool that will use it, for example Claude.' });
    if (d.keys.filter((k) => !k.removedAt).length >= MAX_KEYS) return res.status(400).json({ error: `There are already ${MAX_KEYS} accounts. Remove one you no longer use first.` });
    const key = newKey();
    const entry = { id: `aik_${crypto.randomBytes(6).toString('hex')}`, name, hash: hashKey(key), hint: `${key.slice(0, KEY_PREFIX.length + 4)}…`, createdAt: new Date().toISOString(), reads: 0 };
    d.keys.push(entry);
    if (!write(d)) return res.status(500).json({ error: 'The account could not be saved. Try again.' });
    audit('ai_reader_created', req, { name });
    // the only time the key itself leaves the server
    res.set('Cache-Control', 'no-store');
    res.json({ key, account: publicKey(entry) });
  });
  app.delete('/api/admin/ai-access/keys/:id', adminAuth, (req, res) => {
    const d = read();
    const k = d.keys.find((x) => x.id === req.params.id && !x.removedAt);
    if (!k) return res.status(404).json({ error: 'That account is not there, or it was already removed.' });
    k.removedAt = new Date().toISOString();
    delete k.hash; // nothing left that a key could match
    if (!write(d)) return res.status(500).json({ error: 'The account could not be removed. Try again.' });
    audit('ai_reader_removed', req, { name: k.name });
    res.json({ keys: d.keys.map(publicKey) });
  });

  /* ---------- the manager: the log and the local model to ask ---------- */
  app.get('/api/team/manager/ai', managerOnly, (req, res) => {
    const { llm } = read();
    res.set('Cache-Control', 'no-store');
    // the log's field meanings travel with it, so the model reads it right
    res.json({ llm: llm.enabled && llm.url && llm.model ? { kind: llm.kind, url: llm.url, model: llm.model } : null, schema: { units: SCHEMA.units, sections: SCHEMA.sections } });
  });
  app.get('/api/team/manager/ai-log', managerOnly, (req, res) => { res.set('Cache-Control', 'no-store'); return sendLog(req, res); });

  /**
   * For the Content-Security-Policy's connect-src: the local model's origin on the
   * admin's and the manager's pages, and nothing extra anywhere else. ("'self'" is
   * returned instead of nothing, as a directive's source cannot be empty.)
   */
  function connectSource(req) {
    const p = req.path || '';
    if (!(p === '/admin' || p.startsWith('/admin/') || p === '/admin.html' || p === '/team/manager' || p.startsWith('/team/manager/'))) return "'self'";
    const origin = llmOrigin(read().llm);
    return origin && origin.startsWith('http:') ? origin : "'self'";
  }

  return { readerAuth, connectSource, read };
}
