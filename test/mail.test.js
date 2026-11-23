// Mail end to end through nodemailer: a few lines of SMTP on this machine receive
// what the website sends, so a nodemailer upgrade is checked on real messages: the
// admin's test email, an enquiry's notification (team on blind copy) and the
// buyer's confirmation, and a team reply with an attached file and a reply-to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

// keys set to '' count as present, so the real mail account in .env never leaks in
for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-mail-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';
process.env.ADMIN_LOGIN_RATE_PER_MIN = '1000';
process.env.GENERAL_RATE_PER_MIN = '1000';
process.env.TEAM_REPLY_RATE_PER_MIN = '1000';
const { app } = await import('../server.js');

/** An SMTP server that accepts everything and keeps each message: { from, to[], data, login }. */
function smtp() {
  const mails = [];
  const srv = net.createServer((sock) => {
    let buf = '', mail = null, inData = false, login = '', step = null;
    const say = (l) => sock.write(`${l}\r\n`);
    say('220 localhost ESMTP test');
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          mails.push({ ...mail, data: buf.slice(0, end).replace(/\r\n\.\./g, '\r\n.'), login });
          buf = buf.slice(end + 5); inData = false; mail = null; say('250 OK queued');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (step === 'user') { login = Buffer.from(line, 'base64').toString(); step = 'pass'; say('334 UGFzc3dvcmQ6'); continue; }
        if (step === 'pass') { login += `\0${Buffer.from(line, 'base64').toString()}`; step = null; say('235 Authentication successful'); continue; }
        const [cmd, ...rest] = line.split(' ');
        switch (cmd.toUpperCase()) {
          case 'EHLO': sock.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n'); break;
          case 'HELO': say('250 localhost'); break;
          case 'AUTH':
            if (/^PLAIN$/i.test(rest[0]) && rest[1]) { login = Buffer.from(rest[1], 'base64').toString().replace(/^\0/, ''); say('235 Authentication successful'); }
            else if (/^LOGIN$/i.test(rest[0])) { step = 'user'; say('334 VXNlcm5hbWU6'); }
            else say('504 Unrecognized authentication type');
            break;
          case 'MAIL': mail = { from: line.match(/<([^>]*)>/)?.[1], to: [] }; say('250 OK'); break;
          case 'RCPT': mail.to.push(line.match(/<([^>]*)>/)?.[1]); say('250 OK'); break;
          case 'DATA': inData = true; say('354 End data with <CR><LF>.<CR><LF>'); break;
          case 'RSET': mail = null; say('250 OK'); break;
          case 'NOOP': say('250 OK'); break;
          case 'QUIT': say('221 Bye'); sock.end(); break;
          default: say('502 Command not implemented');
        }
      }
    });
    sock.on('error', () => {});
  });
  return { mails, srv };
}

const mailbox = smtp();
let server, base, smtpPort;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await new Promise((r) => mailbox.srv.listen(0, '127.0.0.1', r));
  smtpPort = mailbox.srv.address().port;
});
test.after(() => { server?.close(); mailbox.srv.close(); });

const UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const req = (method, p, { token, body, form } = {}) => fetch(base + p, {
  method,
  headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: form || (body !== undefined ? JSON.stringify(body) : undefined),
});
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const admin = async () => (await (await req('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } })).json()).token;
async function member(token, { name, email, role }) {
  const r = await req('POST', '/api/admin/team', { token, body: { member: { name, email, role, password: 'member-password-123' } } });
  assert.equal(r.status, 200);
  const l = await json(await req('POST', '/api/team/login', { body: { email, password: 'member-password-123' } }));
  return { ...(await json(r)).member, token: l.token };
}
const header = (data, name) => data.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ').split('\r\n').find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();
const since = (n) => mailbox.mails.slice(n);

test('the admin\'s test email reaches the inbox, signed in with the saved account', async () => {
  const token = await admin();
  const saved = await req('POST', '/api/email-config', { token, body: { smtpHost: '127.0.0.1', smtpPort: String(smtpPort), smtpUser: 'site@example.com', smtpPassword: 'smtp-test-password', recipientEmail: 'inbox@example.com', fromName: 'Olira Test' } });
  assert.equal(saved.status, 200);
  const n = mailbox.mails.length;
  const r = await req('POST', '/api/admin/email-test', { token });
  assert.equal(r.status, 200, JSON.stringify(await json(r.clone())));
  const [m] = since(n);
  assert.ok(m, 'a message arrived');
  assert.equal(m.login, 'site@example.com\0smtp-test-password', 'signed in as the saved account');
  assert.equal(m.from, 'site@example.com');
  assert.deepEqual(m.to, ['inbox@example.com']);
  assert.match(header(m.data, 'From'), /^"?Olira Test"? <site@example\.com>$/, 'the name the admin chose, the account\'s address');
  assert.equal(header(m.data, 'Subject'), 'Test email from the Olira website');
  assert.match(header(m.data, 'Content-Type'), /^multipart\/alternative/, 'plain text and HTML');
  assert.match(m.data, /enquiries will reach inbox@example\.com/);
});

test('an enquiry: the inbox is told, the line\'s team on blind copy, and the buyer gets a confirmation', async () => {
  const token = await admin();
  await member(token, { name: 'Hana Agri', email: 'hana.agri@example.com', role: 'agri' });
  const n = mailbox.mails.length;
  const r = await req('POST', '/api/inquiry', { body: { name: 'Test Buyer', email: 'buyer@example.com', company: 'Buyer Co', message: 'We would like a price for 50 MT of Humera sesame, please.', product: 'Humera sesame' } });
  assert.equal(r.status, 200, JSON.stringify(await json(r.clone())));
  const [note, thanks] = since(n);
  assert.deepEqual(note.to.sort(), ['hana.agri@example.com', 'inbox@example.com'], 'the team member is a recipient');
  assert.equal(header(note.data, 'To'), 'inbox@example.com');
  assert.equal(header(note.data, 'Bcc'), undefined, 'a blind copy stays blind');
  assert.equal(header(note.data, 'Subject'), 'New Product Inquiry: Humera sesame');
  assert.deepEqual(thanks.to, ['buyer@example.com']);
  assert.equal(header(thanks.data, 'Subject'), 'Thank You - Olira Agro Industry Inquiry');
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8')).find((i) => i.email === 'buyer@example.com');
  assert.equal(rec.emailed, true, 'the enquiry records that the notification went out');
});

test('the thank-you goes to an address once a day, and greets only a name that looks like one', async () => {
  // the form must not become a way to send our mail, with someone's text in it, to anyone
  const n = mailbox.mails.length;
  const send = (name) => req('POST', '/api/inquiry', { body: { name, email: 'target@example.com', message: 'A price for sesame, please.', product: 'Humera sesame' } });
  assert.equal((await send('Win cash at http://spam.example')).status, 200);
  assert.equal((await send('Abebe Sample')).status, 200);
  const thanks = since(n).filter((m) => m.to.includes('target@example.com'));
  assert.equal(thanks.length, 1, 'one thank-you a day for the same address');
  assert.match(thanks[0].data, /Hello,/);
  assert.doesNotMatch(thanks[0].data, /spam\.example/, 'the visitor\'s text is not mailed out');
});

test('a team reply carries the attached file, a reply-to and the sender\'s name', async () => {
  const token = await admin();
  const pack = await member(token, { name: 'Dawit Pack', email: 'dawit.pack@example.com', role: 'pack' });
  const logo = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#186078' } }).png().toBuffer();
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: 'Bag Buyer', email: 'bags@example.com', message: 'Quote for 20000 medium bags please.', product: 'Kraft paper bags', consent: '1' })) fd.append(k, v);
  fd.append('files', new Blob([logo], { type: 'image/png' }), 'artwork.png');
  assert.equal((await req('POST', '/api/inquiry', { form: fd })).status, 200);
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'inquiries.json'), 'utf8')).find((i) => i.email === 'bags@example.com');
  const n = mailbox.mails.length;
  const r = await req('POST', `/api/team/inquiries/${rec.id}/reply`, { token: pack.token, body: { subject: 'Your bag quote', body: 'Dear buyer, our artwork proof is attached.', attachments: [rec.files[0].id] } });
  assert.equal(r.status, 200, JSON.stringify(await json(r.clone())));
  const [m] = since(n);
  assert.deepEqual(m.to.sort(), ['bags@example.com', 'dawit.pack@example.com'], 'the buyer, and a copy to the sender');
  assert.equal(header(m.data, 'From'), '"Dawit Pack, Olira Test" <site@example.com>');
  assert.equal(header(m.data, 'Reply-To'), 'dawit.pack@example.com');
  assert.equal(header(m.data, 'Subject'), 'Your bag quote');
  assert.match(header(m.data, 'Content-Type'), /^multipart\/mixed/);
  const part = m.data.split(/\r\n--/).find((p) => /Content-Disposition: attachment/i.test(p));
  assert.ok(part, 'an attachment part');
  assert.match(part, /filename="?artwork\.png"?/);
  const body = part.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, '');
  assert.deepEqual(Buffer.from(body, 'base64'), logo, 'the file arrives byte for byte');
});
