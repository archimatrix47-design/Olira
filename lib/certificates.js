// Certifications with proof. A certification listed on the website is only as
// good as the document behind it, so each one carries the certificate itself
// (a PDF or a scan), who issued it, its number, its validity and, where the
// issuer has one, a public register link to check it.
//
// The status decides what everyone sees:
//   valid      proof uploaded, not expired: shown with "View certificate"
//   expiring   proof uploaded, expires within 60 days: shown; staff are warned
//   expired    past its "valid until" date: hidden from the website; staff are warned
//   no-proof   no document uploaded: shown as "Copy on request"; staff are warned
//
// Routes
//   GET    /api/certifications           public: every record with its status
//   POST   /api/certifications           admin: add or edit one { certification }
//   POST   /api/certifications/file      admin: upload a certificate (PDF, JPG, PNG, WebP)
//   DELETE /api/certifications/:id       admin: remove one, and its file
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';

export const EXPIRY_WARNING_DAYS = 60;
const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^\/uploads\/certificates\/[a-z0-9-]+\.(pdf|webp)$/;
const MAX_FILE = 10 * 1024 * 1024;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'certificate';
const validDate = (s) => DATE_RE.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Where a certification stands today. */
export function certStatus(c, now = Date.now()) {
  if (c.validUntil && validDate(c.validUntil) && Date.parse(`${c.validUntil}T23:59:59Z`) < now) return 'expired';
  if (!c.file) return 'no-proof';
  if (c.validUntil && validDate(c.validUntil) && Date.parse(`${c.validUntil}T23:59:59Z`) - now <= EXPIRY_WARNING_DAYS * DAY) return 'expiring';
  return 'valid';
}
export const daysLeft = (c, now = Date.now()) => (c.validUntil && validDate(c.validUntil) ? Math.ceil((Date.parse(`${c.validUntil}T23:59:59Z`) - now) / DAY) : null);
export const withStatus = (c, now = Date.now()) => ({ ...c, status: certStatus(c, now), daysLeft: daysLeft(c, now) });

/** Validate a record sent from the admin panel. Returns { cert } or { error }. */
export function cleanCertification(b, existingId) {
  if (!b || typeof b !== 'object') return { error: 'Send the certification.' };
  const name = clean(b.name, 120);
  if (!name) return { error: 'Give the certification its name, for example "ISO 22000:2018".' };
  const validFrom = clean(b.validFrom, 10), validUntil = clean(b.validUntil, 10);
  if (validFrom && !validDate(validFrom)) return { error: 'The "valid from" date is not a date.' };
  if (validUntil && !validDate(validUntil)) return { error: 'The "valid until" date is not a date.' };
  if (validFrom && validUntil && validUntil < validFrom) return { error: '"Valid until" is before "valid from".' };
  const verifyUrl = clean(b.verifyUrl, 300);
  if (verifyUrl && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(verifyUrl)) return { error: 'The register link must be a full address starting with https://' };
  const file = b.file == null || b.file === '' ? null : clean(b.file, 200);
  if (file && !FILE_RE.test(file)) return { error: 'Upload the certificate again.' };
  return {
    cert: {
      id: existingId || clean(b.id, 80) || slug(name),
      name,
      description: clean(b.description, 300),
      issuer: clean(b.issuer, 120),
      number: clean(b.number, 80),
      scope: clean(b.scope, 300),
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      verifyUrl: verifyUrl || null,
      file,
      fileType: file ? (file.endsWith('.pdf') ? 'pdf' : 'image') : null,
    },
  };
}

/** The file is a PDF or an image only if its bytes say so; the name and type are not trusted. */
export function sniffCertificate(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  return null;
}

/* ---------------- reminders by email ----------------
   The site's inbox and every manager hear 60, 30 and 7 days before a certificate
   expires, and on the day it comes off the website. Each stage goes once per
   expiry date: a renewed certificate (a new "valid until") starts again. When a
   certificate is added late, only the most urgent stage is sent, not every one
   it has already passed. */
export const REMINDER_STAGES = [
  { key: 'd60', days: 60 },
  { key: 'd30', days: 30 },
  { key: 'd7', days: 7 },
  { key: 'expired', days: 0 },
];
const stageRank = (key) => REMINDER_STAGES.findIndex((s) => s.key === key);

