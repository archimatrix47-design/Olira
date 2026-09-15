// Team workspaces: sales team accounts, the agriculture and packaging lead
// workspaces, replies sent from the site, quotes, and files attached to leads.
//
// Roles
//   admin  the owner password (tokens with no role, or role 'admin'); sees everything
//   agri   agriculture sales team: agriculture enquiries only
//   pack   packaging team: packaging enquiries, client files and mockups only
// A team token carries the member id and a password version. Every request
// re-reads the member, so deactivating an account, changing its team or
// resetting its password ends its sessions straight away.
//
// Client files are stored under DATA_DIR/client-files/<enquiry id>/, outside the
// public web root, and are only ever served to a signed-in member of the right
// team as a download (never rendered inline by the site).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

export const ROLES = { agri: 'Agriculture team', pack: 'Packaging team' };
export const LINES = ['agri', 'pack'];
export const lineOfProduct = (p) => (/packag|bag/i.test(String(p || '')) ? 'pack' : 'agri');
export const lineOf = (inq) => (LINES.includes(inq?.line) ? inq.line : lineOfProduct(inq?.product));

const MB = 1024 * 1024;
const FILE_MAX = 10 * MB;            // one client file
const INTAKE_TOTAL_MAX = 25 * MB;    // everything sent with one enquiry
const TEAM_FILE_MAX = 15 * MB;       // a file a team member adds (a mockup or quote)
const FILES_PER_LEAD = 30;

/* ---------------- file type sniffing ----------------
   The browser's declared type and the file name are both ignored: the first
   bytes decide, and the stored extension comes from what was found. */
const ALLOWED = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', eps: 'application/postscript',
};
export function sniffFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'; // also Illustrator .ai files
  if (buf.subarray(0, 4).toString('latin1') === '%!PS') return 'eps';
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}
const KIND_LABEL = { artwork: 'Artwork', logo: 'Logo', mockup: 'Mockup', document: 'Document', quote: 'Quote' };

function safeDisplayName(original, ext) {
  const base = String(original || 'file').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .slice(0, 80) || 'file';
  return `${base}.${ext === 'jpg' ? 'jpg' : ext}`;
}

