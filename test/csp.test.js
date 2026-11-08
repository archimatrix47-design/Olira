// The content security policy: inline scripts are allowed only by the hash of
// their text (lib/csp.js), never by 'unsafe-inline', and nothing may use eval.
// Every inline script the built pages carry must be on the list, or a browser
// would refuse to run it (the theme switch, the phone menu, the analytics loader).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-csp-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';

const { inlineScriptHashes, builtScriptHashes, scriptSources, PERMISSIONS_POLICY } = await import('../lib/csp.js');
const { app } = await import('../server.js');
let server, base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server?.close(); });

const sha = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

test('inline scripts are hashed; data blocks and external scripts are not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-csp-pages-'));
  fs.mkdirSync(path.join(dir, 'a'));
  const run = "(function(){document.documentElement.dataset.x='1'})();";
  fs.writeFileSync(path.join(dir, 'a', 'index.html'), `<html><script>${run}</script><script type="application/ld+json">{"@type":"Thing"}</script><script type="module" src="/x.js"></script><script>${run}</script></html>`);
  fs.writeFileSync(path.join(dir, 'notes.txt'), `<script>alert(1)</script>`);
  assert.deepEqual(inlineScriptHashes(dir), [sha(run)], 'one script, counted once; the JSON-LD and the external file need no hash');
  assert.deepEqual(inlineScriptHashes(path.join(dir, 'missing')), []);
});

test('a new build is read again without a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-csp-build-'));
  const page = (code) => fs.writeFileSync(path.join(dir, 'index.html'), `<html><script>${code}</script></html>`);
  page('var a = 1;');
  const now = builtScriptHashes(dir);
  assert.equal(now(), sha('var a = 1;'));
  page('var b = 2;');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'index.html'), later, later);
  assert.equal(now(), sha('var b = 2;'), 'the replaced page is hashed, the old script is no longer allowed');
  assert.equal(builtScriptHashes(path.join(dir, 'missing'))(), "'self'", 'no build: nothing extra allowed');
});

test('the script rule never falls back to unsafe-inline or eval', () => {
  const src = scriptSources([sha('x')]);
  assert.ok(src.includes("'self'"));
  assert.ok(src.includes(sha('x')));
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'fonts.googleapis.com']) assert.ok(!src.includes(bad), bad);
});

test('the served policy allows every inline script of the built site, and only those', async (t) => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return t.skip('no built site (npm run build)');
  const r = await fetch(`${base}/`);
  const csp = r.headers.get('content-security-policy') || '';
  const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert.ok(scriptSrc, csp);
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  // read the pages the way a browser would see them, independently of lib/csp.js
  const seen = new Set();
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) { const html = fs.readFileSync(p, 'utf8'); for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=/.test(m[1]) && !/application\/(ld\+)?json/i.test(m[1])) seen.add(sha(m[2])); } } };
  walk(DIST);
  assert.ok(seen.size >= 3, 'the built pages have their inline scripts (theme, menu, analytics loader)');
  for (const h of seen) assert.ok(scriptSrc.includes(h), `inline script ${h} is allowed`);
  assert.equal(r.headers.get('permissions-policy'), PERMISSIONS_POLICY);
});
