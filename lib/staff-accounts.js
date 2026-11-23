// BOX staff-accounts: who may sign in to the workspaces. The team members, their
// passwords and sign-in, and the roleAuth and teamAuth guards the other boxes stand
// behind. A team token carries the member's id and a password version, and every
// request re-reads the member, so switching an account off ends its sessions at once.
import path from 'path';
import crypto from 'crypto';
import { clientIp, clean, oneLine, isEmail } from './site-basics.js';

export const ROLES = { agri: 'Agriculture team', pack: 'Packaging team', manager: 'Manager' };

/* ---------------- passwords ---------------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64, SCRYPT).toString('hex');
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = hashPw('not-a-real-password', DUMMY_SALT);

export function registerStaffAccounts(app, { dataDir, readJsonFile, writeJsonFile, audit, logError, verifyTokenDetailed, generateToken, checkOrigin, makeRateLimiter, isLoginDisabled, sendEmail, loadEmailConfig }) {
  const teamPath = path.join(dataDir, 'team.json');

  /* ---------------- members ---------------- */
  const readTeam = () => {
    const t = readJsonFile(teamPath, { members: [] });
    return t && Array.isArray(t.members) ? t : { members: [] };
  };
  const publicMember = (m) => ({
    id: m.id, name: m.name, email: m.email, role: m.role, roleLabel: ROLES[m.role], active: m.active !== false,
    createdAt: m.createdAt, updatedAt: m.updatedAt, lastLoginAt: m.lastLoginAt || null,
  });

  // login throttling: per address, per account from one address, and a much looser limit per
  // account from everywhere. Per account alone let anyone who knew a staff email (it is the
  // Reply-To on every reply) keep that person locked out (white-hat, 23 Nov 2026).
  const ipFails = new Map(), accountFails = new Map(), emailFails = new Map();
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
    for (const m of [ipFails, accountFails, emailFails]) for (const [k, v] of m) if (v.until < now && now - v.first > 3600000) m.delete(k);
  }, 10 * 60 * 1000).unref();

  const loginLimit = makeRateLimiter(Number(process.env.ADMIN_LOGIN_RATE_PER_MIN) || 10, 'team-login');
  app.post('/api/team/login', loginLimit, (req, res) => {
    if (isLoginDisabled()) return res.status(503).json({ error: 'Sign in is temporarily unavailable. Contact the site administrator.' });
    if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const ip = clientIp(req);
    const email = clean(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const pair = `${email}|${ip}`;
    const wait = Math.max(locked(ipFails, ip), locked(accountFails, pair), locked(emailFails, email));
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
      if (email) { fail(accountFails, pair, 6, 30 * 60000, 15 * 60000); fail(emailFails, email, 40, 30 * 60000, 15 * 60000); }
      audit('team_login_failed', req, { email, reason: ok ? 'inactive' : 'credentials' });
      // the same answer for a switched-off account, so a guessed password is never confirmed
      return res.status(401).json({ error: 'That email and password do not match. If it should work, ask the site administrator whether the account is switched on.' });
    }
    ipFails.delete(ip); accountFails.delete(pair);
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
    if (r.user.role === 'admin') {
      audit('team_auth_rejected', req, { path: req.path, reason: 'admin' });
      return res.status(403).json({ error: 'The administrator runs the website. Enquiries are worked by the teams and the manager: sign in with one of those accounts.', code: 'admin' });
    }
    req.user = r.user;
    next();
  };
  // the owner's routes: team accounts
  const ownerAuth = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const r = resolveUser(req);
    if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
    if (r.user.role !== 'admin') return res.status(403).json({ error: 'Only the site administrator can do this.' });
    req.user = r.user;
    next();
  };
  /** Middleware for routes open to some roles only, e.g. roleAuth(['manager'], 'message'). */
  const roleAuth = (roles, message) => (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const r = resolveUser(req);
    if (!r.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(r.user.role)) return res.status(403).json({ error: message || 'This account cannot do that.' });
    req.user = r.user; req.teamUser = r.user;
    next();
  };
  app.get('/api/team/me', teamAuth, (req, res) => {
    const members = readTeam().members.filter((m) => m.active !== false).map((m) => ({ id: m.id, name: m.name, role: m.role }));
    res.json({ user: { ...req.user, roleLabel: ROLES[req.user.role] }, members });
  });

  app.post('/api/team/password', loginLimit, teamAuth, (req, res) => {
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
  app.get('/api/admin/team', ownerAuth, (req, res) => {
    res.json({ members: readTeam().members.map(publicMember), roles: ROLES });
  });

  // Managers hear when the admin adds a manager or sets someone's password, and the person
  // whose password was set hears too: a stolen admin session cannot quietly make itself a
  // manager or take over an account (white-hat, 23 Nov 2026). Sending never holds up the save,
  // and nothing is sent while email delivery is not set up.
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function tellOfChange(kind, member, req) {
    if (!sendEmail || !loadEmailConfig?.()?.smtpHost) return;
    const managers = readTeam().members.filter((x) => x.role === 'manager' && x.active !== false && x.id !== member.id).map((x) => x.email);
    const who = `${escHtml(member.name)} (${escHtml(member.email)})`, when = escHtml(new Date().toUTCString());
    const check = '<p>If nobody expected this, tell the company owner and look at Staff accounts in the admin.</p>';
    const sends = [];
    if (kind === 'manager') {
      for (const to of managers) sends.push(sendEmail(to, 'A manager account was added to the Olira website', `<p>The site administrator gave ${who} a manager account on ${when}. A manager sees every enquiry of both lines.</p>${check}`));
    } else if (kind === 'password') {
      sends.push(sendEmail(member.email, 'Your Olira staff password was changed', `<p>The site administrator set a new password for your staff account on ${when}. You are signed out everywhere until you sign in with it.</p><p>If you did not ask for this, tell your manager or the company owner.</p>`));
      for (const to of managers) sends.push(sendEmail(to, 'A staff password was set on the Olira website', `<p>The site administrator set a new password for ${who} on ${when}.</p>${check}`));
    }
    const results = await Promise.allSettled(sends);
    const failed = results.filter((x) => x.status === 'rejected');
    if (failed.length) logError?.('staff_change_notice_failed', failed[0].reason, { kind, count: failed.length });
    audit('staff_change_notice', req, { kind, member: member.id, sent: results.length - failed.length });
  }

  app.post('/api/admin/team', ownerAuth, (req, res) => {
    const b = req.body?.member || {};
    const name = oneLine(b.name, 80), email = clean(b.email, 200).toLowerCase();
    const role = b.role, password = typeof b.password === 'string' ? b.password : '';
    if (!name) return res.status(400).json({ error: 'Give the team member a name.' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter the team member\'s work email address. Buyers\' replies go to it.' });
    if (!Object.hasOwn(ROLES, String(role))) return res.status(400).json({ error: 'Choose the Agriculture team, the Packaging team or Manager.' });
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
    const created = m.createdAt === now, wasManager = m.role === 'manager';
    const revoke = (m.role && m.role !== role) || (m.active !== false && b.active === false) || !!password;
    Object.assign(m, { name, email, role, active: b.active !== false, updatedAt: now });
    if (password) { m.salt = crypto.randomBytes(16).toString('hex'); m.hash = hashPw(password, m.salt); }
    if (revoke && m.hash && m.createdAt !== now) m.pv = (m.pv || 1) + 1;
    if (!writeJsonFile(teamPath, team)) return res.status(500).json({ error: 'The team member could not be saved.' });
    audit('team_member_saved', req, { member: m.id, role, active: m.active });
    if (role === 'manager' && !wasManager) tellOfChange('manager', m, req).catch(() => {});
    if (password && !created) tellOfChange('password', m, req).catch(() => {});
    res.json({ success: true, member: publicMember(m) });
  });

  app.delete('/api/admin/team/:id', ownerAuth, (req, res) => {
    const team = readTeam();
    const next = team.members.filter((m) => m.id !== req.params.id);
    if (next.length === team.members.length) return res.status(404).json({ error: 'Team member not found.' });
    if (!writeJsonFile(teamPath, { ...team, members: next })) return res.status(500).json({ error: 'The team member could not be removed.' });
    audit('team_member_deleted', req, { member: req.params.id });
    res.json({ success: true });
  });

  // the team of the enquiry's line, and the managers, who oversee both lines
  function teamEmailsFor(line) {
    return readTeam().members.filter((m) => m.active !== false && (m.role === line || m.role === 'manager')).map((m) => m.email);
  }
  const managerEmails = () => readTeam().members.filter((m) => m.active !== false && m.role === 'manager').map((m) => m.email);

  return { readTeam, resolveUser, teamAuth, roleAuth, teamEmailsFor, managerEmails };
}