/** The stage a certificate has reached today, or null when nothing is due. */
export function reminderStage(c, now = Date.now()) {
  if (!c?.validUntil || !validDate(c.validUntil)) return null;
  if (certStatus(c, now) === 'expired') return 'expired';
  const left = daysLeft(c, now);
  const due = REMINDER_STAGES.filter((s) => s.days > 0 && left <= s.days);
  return due.length ? due[due.length - 1].key : null;
}

/** Reminders to send now, given what was sent before: [{ cert, stage }]. */
export function dueReminders(certs, sent = {}, now = Date.now()) {
  const out = [];
  for (const c of certs) {
    const stage = reminderStage(c, now);
    if (!stage) continue;
    const before = sent[c.id];
    const already = before && before.validUntil === c.validUntil ? stageRank(before.stage) : -1;
    if (stageRank(stage) > already) out.push({ cert: c, stage });
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The email for one reminder: { subject, html, text }. */
export function reminderEmail(c, stage, now, adminUrl) {
  const left = daysLeft(c, now);
  const subject = stage === 'expired'
    ? `${c.name} has expired and is off the website`
    : `${c.name} expires in ${left} day${left === 1 ? '' : 's'}`;
  const lead = stage === 'expired'
    ? `The ${c.name} certificate expired on ${longDate(c.validUntil)}. The website no longer shows it to buyers.`
    : `The ${c.name} certificate expires on ${longDate(c.validUntil)}, in ${left} day${left === 1 ? '' : 's'}. On that day the website stops showing it to buyers.`;
  const next = 'When the renewed certificate arrives, upload it with its new dates in Admin, Certifications. If it is not being renewed, remove it there.';
  const facts = [['Issuer', c.issuer], ['Number', c.number], ['Valid until', longDate(c.validUntil)]].filter(([, v]) => v);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px">
  <p>${esc(lead)}</p>
  ${facts.length ? `<table style="border-collapse:collapse;margin:0 0 14px">${facts.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#666">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join('')}</table>` : ''}
  <p>${esc(next)}</p>
  <p><a href="${esc(adminUrl)}" style="color:#186078;font-weight:bold">Open Admin, Certifications</a></p>
  <p style="color:#888;font-size:12px">Sent once by the Olira website. Reminders go 60, 30 and 7 days before a certificate expires, and on the day it expires.</p>
</div>`;
  const text = `${lead}\n\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${next}\n${adminUrl}\n`;
  return { subject, html, text };
}

/**
 * The reminder check: reads the certifications and what was sent, emails what
 * is due and records it. A failed send is not recorded, so the next check tries
 * again. Returns { sent: [...], skipped } for logs and tests.
 */
export function createReminderCheck({ dataDir, readJsonFile, writeJsonFile, send, recipients, siteUrl, logError = () => {} }) {
  const storePath = path.join(dataDir, 'certifications.json');
  const sentPath = path.join(dataDir, 'certificate-reminders.json');
  let running = false;
  return async function checkReminders(now = Date.now()) {
    if (running) return { sent: [], skipped: 'running' };
    running = true;
    try {
      const certs = readJsonFile(storePath, []);
      const list = Array.isArray(certs) ? certs : [];
      const sent = readJsonFile(sentPath, {}) || {};
      // forget certificates that were removed
      for (const id of Object.keys(sent)) if (!list.some((c) => c.id === id)) delete sent[id];
      const due = dueReminders(list, sent, now);
      const to = [...new Set((recipients() || []).map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))];
      if (!due.length || !to.length) {
        writeJsonFile(sentPath, sent);
        return { sent: [], skipped: due.length ? 'no recipients' : null };
      }
      const done = [];
      for (const { cert, stage } of due) {
        const mail = reminderEmail(cert, stage, now, `${siteUrl()}/admin/#certifications`);
        try {
          await send(to.join(', '), mail.subject, mail.html, { text: mail.text });
          sent[cert.id] = { validUntil: cert.validUntil, stage, at: new Date(now).toISOString() };
          done.push({ id: cert.id, stage });
        } catch (e) {
          logError('certificate_reminder_failed', e, { id: cert.id, stage });
        }
      }
      writeJsonFile(sentPath, sent);
      return { sent: done, skipped: null };
    } finally {
      running = false;
    }
  };
}

