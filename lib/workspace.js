// BOX enquiry-work: working the enquiries once they have arrived. The agriculture and
// packaging inboxes, the manager's view of both, replies sent from the site, quotes,
// and files attached to leads. Staff accounts are the staff-accounts box.
//
// Roles
//   admin    the owner password (tokens with no role, or role 'admin'): runs the
//            site and manages accounts, but does not see or work enquiries
//   manager  both lines: every enquiry, hands them to team members, deletes them
//   agri     agriculture marketing team: agriculture enquiries only
//   pack     packaging marketing team: packaging enquiries, client files and mockups only
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
import { clean, isEmail, siteUrl } from './site-basics.js';
import { lineOf, LINES } from './enquiry.js';

/** A manager sees and works every enquiry in both lines. */
export const oversees = (u) => u?.role === 'manager';
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
  // A comment body that cannot contain "-->" leaves one way to match: the old
  // `(<!--[\s\S]*?-->\s*)*` could split a row of empty comments 2^n ways, and a 300-byte
  // upload froze the whole server (white-hat, 23 Nov 2026).
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
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

export function registerWorkspace(app, ctx) {
  const { dataDir, audit, logError, sendEmail, loadEmailConfig, makeRateLimiter, leads, teamAuth, readTeam, certificateFile = () => null } = ctx;
  // Express 4 does not catch a rejected promise: an async route passes its error on
  const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  // the enquiry store (lib/lead-store.js) could not be reached: say so, never a bare 500
  const storeDown = (res, e) => {
    logError('lead_store_unavailable', e);
    return res.status(503).json({ error: 'The enquiry list cannot be reached right now. Try again in a minute.', code: 'store_unavailable' });
  };

  const filesRoot = path.join(dataDir, 'client-files');
  if (!fs.existsSync(filesRoot)) fs.mkdirSync(filesRoot, { recursive: true });
  const FILES_CAP = (Number(process.env.CLIENT_FILES_MAX_MB) || 2048) * MB;

  const canSee = (user, inq) => oversees(user) || user.role === lineOf(inq);
  const who = (u) => ({ id: u.id, name: u.name });

  /* ---------------- leads ---------------- */
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
    if (rec.assignee || oversees(user)) return; // a manager working a lead does not take it over
    rec.assignee = { ...who(user), at: new Date().toISOString() };
    if (rec.status === 'new') pushHistory(rec, 'read', user);
    pushActivity(rec, { type: 'accepted', by: who(user) });
  };

  // load the enquiry the route names, check this member may see it, then run fn
  async function withLead(req, res, fn) {
    let rec;
    try { rec = await leads.get(req.params.id); } catch (e) { return storeDown(res, e); }
    if (!rec || !canSee(req.user, rec)) return res.status(404).json({ error: 'Enquiry not found.' });
    return fn(rec);
  }
  // save one changed enquiry (others are not touched, so two people working on
  // two enquiries never overwrite each other)
  async function save(res, rec) {
    try {
      if (!(await leads.put(rec))) return res.status(404).json({ error: 'Enquiry not found.' });
    } catch (e) { return storeDown(res, e); }
    return res.json({ success: true, inquiry: { ...rec, line: lineOf(rec) } });
  }

  app.get('/api/team/inquiries', teamAuth, safe(async (req, res) => {
    let list;
    try { list = await leads.all(); } catch (e) { return storeDown(res, e); }
    const line = oversees(req.user) ? (LINES.includes(req.query.line) ? req.query.line : null) : req.user.role;
    const mine = list.filter((i) => !line || lineOf(i) === line).map((i) => ({ ...i, line: lineOf(i) }));
    res.json({ inquiries: mine, line });
  }));

  app.post('/api/team/inquiries/:id', teamAuth, safe((req, res) => withLead(req, res, (rec) => {
    const { status, assign } = req.body || {};
    if (status === undefined && assign === undefined) return res.status(400).json({ error: 'Send a stage or an owner.' });
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown stage.' });
    if (assign !== undefined) {
      if (assign === 'me') {
        if (oversees(req.user)) return res.status(400).json({ error: 'A manager hands enquiries to team members. Choose who takes it.' });
        if (rec.assignee && rec.assignee.id !== req.user.id) return res.status(409).json({ error: `${rec.assignee.name} has already accepted this enquiry.`, inquiry: rec });
        rec.assignee = { ...who(req.user), at: new Date().toISOString() };
        if (rec.status === 'new') pushHistory(rec, 'read', req.user);
        pushActivity(rec, { type: 'accepted', by: who(req.user) });
      } else if (assign === 'none') {
        if (rec.assignee && rec.assignee.id !== req.user.id && !oversees(req.user)) return res.status(403).json({ error: 'Only the owner or a manager can release this enquiry.' });
        if (rec.assignee) pushActivity(rec, { type: 'released', by: who(req.user), text: rec.assignee.name });
        delete rec.assignee;
      } else {
        if (!oversees(req.user)) return res.status(403).json({ error: 'Only a manager can hand an enquiry to someone else.' });
        const m = readTeam().members.find((x) => x.id === assign && x.active !== false);
        if (!m || m.role !== lineOf(rec)) return res.status(400).json({ error: 'Choose an active member of this enquiry\'s team.' });
        rec.assignee = { id: m.id, name: m.name, at: new Date().toISOString() };
        // someone has it now, as when a team member accepts it
        if (rec.status === 'new') pushHistory(rec, 'read', req.user);
        pushActivity(rec, { type: 'assigned', by: who(req.user), text: m.name });
      }
    }
    if (status !== undefined && status !== rec.status) { pushHistory(rec, status, req.user); claim(rec, req.user); }
    return save(res, rec);
  })));

  app.delete('/api/team/inquiries/:id', teamAuth, safe((req, res) => withLead(req, res, async (rec) => {
    if (!oversees(req.user)) return res.status(403).json({ error: 'Only a manager can delete an enquiry. Mark it Lost or Archived instead.' });
    try { await leads.remove(rec.id); } catch (e) { return storeDown(res, e); }
    removeLeadFiles(rec.id);
    audit('inquiry_deleted', req, { inquiry: rec.id, by: req.user.id });
    return res.json({ success: true });
  })));

  const ACTIVITY_TYPES = { note: 'Note', call: 'Phone call', whatsapp: 'WhatsApp', email: 'Email from own mailbox', meeting: 'Meeting' };
  app.post('/api/team/inquiries/:id/activity', teamAuth, safe((req, res) => withLead(req, res, (rec) => {
    const type = req.body?.type, text = clean(req.body?.text, 2000);
    if (!Object.hasOwn(ACTIVITY_TYPES, String(type))) return res.status(400).json({ error: 'Choose what kind of contact this was.' });
    if (!text) return res.status(400).json({ error: type === 'note' ? 'Write the note first.' : 'Add a line about what was discussed.' });
    pushActivity(rec, { type, text, by: who(req.user) });
    if (type !== 'note' && ['new', 'read'].includes(rec.status)) pushHistory(rec, 'contacted', req.user);
    if (type !== 'note') claim(rec, req.user);
    return save(res, rec);
  })));

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
  app.post('/api/team/inquiries/:id/quote', teamAuth, safe((req, res) => withLead(req, res, (rec) => {
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
    return save(res, rec);
  })));

  /* ---------------- replies by email ---------------- */
  const replyLimit = makeRateLimiter(Number(process.env.TEAM_REPLY_RATE_PER_MIN) || 20, 'team-reply');
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  app.post('/api/team/inquiries/:id/reply', replyLimit, teamAuth, safe((req, res) => withLead(req, res, async (rec) => {
    const subject = clean(req.body?.subject, 200), body = typeof req.body?.body === 'string' ? req.body.body.replace(/\r\n/g, '\n').slice(0, 10000).trim() : '';
    const ids = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 6) : [];
    // certificates with proof, attached from the company's certifications (lib/certificates.js)
    const certIds = Array.isArray(req.body?.certificates) ? [...new Set(req.body.certificates.filter((x) => typeof x === 'string'))].slice(0, 6) : [];
    if (!isEmail(rec.email || '')) return res.status(400).json({ error: 'This enquiry has no valid email address to reply to.' });
    if (!subject) return res.status(400).json({ error: 'Add a subject.' });
    if (body.length < 10) return res.status(400).json({ error: 'Write the reply first.' });
    const files = ids.map((id) => (rec.files || []).find((f) => f.id === id));
    if (files.some((f) => !f)) return res.status(400).json({ error: 'One of the attachments is no longer on this enquiry.' });
    const certs = certIds.map((id) => ({ id, a: certificateFile(id) }));
    if (certs.some((c) => !c.a)) return res.status(400).json({ error: 'One of the certificates can no longer be sent: it has expired or its file was removed. Untick it and send again.' });
    const certSize = certs.reduce((n, c) => { try { return n + fs.statSync(c.a.path).size; } catch { return n; } }, 0);
    const totalSize = files.reduce((n, f) => n + f.size, 0) + certSize;
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
        fromName: `${req.user.name}, ${config.fromName || 'Olira Agro Industry'}`,
        attachments: [
          ...files.map((f) => ({ filename: f.name, path: path.join(filesRoot, rec.id, f.stored), contentType: f.type })),
          ...certs.map((c) => ({ filename: c.a.filename, path: c.a.path, contentType: c.a.contentType })),
        ],
      });
    } catch (err) {
      logError('team_reply_failed', err, { inquiry: rec.id });
      return res.status(502).json({ error: 'The email server did not accept the message. Nothing was sent.', code: 'send_failed' });
    }
    // re-read: the send can take seconds and someone may have changed the lead meanwhile
    let cur = null;
    try { cur = await leads.get(rec.id); } catch (e) {
      logError('lead_store_unavailable', e);
      return res.json({ success: true, inquiry: rec, warning: 'The reply was sent, but it could not be added to the enquiry\'s history.' });
    }
    if (!cur) return res.json({ success: true, inquiry: rec });
    pushActivity(cur, { type: 'reply', by: who(req.user), subject, text: body, to: cur.email, replyTo, attachments: [...files.map((f) => ({ id: f.id, name: f.name })), ...certs.map((c) => ({ certificate: c.id, name: c.a.filename }))] });
    if (['new', 'read'].includes(cur.status)) pushHistory(cur, 'contacted', req.user);
    claim(cur, req.user);
    audit('team_reply_sent', req, { inquiry: cur.id, attachments: files.length, certificates: certs.length });
    return save(res, cur);
  })));

  /* ---------------- files ---------------- */
  const dirOf = (id) => {
    if (!/^inq_[\w]+$/.test(id)) throw new Error('bad id');
    return path.join(filesRoot, id);
  };
  const usedBytes = async () => (await leads.all()).reduce((n, i) => n + (i.files || []).reduce((m, f) => m + (f.size || 0), 0), 0);

  function storeFile(rec, buffer, original, kind, source, user) {
    const ext = sniffFile(buffer);
    if (!ext) return { error: `"${String(original || 'file').slice(0, 60)}" is not a file type we accept. Send PDF, AI, EPS, SVG, PNG, JPG or WebP.` };
    const id = `f_${crypto.randomBytes(8).toString('hex')}`;
    const dir = dirOf(rec.id);
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${id}.${ext}`;
    fs.writeFileSync(path.join(dir, stored), buffer);
    const meta = { id, stored, name: safeDisplayName(original, ext), type: ALLOWED[ext], ext, size: buffer.length, kind: Object.hasOwn(KIND_LABEL, String(kind)) ? kind : 'document', source, at: new Date().toISOString() };
    if (user) meta.by = who(user);
    if (!Array.isArray(rec.files)) rec.files = [];
    rec.files.push(meta);
    return { file: meta };
  }

  // Files sent with a packaging quote request (called from POST /api/inquiry).
  async function saveIntakeFiles(rec, files) {
    const saved = [], rejected = [];
    const total = files.reduce((n, f) => n + f.buffer.length, 0);
    // the store may be down while the request is waiting: count the files as fitting rather than refuse them
    const used = await usedBytes().catch(() => 0);
    if (total > INTAKE_TOTAL_MAX || used + total > FILES_CAP) return { saved, rejected: files.map((f) => f.originalname), full: true };
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
    limits: { fileSize: FILE_MAX, files: 6, fields: 20, fieldSize: 20 * 1024, parts: 30 },
  }).fields([{ name: 'files', maxCount: 3 }, { name: 'logo', maxCount: 1 }, { name: 'artwork', maxCount: 1 }, { name: 'mockup', maxCount: 1 }]);
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
  app.post('/api/team/inquiries/:id/files', teamAuth, (req, res, next) => teamUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 15 MB.' : 'The file could not be read.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file.' });
    return withLead(req, res, async (rec) => {
      if ((rec.files || []).length >= FILES_PER_LEAD) return res.status(400).json({ error: `An enquiry can hold ${FILES_PER_LEAD} files. Remove one first.` });
      let used;
      try { used = await usedBytes(); } catch (e) { return storeDown(res, e); }
      if (used + req.file.size > FILES_CAP) return res.status(507).json({ error: 'File storage is full. Ask a manager to delete old enquiries.' });
      const kind = ['mockup', 'quote', 'artwork', 'document'].includes(req.body?.kind) ? req.body.kind : 'document';
      const r = storeFile(rec, req.file.buffer, req.file.originalname, kind, 'team', req.user);
      if (r.error) return res.status(400).json({ error: r.error });
      pushActivity(rec, { type: 'file', by: who(req.user), text: r.file.name, fileId: r.file.id });
      claim(rec, req.user);
      return save(res, rec);
    }).catch(next);
  }));

  app.get('/api/team/inquiries/:id/files/:fileId', teamAuth, safe((req, res) => withLead(req, res, (rec) => {
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
  })));

  app.delete('/api/team/inquiries/:id/files/:fileId', teamAuth, safe((req, res) => withLead(req, res, (rec) => {
    const f = (rec.files || []).find((x) => x.id === req.params.fileId);
    if (!f) return res.status(404).json({ error: 'File not found.' });
    if (f.source === 'client' && !oversees(req.user)) return res.status(403).json({ error: 'Files the client sent are kept. Only a manager can remove them.' });
    try { fs.rmSync(path.join(dirOf(rec.id), f.stored), { force: true }); } catch (e) { logError('lead_file_remove_failed', e); }
    rec.files = rec.files.filter((x) => x.id !== f.id);
    return save(res, rec);
  })));

  const workspaceUrl = (rec) => `${siteUrl()}/team/${lineOf(rec) === 'pack' ? 'packaging' : 'agriculture'}/#inbox?lead=${encodeURIComponent(rec.id)}`;

  return { saveIntakeFiles, removeLeadFiles, parseIntake, workspaceUrl };
}
