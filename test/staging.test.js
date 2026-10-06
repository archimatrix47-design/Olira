// The staging copy (lib/staging.js): closed to the public and to search engines,
// and it never mails real buyers or staff.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { isStaging, registerStaging, stagingMail } from '../lib/staging.js';

const ENV = { SITE_ENV: 'staging', STAGING_USER: 'olira', STAGING_PASSWORD: 'test-only-staging-pass' };
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

async function serve(env) {
  const app = express();
  const on = registerStaging(app, env);
  app.get('/', (req, res) => res.send('home'));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\n'));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/team/leads', (req, res) => res.json({ auth: req.headers.authorization || '' }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { on, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('only SITE_ENV=staging turns it on', async () => {
  assert.equal(isStaging({}), false);
  assert.equal(isStaging({ SITE_ENV: 'production' }), false);
  assert.equal(isStaging({ SITE_ENV: ' Staging ' }), true);
  const live = await serve({});
  try {
    assert.equal(live.on, false);
    const r = await fetch(`${live.base}/`);
    assert.equal(r.status, 200, 'the live site is open');
    assert.equal(r.headers.get('x-robots-tag'), null, 'and indexable');
    assert.match(await (await fetch(`${live.base}/robots.txt`)).text(), /Allow: \//);
  } finally { live.close(); }
});

test('the staging copy asks for its password, then remembers it with a cookie', async () => {
  const s = await serve(ENV);
  try {
    const anon = await fetch(`${s.base}/`);
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate') || '', /Basic realm="Olira staging"/);
    assert.equal((await fetch(`${s.base}/`, { headers: { Authorization: basic('olira', 'wrong') } })).status, 401);
    assert.equal((await fetch(`${s.base}/`, { headers: { Authorization: basic('someone', ENV.STAGING_PASSWORD) } })).status, 401);
    const ok = await fetch(`${s.base}/`, { headers: { Authorization: basic('olira', ENV.STAGING_PASSWORD) } });
    assert.equal(ok.status, 200);
    const cookie = (ok.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^olira_staging=[a-f0-9]{64}$/);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
    assert.ok(!cookie.includes(ENV.STAGING_PASSWORD), 'the cookie is not the password');
    // a staff request carries its own Bearer token; the cookie lets it through untouched
    const api = await fetch(`${s.base}/api/team/leads`, { headers: { Cookie: cookie, Authorization: 'Bearer staff-token' } });
    assert.equal(api.status, 200);
    assert.deepEqual(await api.json(), { auth: 'Bearer staff-token' });
    assert.equal((await fetch(`${s.base}/`, { headers: { Cookie: 'olira_staging=' + '0'.repeat(64) } })).status, 401, 'a made-up cookie is refused');
  } finally { s.close(); }
});

test('search engines are kept out, the uptime check is not', async () => {
  const s = await serve(ENV);
  try {
    const robots = await fetch(`${s.base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
    assert.equal(robots.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${s.base}/`)).headers.get('x-robots-tag'), 'noindex, nofollow', 'even on the sign-in answer');
    const health = await fetch(`${s.base}/api/health`);
    assert.equal(health.status, 200);
  } finally { s.close(); }
});

test('without a password the copy stays closed', async () => {
  const s = await serve({ SITE_ENV: 'staging' });
  try {
    assert.equal((await fetch(`${s.base}/`, { headers: { Authorization: basic('olira', '') } })).status, 503);
  } finally { s.close(); }
});

test('staging mail goes to the tester only, or nowhere', () => {
  const mail = { from: 'Olira <info@oliraagroindustry.com>', to: 'buyer@example.com', cc: 'x@example.com', bcc: 'sales@example.com', subject: 'Your quote', html: '<p>hi</p>' };
  assert.equal(stagingMail(mail, {}), null, 'no STAGING_MAIL_TO: not sent');
  const out = stagingMail(mail, { STAGING_MAIL_TO: 'tester@example.com' });
  assert.equal(out.to, 'tester@example.com');
  assert.equal(out.subject, '[Staging] Your quote');
  assert.equal(out.bcc, undefined);
  assert.equal(out.cc, undefined);
  assert.equal(out.html, '<p>hi</p>');
});