/* ---------------- passwords ---------------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64, SCRYPT).toString('hex');
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = hashPw('not-a-real-password', DUMMY_SALT);

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function registerWorkspace(app, ctx) {
  const {
    dataDir, readJsonFile, writeJsonFile, audit, logError, sendEmail, loadEmailConfig,
    verifyTokenDetailed, generateToken, checkOrigin, clientIp, makeRateLimiter,
    inquiriesPath, isLoginDisabled, siteUrl,
  } = ctx;

  const teamPath = path.join(dataDir, 'team.json');
  const filesRoot = path.join(dataDir, 'client-files');
  if (!fs.existsSync(filesRoot)) fs.mkdirSync(filesRoot, { recursive: true });
  const FILES_CAP = (Number(process.env.CLIENT_FILES_MAX_MB) || 2048) * MB;

  /* ---------------- members ---------------- */
  const readTeam = () => {
    const t = readJsonFile(teamPath, { members: [] });
    return t && Array.isArray(t.members) ? t : { members: [] };
  };
  const publicMember = (m) => ({
    id: m.id, name: m.name, email: m.email, role: m.role, roleLabel: ROLES[m.role], active: m.active !== false,
    createdAt: m.createdAt, updatedAt: m.updatedAt, lastLoginAt: m.lastLoginAt || null,
  });

  // login throttling, per address and per account
  const ipFails = new Map(), accountFails = new Map();
  const locked = (map, key) => { const r = map.get(key); return r && r.until > Date.now() ? Math.ceil((r.until - Date.now()) / 60000) : 0; };
  const fail = (map, key, limit, windowMs, lockMs) => {
    const now = Date.now();
    const r = map.get(key) && now - map.get(key).first < windowMs ? map.get(key) : { first: now, count: 0, until: 0 };
    r.count++;
    if (r.count >= limit) r.until = now + lockMs;
    map.set(key, r);
  };
  setInterval(() => {
    const now = Date.now();
    for (const m of [ipFails, accountFails]) for (const [k, v] of m) if (v.until < now && now - v.first > 3600000) m.delete(k);
  }, 10 * 60 * 1000).unref();

  const loginLimit = makeRateLimiter(Number(process.env.ADMIN_LOGIN_RATE_PER_MIN) || 10, 'team-login');
  app.post('/api/team/login', loginLimit, (req, res) => {
    if (isLoginDisabled()) return res.status(503).json({ error: 'Sign in is temporarily unavailable. Contact the site administrator.' });
    if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const ip = clientIp(req);
    const email = clean(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const wait = Math.max(locked(ipFails, ip), locked(accountFails, email));
    if (wait) {
      audit('team_login_locked', req, { email });
      return res.status(429).json({ error: `Too many attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.` });
    }
    const member = readTeam().members.find((m) => m.email === email);
    // hash even when the account does not exist, so timing does not reveal which emails are real
    const ok = !!password && password.length <= 256 && (() => {
      const h = hashPw(password, member ? member.salt : DUMMY_SALT);
      return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(member ? member.hash : DUMMY_HASH, 'hex')) && !!member;
    })();
    if (!ok || member.active === false) {
      fail(ipFails, ip, 8, 10 * 60000, 15 * 60000);
      if (email) fail(accountFails, email, 6, 30 * 60000, 15 * 60000);
      audit('team_login_failed', req, { email, reason: ok ? 'inactive' : 'credentials' });
      return res.status(401).json({ error: ok ? 'This account is switched off. Ask the site administrator to turn it back on.' : 'That email and password do not match.' });
    }
    ipFails.delete(ip); accountFails.delete(email);
    const team = readTeam();
    const m = team.members.find((x) => x.id === member.id);
    m.lastLoginAt = new Date().toISOString();
    writeJsonFile(teamPath, team);
    audit('team_login_success', req, { member: m.id, role: m.role });
    res.json({ token: generateToken(ip, { role: m.role, uid: m.id, pv: m.pv || 1 }), member: publicMember(m) });
  });

  // Resolve who is calling. Admin tokens (no role) act as the owner.
  function resolveUser(req) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return { status: 401 };
    const v = verifyTokenDetailed(token, clientIp(req));
    if (!v.valid) return { status: 401, reason: v.reason };
    const p = v.payload;
    if (!p.role || p.role === 'admin') return { user: { id: 'admin', name: 'Administrator', email: null, role: 'admin' } };
    const m = readTeam().members.find((x) => x.id === p.uid);
    if (!m || m.active === false || m.role !== p.role || (m.pv || 1) !== p.pv) return { status: 401, reason: 'member_changed' };
    return { user: { id: m.id, name: m.name, email: m.email, role: m.role } };
  }
  const teamAuth = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkOrigin(req)) {
      audit('team_origin_rejected', req, { path: req.path });
      return res.status(403).json({ error: 'Forbidden' });
    }
    const r = resolveUser(req);
    if (!r.user) {
      audit('team_auth_rejected', req, { path: req.path, reason: r.reason });
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = r.user;
    next();
  };
  const canSee = (user, inq) => user.role === 'admin' || user.role === lineOf(inq);
  const who = (u) => ({ id: u.id, name: u.name });

  app.get('/api/team/me', teamAuth, (req, res) => {
    const members = readTeam().members.filter((m) => m.active !== false).map((m) => ({ id: m.id, name: m.name, role: m.role }));
    res.json({ user: { ...req.user, roleLabel: ROLES[req.user.role] || 'Administrator' }, members });
  });

  app.post('/api/team/password', teamAuth, (req, res) => {
    if (req.user.role === 'admin') return res.status(400).json({ error: 'Change the admin password in the admin panel.' });
    const { current, next } = req.body || {};
    if (typeof next !== 'string' || next.length < 12 || next.length > 256) return res.status(400).json({ error: 'The new password needs at least 12 characters.' });
    const team = readTeam();
    const m = team.members.find((x) => x.id === req.user.id);
    const h = hashPw(typeof current === 'string' ? current : '', m.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(m.hash, 'hex'))) return res.status(400).json({ error: 'The current password is not right.' });
    m.salt = crypto.randomBytes(16).toString('hex');
    m.hash = hashPw(next, m.salt);
    m.pv = (m.pv || 1) + 1;
    m.updatedAt = new Date().toISOString();
    if (!writeJsonFile(teamPath, team)) return res.status(500).json({ error: 'The password could not be saved.' });
    audit('team_password_changed', req, { member: m.id });
    res.json({ success: true, token: generateToken(clientIp(req), { role: m.role, uid: m.id, pv: m.pv }) });
  });

  /* ---------------- admin: manage members ---------------- */
  const ownerOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only the site administrator can do this.' }));

  app.get('/api/admin/team', teamAuth, ownerOnly, (req, res) => {
    res.json({ members: readTeam().members.map(publicMember), roles: ROLES });
  });

  app.post('/api/admin/team', teamAuth, ownerOnly, (req, res) => {
    const b = req.body?.member || {};
    const name = clean(b.name, 80), email = clean(b.email, 200).toLowerCase();
    const role = b.role, password = typeof b.password === 'string' ? b.password : '';
    if (!name) return res.status(400).json({ error: 'Give the team member a name.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter the team member\'s work email address. Buyers\' replies go to it.' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Choose the Agriculture team or the Packaging team.' });
    if (password && (password.length < 12 || password.length > 256)) return res.status(400).json({ error: 'The password needs at least 12 characters.' });
    const team = readTeam();
    const now = new Date().toISOString();
    if (team.members.some((m) => m.email === email && m.id !== b.id)) return res.status(409).json({ error: 'Another team member already uses this email.' });
    let m = b.id ? team.members.find((x) => x.id === b.id) : null;
    if (b.id && !m) return res.status(404).json({ error: 'Team member not found.' });
    if (!m) {
      if (!password) return res.status(400).json({ error: 'Set a first password of at least 12 characters. Share it with the team member privately.' });
      m = { id: `tm_${crypto.randomBytes(6).toString('hex')}`, createdAt: now, pv: 1 };
      team.members.push(m);
    }
    const revoke = (m.role && m.role !== role) || (m.active !== false && b.active === false) || !!password;
    Object.assign(m, { name, email, role, active: b.active !== false, updatedAt: now });
    if (password) { m.salt = crypto.randomBytes(16).toString('hex'); m.hash = hashPw(password, m.salt); }
    if (revoke && m.hash && m.createdAt !== now) m.pv = (m.pv || 1) + 1;
    if (!writeJsonFile(teamPath, team)) return res.status(500).json({ error: 'The team member could not be saved.' });
    audit('team_member_saved', req, { member: m.id, role, active: m.active });
    res.json({ success: true, member: publicMember(m) });
  });

  app.delete('/api/admin/team/:id', teamAuth, ownerOnly, (req, res) => {
    const team = readTeam();
    const next = team.members.filter((m) => m.id !== req.params.id);
    if (next.length === team.members.length) return res.status(404).json({ error: 'Team member not found.' });
    if (!writeJsonFile(teamPath, { ...team, members: next })) return res.status(500).json({ error: 'The team member could not be removed.' });
    audit('team_member_deleted', req, { member: req.params.id });
    res.json({ success: true });
  });

  /* ---------------- leads ---------------- */
  const readLeads = () => { const l = readJsonFile(inquiriesPath, []); return Array.isArray(l) ? l : null; };
  const STATUSES = ['new', 'read', 'contacted', 'quoted', 'won', 'lost', 'archived'];
  const pushHistory = (rec, status, user) => {
    if (status === rec.status) return;
    if (!Array.isArray(rec.history)) rec.history = [];
    rec.history.push({ status, at: new Date().toISOString(), from: rec.status || 'new', by: who(user) });
    if (rec.history.length > 50) rec.history.splice(0, rec.history.length - 50);
    rec.status = status;
  };
  const pushActivity = (rec, entry) => {
    if (!Array.isArray(rec.activity)) rec.activity = [];
    rec.activity.push({ id: `act_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`, at: new Date().toISOString(), ...entry });
    if (rec.activity.length > 200) rec.activity.splice(0, rec.activity.length - 200);
  };
  // a lead that someone has worked on is theirs unless it already has an owner,
  // and it leaves New: owned but still New read as "accepted" and "waiting" at once
  const claim = (rec, user) => {
    if (rec.assignee || user.role === 'admin') return;
    rec.assignee = { ...who(user), at: new Date().toISOString() };
    if (rec.status === 'new') pushHistory(rec, 'read', user);
    pushActivity(rec, { type: 'accepted', by: who(user) });
  };

  function withLead(req, res, fn) {
    const list = readLeads();
    if (!list) return res.status(500).json({ error: 'The enquiry store could not be read.' });
    const rec = list.find((i) => i.id === req.params.id);
    if (!rec || !canSee(req.user, rec)) return res.status(404).json({ error: 'Enquiry not found.' });
    return fn(rec, list);
  }
  const save = (res, list, rec) => (writeJsonFile(inquiriesPath, list)
    ? res.json({ success: true, inquiry: { ...rec, line: lineOf(rec) } })
    : res.status(500).json({ error: 'The change could not be saved.' }));

  app.get('/api/team/inquiries', teamAuth, (req, res) => {
    const list = readLeads();
    if (!list) return res.status(500).json({ error: 'The enquiry store could not be read.' });
    const line = req.user.role === 'admin' ? (LINES.includes(req.query.line) ? req.query.line : null) : req.user.role;
    const mine = list.filter((i) => !line || lineOf(i) === line).map((i) => ({ ...i, line: lineOf(i) }));
    res.json({ inquiries: mine, line });
  });

  app.post('/api/team/inquiries/:id', teamAuth, (req, res) => withLead(req, res, (rec, list) => {
    const { status, assign } = req.body || {};
    if (status === undefined && assign === undefined) return res.status(400).json({ error: 'Send a stage or an owner.' });
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown stage.' });
    if (assign !== undefined) {
      if (assign === 'me') {
        if (req.user.role === 'admin') return res.status(400).json({ error: 'The administrator cannot own leads. Assign it to a team member.' });
        if (rec.assignee && rec.assignee.id !== req.user.id) return res.status(409).json({ error: `${rec.assignee.name} has already accepted this enquiry.`, inquiry: rec });
        rec.assignee = { ...who(req.user), at: new Date().toISOString() };
        if (rec.status === 'new') pushHistory(rec, 'read', req.user);
        pushActivity(rec, { type: 'accepted', by: who(req.user) });
      } else if (assign === 'none') {
        if (rec.assignee && rec.assignee.id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner or the administrator can release this enquiry.' });
        if (rec.assignee) pushActivity(rec, { type: 'released', by: who(req.user), text: rec.assignee.name });
        delete rec.assignee;
      } else {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the administrator can hand an enquiry to someone else.' });
        const m = readTeam().members.find((x) => x.id === assign && x.active !== false);
        if (!m || m.role !== lineOf(rec)) return res.status(400).json({ error: 'Choose an active member of this enquiry\'s team.' });
        rec.assignee = { id: m.id, name: m.name, at: new Date().toISOString() };
        pushActivity(rec, { type: 'assigned', by: who(req.user), text: m.name });
      }
    }
    if (status !== undefined && status !== rec.status) { pushHistory(rec, status, req.user); claim(rec, req.user); }
    return save(res, list, rec);
  }));

  const ACTIVITY_TYPES = { note: 'Note', call: 'Phone call', whatsapp: 'WhatsApp', email: 'Email from own mailbox', meeting: 'Meeting' };
  app.post('/api/team/inquiries/:id/activity', teamAuth, (req, res) => withLead(req, res, (rec, list) => {
    const type = req.body?.type, text = clean(req.body?.text, 2000);
    if (!ACTIVITY_TYPES[type]) return res.status(400).json({ error: 'Choose what kind of contact this was.' });
    if (!text) return res.status(400).json({ error: type === 'note' ? 'Write the note first.' : 'Add a line about what was discussed.' });
    pushActivity(rec, { type, text, by: who(req.user) });
    if (type !== 'note' && ['new', 'read'].includes(rec.status)) pushHistory(rec, 'contacted', req.user);
    if (type !== 'note') claim(rec, req.user);
    return save(res, list, rec);
  }));

  /* ---------------- quotes ---------------- */
  const num = (v, max = 1e12) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1e4) / 1e4 : null; };
  function cleanQuote(q, line) {
    if (!q || typeof q !== 'object') return { error: 'Fill in the quote first.' };
    const currency = ['USD', 'EUR', 'ETB'].includes(q.currency) ? q.currency : 'USD';
    const items = (Array.isArray(q.items) ? q.items : []).slice(0, 12).map((it) => ({
      item: clean(it?.item, 160), detail: clean(it?.detail, 240), qty: num(it?.qty), unit: clean(it?.unit, 20), price: num(it?.price),
    })).filter((it) => it.item);
    if (!items.length) return { error: 'Add at least one line with a product.' };
    const bad = items.find((it) => it.qty == null || it.qty === 0 || it.price == null);
    if (bad) return { error: `Give "${bad.item}" a quantity and a unit price.` };
    const extra = num(q.extra) || 0;
    const total = Math.round((items.reduce((n, it) => n + it.qty * it.price, 0) + extra) * 100) / 100;
    const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(q.validUntil || '') ? q.validUntil : null;
    return {
      quote: {
        number: clean(q.number, 40), currency, items, extra, extraLabel: clean(q.extraLabel, 80), total, validUntil,
        terms: {
          incoterm: clean(q.terms?.incoterm, 60), port: clean(q.terms?.port, 80), payment: clean(q.terms?.payment, 120),
          shipment: clean(q.terms?.shipment, 120), packing: clean(q.terms?.packing, 160), leadTime: clean(q.terms?.leadTime, 80),
        },
        notes: clean(q.notes, 1500), line,
      },
    };
  }
  app.post('/api/team/inquiries/:id/quote', teamAuth, (req, res) => withLead(req, res, (rec, list) => {
    const r = cleanQuote(req.body?.quote, lineOf(rec));
    if (r.error) return res.status(400).json({ error: r.error });
    const at = new Date().toISOString();
    if (!r.quote.number) r.quote.number = `Q-${at.slice(0, 10).replace(/-/g, '')}-${rec.id.slice(-4).toUpperCase()}`;
    rec.quote = { ...r.quote, at, by: who(req.user) };
    if (!Array.isArray(rec.quotes)) rec.quotes = [];
    rec.quotes.push(rec.quote);
    if (rec.quotes.length > 20) rec.quotes.splice(0, rec.quotes.length - 20);
    pushActivity(rec, { type: 'quote', by: who(req.user), text: `${r.quote.currency} ${r.quote.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, number: rec.quote.number });
    if (!['won', 'lost', 'archived'].includes(rec.status)) pushHistory(rec, 'quoted', req.user);
    claim(rec, req.user);
    return save(res, list, rec);
  }));

  /* ---------------- replies by email ---------------- */
  const replyLimit = makeRateLimiter(Number(process.env.TEAM_REPLY_RATE_PER_MIN) || 20, 'team-reply');
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  app.post('/api/team/inquiries/:id/reply', replyLimit, teamAuth, (req, res) => withLead(req, res, async (rec, list) => {
    const subject = clean(req.body?.subject, 200), body = typeof req.body?.body === 'string' ? req.body.body.replace(/\r\n/g, '\n').slice(0, 10000).trim() : '';
    const ids = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 6) : [];
    if (!EMAIL_RE.test(rec.email || '')) return res.status(400).json({ error: 'This enquiry has no valid email address to reply to.' });
    if (!subject) return res.status(400).json({ error: 'Add a subject.' });
    if (body.length < 10) return res.status(400).json({ error: 'Write the reply first.' });
    const files = ids.map((id) => (rec.files || []).find((f) => f.id === id));
    if (files.some((f) => !f)) return res.status(400).json({ error: 'One of the attachments is no longer on this enquiry.' });
    const totalSize = files.reduce((n, f) => n + f.size, 0);
    if (totalSize > 20 * MB) return res.status(400).json({ error: 'Attachments add up to more than 20 MB. Leave some out or send them from your own mailbox.' });

    const config = loadEmailConfig();
    if (!config || !config.smtpUser || !config.smtpPassword) return res.status(503).json({ error: 'Email sending is not set up on the website yet.', code: 'no_smtp' });
    const replyTo = req.user.email || config.recipientEmail;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:640px">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`;
    try {
      await sendEmail(rec.email, subject, html, {
        text: body,
        replyTo,
        bcc: req.body?.copyMe !== false && req.user.email ? req.user.email : undefined,
        fromName: req.user.role === 'admin' ? undefined : `${req.user.name}, ${config.fromName || 'Olira Agro Industry'}`,
        attachments: files.map((f) => ({ filename: f.name, path: path.join(filesRoot, rec.id, f.stored), contentType: f.type })),
      });
    } catch (err) {
      logError('team_reply_failed', err, { inquiry: rec.id });
      return res.status(502).json({ error: 'The email server did not accept the message. Nothing was sent.', code: 'send_failed' });
    }
    // re-read: the send can take seconds and someone may have changed the lead meanwhile
    const fresh = readLeads();
    const cur = fresh && fresh.find((i) => i.id === rec.id);
    if (!cur) return res.json({ success: true, inquiry: rec });
    pushActivity(cur, { type: 'reply', by: who(req.user), subject, text: body, to: cur.email, replyTo, attachments: files.map((f) => ({ id: f.id, name: f.name })) });
    if (['new', 'read'].includes(cur.status)) pushHistory(cur, 'contacted', req.user);
    claim(cur, req.user);
    audit('team_reply_sent', req, { inquiry: cur.id, attachments: files.length });
    return save(res, fresh, cur);
  }));

  /* ---------------- files ---------------- */
  const dirOf = (id) => {
    if (!/^inq_[\w]+$/.test(id)) throw new Error('bad id');
    return path.join(filesRoot, id);
  };
  const usedBytes = () => (readLeads() || []).reduce((n, i) => n + (i.files || []).reduce((m, f) => m + (f.size || 0), 0), 0);

  function storeFile(rec, buffer, original, kind, source, user) {
    const ext = sniffFile(buffer);
    if (!ext) return { error: `"${String(original || 'file').slice(0, 60)}" is not a file type we accept. Send PDF, AI, EPS, SVG, PNG, JPG or WebP.` };
    const id = `f_${crypto.randomBytes(8).toString('hex')}`;
    const dir = dirOf(rec.id);
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${id}.${ext}`;
    fs.writeFileSync(path.join(dir, stored), buffer);
    const meta = { id, stored, name: safeDisplayName(original, ext), type: ALLOWED[ext], ext, size: buffer.length, kind: KIND_LABEL[kind] ? kind : 'document', source, at: new Date().toISOString() };
    if (user) meta.by = who(user);
    if (!Array.isArray(rec.files)) rec.files = [];
    rec.files.push(meta);
    return { file: meta };
  }

  // Files sent with a packaging quote request (called from POST /api/inquiry).
  function saveIntakeFiles(rec, files) {
    const saved = [], rejected = [];
    const total = files.reduce((n, f) => n + f.buffer.length, 0);
    if (total > INTAKE_TOTAL_MAX || usedBytes() + total > FILES_CAP) return { saved, rejected: files.map((f) => f.originalname), full: true };
    for (const f of files) {
      const kind = f.fieldname === 'logo' ? 'logo' : f.fieldname === 'mockup' ? 'mockup' : 'artwork';
      const r = storeFile(rec, f.buffer, f.originalname, kind, 'client');
      if (r.error) rejected.push(f.originalname); else saved.push(r.file);
    }
    return { saved, rejected };
  }

  function removeLeadFiles(id) {
    try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch (e) { logError('lead_files_remove_failed', e, { id }); }
  }

  // public intake: multipart only when files are attached
  const intakeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FILE_MAX, files: 5, fields: 20, fieldSize: 20 * 1024, parts: 30 },
  }).fields([{ name: 'files', maxCount: 3 }, { name: 'logo', maxCount: 1 }, { name: 'mockup', maxCount: 1 }]);
  function parseIntake(req, res, next) {
    if (!req.is('multipart/form-data')) return next();
    intakeUpload(req, res, (err) => {
      if (!err) return next();
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file can be up to 10 MB. Send larger artwork after we reply.'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Attach up to 3 artwork files.'
          : 'The files could not be read. Try again, or send the request without them.';
      res.status(400).json({ error: msg });
    });
  }

  const teamUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TEAM_FILE_MAX, files: 1, fields: 5 } }).single('file');
  app.post('/api/team/inquiries/:id/files', teamAuth, (req, res) => teamUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 15 MB.' : 'The file could not be read.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file.' });
    return withLead(req, res, (rec, list) => {
      if ((rec.files || []).length >= FILES_PER_LEAD) return res.status(400).json({ error: `An enquiry can hold ${FILES_PER_LEAD} files. Remove one first.` });
      if (usedBytes() + req.file.size > FILES_CAP) return res.status(507).json({ error: 'File storage is full. Ask the administrator to clear old enquiries.' });
      const kind = ['mockup', 'quote', 'artwork', 'document'].includes(req.body?.kind) ? req.body.kind : 'document';
      const r = storeFile(rec, req.file.buffer, req.file.originalname, kind, 'team', req.user);
      if (r.error) return res.status(400).json({ error: r.error });
      pushActivity(rec, { type: 'file', by: who(req.user), text: r.file.name, fileId: r.file.id });
      claim(rec, req.user);
      return save(res, list, rec);
    });
  }));

  app.get('/api/team/inquiries/:id/files/:fileId', teamAuth, (req, res) => withLead(req, res, (rec) => {
    const f = (rec.files || []).find((x) => x.id === req.params.fileId);
    if (!f) return res.status(404).json({ error: 'File not found.' });
    const full = path.join(dirOf(rec.id), f.stored);
    if (!full.startsWith(filesRoot + path.sep) || !fs.existsSync(full)) return res.status(404).json({ error: 'File not found.' });
    const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.set({
      'Content-Type': f.type,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    audit('lead_file_downloaded', req, { inquiry: rec.id, file: f.id });
    fs.createReadStream(full).pipe(res);
  }));

  app.delete('/api/team/inquiries/:id/files/:fileId', teamAuth, (req, res) => withLead(req, res, (rec, list) => {
    const f = (rec.files || []).find((x) => x.id === req.params.fileId);
    if (!f) return res.status(404).json({ error: 'File not found.' });
    if (f.source === 'client' && req.user.role !== 'admin') return res.status(403).json({ error: 'Files the client sent are kept. Only the administrator can remove them.' });
    try { fs.rmSync(path.join(dirOf(rec.id), f.stored), { force: true }); } catch (e) { logError('lead_file_remove_failed', e); }
    rec.files = rec.files.filter((x) => x.id !== f.id);
    return save(res, list, rec);
  }));

  /* ---------------- who hears about a new lead ---------------- */
  function teamEmailsFor(line) {
    return readTeam().members.filter((m) => m.active !== false && m.role === line).map((m) => m.email);
  }
  const workspaceUrl = (rec) => `${siteUrl()}/team/${lineOf(rec) === 'pack' ? 'packaging' : 'agriculture'}/#inbox?lead=${encodeURIComponent(rec.id)}`;

  return { saveIntakeFiles, removeLeadFiles, parseIntake, teamEmailsFor, workspaceUrl, resolveUser, teamAuth };
}