export function registerCertificates(app, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, logError, adminAuth, sendEmail, reminderRecipients, siteUrl }) {
  const storePath = path.join(dataDir, 'certifications.json');
  const filesDir = path.join(uploadsDir, 'certificates');
  if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
  const read = () => { const l = readJsonFile(storePath, []); return Array.isArray(l) ? l : []; };
  const removeFileIfUnused = (file, list) => {
    if (!file || !FILE_RE.test(file) || list.some((c) => c.file === file)) return;
    try { fs.rmSync(path.join(filesDir, path.basename(file)), { force: true }); } catch (e) { logError('certificate_file_remove_failed', e); }
  };

  app.get('/api/certifications', (req, res) => {
    const now = Date.now();
    res.set('Cache-Control', 'no-store');
    res.json(read().map((c) => withStatus(c, now)));
  });

  app.post('/api/certifications', adminAuth, (req, res) => {
    const body = req.body?.certification;
    const list = read();
    const existing = body?.id ? list.find((c) => c.id === body.id) : null;
    if (body?.id && !existing) return res.status(404).json({ error: 'Certification not found.' });
    const r = cleanCertification(body, existing?.id);
    if (r.error) return res.status(400).json({ error: r.error });
    if (!existing && list.some((c) => c.id === r.cert.id)) r.cert.id = `${r.cert.id}-${crypto.randomBytes(2).toString('hex')}`;
    // keep a badge image from an older record
    const saved = { ...r.cert, image: existing?.image || null, updatedAt: new Date().toISOString() };
    const next = existing ? list.map((c) => (c.id === existing.id ? saved : c)) : [...list, saved];
    if (r.cert.file && !fs.existsSync(path.join(filesDir, path.basename(r.cert.file)))) return res.status(400).json({ error: 'Upload the certificate again.' });
    if (!writeJsonFile(storePath, next)) return res.status(500).json({ error: 'The certification could not be saved.' });
    if (existing?.file && existing.file !== saved.file) removeFileIfUnused(existing.file, next);
    audit('certification_saved', req, { id: saved.id, proof: !!saved.file });
    res.json({ success: true, certification: withStatus(saved) });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1, fields: 4 } }).single('file');
  app.post('/api/certifications/file', adminAuth, (req, res) => upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The certificate can be up to 10 MB.' : 'The file could not be read.' });
    if (!req.file) return res.status(400).json({ error: 'Choose the certificate file.' });
    const kind = sniffCertificate(req.file.buffer);
    if (!kind) return res.status(400).json({ error: 'Upload the certificate as a PDF, or a scan as JPG, PNG or WebP.' });
    const base = `${slug(clean(req.body?.name, 60))}-${Date.now()}`;
    try {
      let file;
      if (kind === 'pdf') {
        file = `${base}.pdf`;
        fs.writeFileSync(path.join(filesDir, file), req.file.buffer);
      } else {
        // re-encoded, so nothing but the picture survives (no scripts, no metadata)
        file = `${base}.webp`;
        await sharp(req.file.buffer, { failOn: 'error' }).rotate().resize({ width: 2000, height: 2800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(filesDir, file));
      }
      audit('certificate_uploaded', req, { file, kind });
      res.json({ success: true, path: `/uploads/certificates/${file}`, fileType: kind });
    } catch (e) {
      logError('certificate_upload_failed', e);
      res.status(400).json({ error: 'The file could not be read. Try a PDF, or a JPG or PNG scan.' });
    }
  }));

  app.delete('/api/certifications/:id', adminAuth, (req, res) => {
    const list = read(), c = list.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Certification not found.' });
    const next = list.filter((x) => x.id !== c.id);
    if (!writeJsonFile(storePath, next)) return res.status(500).json({ error: 'The certification could not be deleted.' });
    removeFileIfUnused(c.file, next);
    audit('certification_deleted', req, { id: c.id });
    res.json({ success: true });
  });

  const checkReminders = sendEmail && reminderRecipients
    ? createReminderCheck({ dataDir, readJsonFile, writeJsonFile, send: sendEmail, recipients: reminderRecipients, siteUrl, logError })
    : null;
  /** Check at start-up (after a minute) and every six hours; called only when the server is serving. */
  const startReminders = () => {
    if (!checkReminders) return;
    const self = { ip: 'server', headers: { 'user-agent': 'certificate reminders' } }; // the audit log expects a request
    const run = () => checkReminders().then((r) => { if (r.sent.length) audit('certificate_reminders_sent', self, { sent: r.sent }); }).catch((e) => logError('certificate_reminders_failed', e));
    setTimeout(run, 60 * 1000).unref();
    setInterval(run, 6 * 3600 * 1000).unref();
  };

  return { list: () => read().map((c) => withStatus(c)), checkReminders, startReminders };
}
