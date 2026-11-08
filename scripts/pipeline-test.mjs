// The data pipeline, end to end: what staff enter reaches every place it should,
// in the right form, and nothing it should not (phone numbers, hidden products,
// unescaped text) leaks on the way.
//
//   staff input (admin, packaging team, agriculture team)
//     -> storage (DATA_DIR JSON, UPLOADS_DIR files)
//     -> public API (what the pages' live scripts read)
//     -> the build (pages, structured data, llms.txt, sitemap)
//     -> the served site (security policy for the new build, live facts)
//     -> enquiries back to the teams' inboxes and the manager
//
// Runs on throwaway folders only: a fresh DATA_DIR seeded from data/, its own
// uploads, and a build in a temporary folder (ASTRO_OUT_DIR / DIST_DIR), so the
// site in dist/ and the sandbox are never touched. Mail is off. Takes a minute or
// two because it runs a real build.   npm run test:pipeline
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-pipeline-'));
const DATA = path.join(TMP, 'data'), UPLOADS = path.join(TMP, 'uploads'), DIST = path.join(TMP, 'dist');
fs.mkdirSync(DATA); fs.mkdirSync(UPLOADS);

const ENV = {
  NODE_ENV: 'test', PORT: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM_NAME: '', RECIPIENT_EMAIL: '', CORS_ORIGINS: '', SITE_URL: '',
  DATA_DIR: DATA, UPLOADS_DIR: UPLOADS, DIST_DIR: DIST,
  EMAIL_CONFIG_PATH: path.join(TMP, 'email-config.json'), INTEGRATIONS_CONFIG_PATH: path.join(TMP, 'integrations-config.json'),
  JWT_SECRET: 'pipeline_test_secret_that_is_at_least_32_chars', ADMIN_PASSWORD: 'pipeline_admin_password_123',
  ADMIN_LOGIN_RATE_PER_MIN: '1000', GENERAL_RATE_PER_MIN: '1000', INQUIRY_RATE_PER_MIN: '1000', REVEAL_RATE_PER_MIN: '1000',
};
Object.assign(process.env, ENV);

// the repo's own data folder must come out exactly as it went in
const REPO_DATA = path.join(ROOT, 'data');
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => [f, crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
const repoBefore = snapshot(REPO_DATA);

const { app } = await import('../server.js');
const facts = await import('../lib/catalogue-facts.js');

let server, B;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  // the build in step 9 takes a minute or two: keep the test client's connection open
  // through it (the default 5 s would reset a reused connection, a harness race, not a site fault)
  server.keepAliveTimeout = 10 * 60_000;
  B = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server?.close(); });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
async function req(method, p, { token, body, form, headers = {} } = {}) {
  const r = await fetch(B + p, {
    method,
    headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text, headers: r.headers };
}
const readData = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const sharp = (await import('sharp')).default;
// the pages are checked as a browser builds them (parse5 comes with Astro)
const { parse } = await import('parse5');
/** What a browser would run from this page: elements with on* handlers, scripts that run, and JSON-LD that does not parse. */
function runnable(html) {
  const out = { handlers: [], scripts: [], badJson: 0 };
  const walk = (n) => {
    if (n.attrs) for (const a of n.attrs) if (/^on/i.test(a.name)) out.handlers.push(`<${n.tagName} ${a.name}>`);
    if (n.tagName === 'script') {
      const src = n.attrs.some((a) => a.name === 'src'), type = (n.attrs.find((a) => a.name === 'type')?.value || '').toLowerCase();
      const text = (n.childNodes || []).map((c) => c.value || '').join('');
      if (/json/.test(type)) { try { JSON.parse(text); } catch { out.badJson++; } } else if (!src) out.scripts.push(text);
    }
    for (const c of n.childNodes || []) walk(c);
    if (n.content) walk(n.content);
  };
  walk(parse(html));
  return out;
}
const png = (w, h, bg = '#ffffff') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// what the test enters, and the values that must never be public
const PHONES = ['+251 911 000 111', '+251 922 000 222'];
const PHONE_DIGITS = ['911000111', '922000222'];
// a tag, and a quote that would break out of an attribute if it were not escaped
const XSS_NAME = 'Pipeline Test Box <img src=x onerror=alert(1)> " onmouseover="alert(2)';
const XSS_DESC = 'Pipeline description <script>alert(1)</script>';
const T = {}; // tokens and ids found along the way

/* ------------------------------------------------------------------ */
test('1. boot: a fresh data folder is seeded from the defaults', async () => {
  const h = await req('GET', '/api/health');
  assert.equal(h.status, 200);
  for (const f of ['products.json', 'packaging-products.json', 'certifications.json']) assert.ok(fs.existsSync(path.join(DATA, f)), `${f} seeded`);
});

test('2. staff accounts, and every route only for its own role', async () => {
  T.admin = (await req('POST', '/api/admin/login', { body: { password: ENV.ADMIN_PASSWORD } })).json?.token;
  assert.ok(T.admin, 'admin signs in');
  for (const [key, role, name] of [['pack', 'pack', 'Pipeline Pack'], ['agri', 'agri', 'Pipeline Agri'], ['mgr', 'manager', 'Pipeline Manager']]) {
    const email = `${key}.pipeline@example.com`, password = `${key}-pipeline-pass-1`;
    const m = await req('POST', '/api/admin/team', { token: T.admin, body: { member: { name, email, role, password } } });
    assert.equal(m.status, 200, `${role} account: ${m.text}`);
    T[key] = (await req('POST', '/api/team/login', { body: { email, password } })).json?.token;
    assert.ok(T[key], `${role} signs in`);
  }
  assert.equal((await req('POST', '/api/products', { token: T.pack, body: { product: { name: 'x', description: 'y' } } })).status, 403, 'packaging cannot edit agriculture');
  assert.equal((await req('POST', '/api/team/packaging-products', { token: T.agri, body: { product: { name: 'x', description: 'y' } } })).status, 403, 'agriculture cannot edit packaging');
  assert.equal((await req('POST', '/api/team/packaging-products', { token: T.mgr, body: { product: { name: 'x', description: 'y' } } })).status, 403, 'the manager reads, the team edits');
  assert.ok([401, 403].includes((await req('POST', '/api/contact-details', { token: T.pack, body: { phones: ['1'] } })).status), 'only the admin edits company contacts');
  assert.ok([401, 403].includes((await req('GET', '/api/team/inquiries')).status), 'enquiries need a sign-in');
});

test('3. admin input: contacts, branding, a certificate with its document, analytics', async () => {
  const c = await req('POST', '/api/contact-details', { token: T.admin, body: { phones: PHONES, emails: ['sales.pipeline@example.com'], address: { line1: 'Pipeline Building', city: 'Addis Ababa', country: 'Ethiopia', lat: 'not a number' } } });
  assert.equal(c.status, 200);
  assert.equal(c.json.data.address.lat, undefined, 'a non-numeric coordinate is dropped');
  assert.equal((await req('POST', '/api/branding', { token: T.admin, body: { tagline: 'Pipeline tagline' } })).status, 200);
  // the logo is a picture the admin uploaded: anything else is refused
  for (const bad of ['javascript:alert(1)', 'https://evil.example/logo.png', '/uploads/../../server.js', { src: 'x' }]) {
    const r = await req('POST', '/api/branding', { token: T.admin, body: { logo: bad } });
    assert.equal(r.status, 400, `logo ${JSON.stringify(bad)} refused`);
  }
  const fd = new FormData();
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'iso.pdf');
  const up = await req('POST', '/api/certifications/file', { token: T.admin, form: fd });
  assert.equal(up.status, 200, up.text);
  T.certFile = up.json.path;
  const cert = await req('POST', '/api/certifications', { token: T.admin, body: { certification: { name: 'ISO 22000:2018 Pipeline', issuer: 'Pipeline Cert Body', number: 'PL-1', validFrom: '2025-01-01', validUntil: '2028-01-01', file: T.certFile } } });
  assert.equal(cert.status, 200, cert.text);
  assert.equal((await req('POST', '/api/certifications', { token: T.admin, body: { certification: { name: 'Bad dates', validFrom: '2026-01-01', validUntil: '2025-01-01' } } })).status, 400, 'dates the wrong way round are refused');
  assert.equal((await req('POST', '/api/integrations/analytics', { token: T.admin, body: { measurementId: 'not-an-id' } })).status, 400, 'a malformed analytics ID is refused');
  assert.equal((await req('POST', '/api/integrations/analytics', { token: T.admin, body: { measurementId: 'G-PIPE123456' } })).status, 200);
});

test('4. marketing input: social links, a partner logo', async () => {
  const s = await req('POST', '/api/team/social-links', { token: T.pack, body: { facebook: 'https://facebook.com/olira-pipeline', whatsapp: 'https://wa.me/251911000111', instagram: 'javascript:alert(1)' } });
  assert.equal(s.status, 200);
  assert.ok(!s.json.data.instagram, 'a javascript: link is not kept');
  const fd = new FormData();
  fd.append('logo', new Blob([await png(240, 120, '#336699')], { type: 'image/png' }), 'partner.png');
  const up = await req('POST', '/api/team/partners/logo', { token: T.pack, form: fd });
  assert.equal(up.status, 200, up.text);
  const p = await req('POST', '/api/team/partners', { token: T.pack, body: { partners: [{ name: 'Pipeline Partner', logo: up.json.path, url: 'https://example.com' }] } });
  assert.equal(p.status, 200, p.text);
  T.partnerLogo = up.json.path;
});

test('5. packaging input: a product with photo, sizes, 3D shape; then its prices', async () => {
  const fd = new FormData();
  fd.append('image', new Blob([await png(800, 1000)], { type: 'image/png' }), 'box.png');
  fd.append('variant', 'light');
  const up = await req('POST', '/api/team/packaging-products/image', { token: T.pack, form: fd });
  assert.equal(up.status, 200, up.text);
  assert.match(up.json.path, /^\/uploads\/packaging\/[\w.-]+\.webp$/, 'uploads are stored as WebP');
  T.photo = up.json.path;
  const product = {
    name: XSS_NAME, description: XSS_DESC, family: 'food', handle: 'pipeline-box',
    sizes: [{ label: 'Small', w: '20', d: '20,5', h: 5 }, { label: 'Large', w: 30, d: 30, h: 6 }],
    image: T.photo, width: up.json.width, height: up.json.height, quad: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], safeTop: 0.1,
    specs: ['Kraft board'], shape3d: 'mailer', board3d: 'kraft', site: true, team: true, secretField: 'dropped',
  };
  // a measurement that is not one is refused with the size named, not dropped
  const bad = await req('POST', '/api/team/packaging-products', { token: T.pack, body: { product: { ...product, sizes: [{ label: 'Large', w: 30, d: 30, h: 600 }] } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Large/);
  const r = await req('POST', '/api/team/packaging-products', { token: T.pack, body: { product } });
  assert.equal(r.status, 200, r.text);
  T.boxId = r.json.product.id;
  T.small = r.json.product.sizes.find((s) => s.label === 'Small').id;
  const m = await req('POST', `/api/team/packaging-products/${T.boxId}/minimums`, { token: T.pack, body: { minOrder: '5,000', prices: { [T.small]: '1,250.50' }, leadTimeDays: 12 } });
  assert.equal(m.status, 200, m.text);
  const hidden = await req('POST', '/api/team/packaging-products', { token: T.pack, body: { product: { name: 'Pipeline Hidden Box', description: 'Never on the site', family: 'food', site: false, sizes: [] } } });
  assert.equal(hidden.status, 200);
  T.hiddenId = hidden.json.product.id;
});

test('6. agriculture input: the sesame specification', async () => {
  const list = (await req('GET', '/api/products')).json;
  const sesame = list.find((p) => p.id === 'cleaned-natural-sesame-seeds');
  assert.ok(sesame, 'the seeded sesame product');
  const r = await req('POST', '/api/products', { token: T.agri, body: { product: { ...sesame, spec: { moisture: '6% max', aflatoxin: '4 ppb total max', hsCode: '1207.40', terms: 'FOB Djibouti <b>only</b>', bogus: 'dropped' } } } });
  assert.equal(r.status, 200, r.text);
});

test('7. storage: what was entered is stored clean, in its normal form', () => {
  const box = readData('packaging-products.json').find((p) => p.id === T.boxId);
  assert.equal(box.minOrder, 5000, '"5,000" stored as a number');
  assert.equal(box.sizes.find((s) => s.id === T.small).pricePer1000, 1250.5, '"1,250.50" stored as 1250.5');
  assert.equal(box.sizes.find((s) => s.id === T.small).d, 20.5, 'a decimal comma is read');
  assert.equal(box.sizes.find((s) => s.label === 'Large').h, 6);
  assert.equal(box.leadTimeDays, 12);
  assert.equal(box.shape3d, 'mailer');
  assert.equal(box.secretField, undefined, 'unknown fields are not stored');
  assert.ok(fs.existsSync(path.join(UPLOADS, 'packaging', path.basename(T.photo))), 'the photo file exists');
  const sesame = readData('products.json').find((p) => p.id === 'cleaned-natural-sesame-seeds');
  assert.deepEqual(Object.keys(sesame.spec).sort(), ['aflatoxin', 'hsCode', 'moisture', 'terms'], 'only known specification fields');
  assert.ok(fs.existsSync(path.join(UPLOADS, 'certificates', path.basename(T.certFile))), 'the certificate document exists');
  assert.deepEqual(readData('contact-details.json').phones, PHONES, 'the numbers are kept for the reveal');
});

test('8. public API: the new data, nothing hidden, no phone numbers', async () => {
  const pk = (await req('GET', '/api/packaging-products')).json;
  const box = pk.find((p) => p.id === T.boxId);
  assert.ok(box, 'the new product is public');
  assert.ok(!pk.some((p) => p.id === T.hiddenId), 'a hidden product is not');
  for (const k of ['createdAt', 'updatedAt', 'team', 'site', 'secretField']) assert.ok(!(k in box), `no "${k}" in the public product`);
  assert.equal(box.shape3d, 'mailer');
  assert.equal((await req('GET', '/api/products')).json.find((p) => p.id === 'cleaned-natural-sesame-seeds').spec.aflatoxin, '4 ppb total max');
  assert.ok((await req('GET', '/api/certifications')).json.some((c) => c.file === T.certFile), 'the certificate document is public');
  assert.ok((await req('GET', '/api/partners')).json.some((p) => p.name === 'Pipeline Partner'));
  assert.equal((await req('GET', '/api/social-links')).json.whatsapp, 'set', 'the WhatsApp number stays private');
  for (const p of ['/api/contact-details', '/api/social-links', '/api/packaging-products', '/api/products', '/api/certifications', '/api/partners', '/api/branding', '/api/health']) {
    const body = (await req('GET', p)).text.replace(/\D/g, '');
    for (const d of PHONE_DIGITS) assert.ok(!body.includes(d), `no phone number in ${p}`);
  }
  // the numbers come only from the reveal: a POST, from a browser, from this site
  const rv = await req('POST', '/api/contact/reveal', { headers: { Origin: B } });
  assert.equal(rv.status, 200);
  assert.equal(rv.json.phones[0].display, PHONES[0]);
  assert.equal((await req('POST', '/api/contact/reveal', { headers: { Origin: B, 'User-Agent': 'Googlebot/2.1' } })).status, 403, 'bots are refused');
  assert.equal((await req('POST', '/api/contact/reveal', { headers: { Origin: 'https://evil.example' } })).status, 403, 'other sites are refused');
  assert.notEqual((await req('GET', '/api/contact/reveal')).status, 200, 'never a link a crawler can follow');
});

test('9. build: pages, structured data, llms.txt and sitemap come from the data', { timeout: 600_000 }, () => {
  const astro = path.join(ROOT, 'node_modules', 'astro', 'astro.js');
  const r = spawnSync(process.execPath, [astro, 'build'], { cwd: ROOT, env: { ...process.env, ...ENV, ASTRO_OUT_DIR: DIST }, encoding: 'utf8', timeout: 540_000 });
  assert.equal(r.status, 0, `build failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  const files = fs.readdirSync(DIST, { recursive: true }).filter((f) => fs.statSync(path.join(DIST, f)).isFile() && /\.(html|txt|xml|json)$/.test(f));
  const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
  const all = files.map((f) => [f, read(f)]);
  // privacy and escaping, everywhere
  for (const [f, text] of all) {
    const digits = text.replace(/\D/g, '');
    for (const d of PHONE_DIGITS) assert.ok(!digits.includes(d), `no phone number in ${f}`);
    assert.ok(!text.includes('Pipeline Hidden Box'), `the hidden product is not in ${f}`);
    // markup only matters where a browser renders it: pages (llms.txt is plain text, test 10)
    if (!f.endsWith('.html')) continue;
    const run = runnable(text);
    assert.deepEqual(run.handlers, [], `no element in ${f} gets an event handler from the team's text`);
    assert.ok(!run.scripts.some((js) => /alert\((1|2)\)/.test(js)), `no script in ${f} runs the team's text`);
    assert.equal(run.badJson, 0, `every JSON block in ${f} still parses (none was broken out of)`);
  }
  // the product's own page
  // its own page: the one whose main heading is the product (others list it under "More packaging")
  const page = all.find(([f, t]) => /^packaging[\\/][^\\/]+[\\/]index\.html$/.test(f) && /<h1[^>]*id="pdTitle"[^>]*>Pipeline Test Box/.test(t));
  assert.ok(page, 'the new product has its own page');
  T.boxPath = '/' + page[0].replace(/\\/g, '/').replace(/index\.html$/, '');
  const html = page[1];
  assert.match(html, /ETB 1,250\.50 per 1,000/, 'its price per 1,000');
  assert.match(html, /5,000/, 'its minimum order');
  assert.match(html, /12 working days/, 'its lead time');
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { const j = JSON.parse(m[1]); return j['@graph'] || [j]; });
  const productLd = ld.find((n) => n['@type'] === 'Product');
  assert.equal(productLd.offers?.price, 1250.5, 'structured data carries the price');
  assert.equal(productLd.offers?.priceCurrency, 'ETB');
  // the catalogue, the sitemap, llms.txt
  assert.match(read(path.join('packaging', 'index.html')), /"shape3d":"mailer"/, 'the catalogue data carries the 3D shape');
  assert.ok(read('sitemap.xml').includes(T.boxPath), 'the sitemap lists the page');
  const llms = read('llms.txt') + read('llms-full.txt');
  for (const v of ['Pipeline Test Box', '4 ppb total max', '1207.40']) assert.ok(llms.includes(v), `llms.txt has "${v}"`);
  // agriculture: the specification and the certificate document
  const sesame = read(path.join('agriculture', 'cleaned-natural-sesame-seeds', 'index.html'));
  assert.match(sesame, /Aflatoxin/);
  assert.match(sesame, /1207\.40/);
  assert.ok(!sesame.includes('<b>only</b>'), 'text from the team is never markup');
  assert.ok(read(path.join('agriculture', 'index.html')).includes(T.certFile), 'the certificate links to its document');
  // the home page: the partner logo
  const home = read('index.html');
  assert.ok(home.includes('Pipeline Partner') && home.includes(T.partnerLogo), 'the partner logo is on the home page');
});

test('10. serving the new build: its own script policy without a restart', async () => {
  const r = await req('GET', T.boxPath);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('Pipeline Test Box'), 'the server serves the new build');
  const scriptSrc = (r.headers.get('content-security-policy') || '').match(/script-src ([^;]+)/)?.[1] || '';
  const inline = [...r.text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=|application\/(ld\+)?json/i.test(m[1]));
  assert.ok(inline.length > 0);
  for (const m of inline) assert.ok(scriptSrc.includes(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`), 'each inline script of the new build is allowed');
  // the text files carry the team's words as written, so a browser must never read them as a page
  for (const f of ['/llms.txt', '/llms-full.txt']) {
    const t = await req('GET', f);
    assert.equal(t.status, 200);
    assert.match(t.headers.get('content-type') || '', /^text\/plain/, `${f} is plain text`);
    assert.equal(t.headers.get('x-content-type-options'), 'nosniff', `${f} is never sniffed as HTML`);
  }
});

test('11. live facts: a price changed after the build reaches the page without a rebuild', async () => {
  assert.equal((await req('POST', `/api/team/packaging-products/${T.boxId}/minimums`, { token: T.pack, body: { prices: { [T.small]: '2000' } } })).status, 200);
  const p = (await req('GET', '/api/packaging-products')).json.find((x) => x.id === T.boxId);
  // pd-live.js and the catalogue write exactly these rows into the page
  const rows = Object.fromEntries(facts.specRows(p, 4));
  assert.equal(rows.Price, 'From ETB 2,000 per 1,000', 'the page shows the new price');
  assert.equal(rows['Minimum order'], '5,000');
  assert.equal(rows['Ready in'], '12 working days');
  assert.deepEqual(facts.pendingFacts(p), [], 'no fact is "confirmed with your quote" any more');
});

test('12. enquiries: a visitor request reaches the right team, with its files and design', async () => {
  const before = readData('inquiries.json').length;
  const send = async (fields, files = []) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const [k, buf, name] of files) fd.append(k, new Blob([buf], { type: 'image/png' }), name);
    return req('POST', '/api/inquiry', { form: fd, headers: { Origin: B } });
  };
  const base = { name: 'Pipeline Buyer', email: 'buyer.pipeline@example.com', message: 'Pipeline boxes, please.', product: 'Packaging', line: 'pack' };
  // under the minimum: refused, nothing saved
  const low = await send({ ...base, bundle: JSON.stringify([{ productId: T.boxId, sizeId: T.small, qty: 100 }]) });
  assert.equal(low.status, 400);
  assert.equal(readData('inquiries.json').length, before, 'a refused request leaves nothing behind');
  // the spam trap: accepted quietly, never stored
  await send({ ...base, website: 'http://spam.example' });
  assert.equal(readData('inquiries.json').length, before, 'a filled spam trap is not stored');
  // a real request with a bundle, the studio design and a file
  const ok = await send({ ...base, bundle: JSON.stringify([{ productId: T.boxId, sizeId: T.small, qty: 6000, colours: 2 }]), design: JSON.stringify({ template: T.boxId, templateName: 'Pipeline Test Box', size: T.small, ink: 'teal', text1: 'PIPE', view: '3d', board: 'kraft' }), consent: '1' }, [['files', await png(200, 200), 'artwork.png'], ['mockup', await png(300, 300), 'studio-mockup.png']]);
  assert.ok([200, 500].includes(ok.status), `request: ${ok.status} ${ok.text}`); // 500 = no mail account; the lead is saved first
  const lead = readData('inquiries.json').find((i) => i.name === 'Pipeline Buyer');
  assert.ok(lead, 'the request is stored');
  assert.equal(lead.bundle?.[0]?.qty, 6000);
  assert.match(lead.bundle?.[0]?.name || '', /Pipeline Test Box/);
  assert.equal(lead.design?.view, '3d');
  assert.ok((lead.files || []).length >= 1, 'the attached file is kept');
  T.packLead = lead.id;
  // an export enquiry with trade terms
  const agri = await send({ name: 'Pipeline Importer', email: 'importer.pipeline@example.com', message: 'Sesame for Rotterdam.', product: 'Cleaned Natural Sesame Seeds', volumeMt: '40', port: 'Rotterdam', incoterm: 'CIF' });
  assert.ok([200, 500].includes(agri.status), agri.text);
  // each team sees its own line; the manager sees both
  const names = async (token) => ((await req('GET', '/api/team/inquiries', { token })).json?.inquiries || []).map((i) => i.name);
  assert.ok((await names(T.pack)).includes('Pipeline Buyer') && !(await names(T.pack)).includes('Pipeline Importer'), 'packaging sees its request only');
  assert.ok((await names(T.agri)).includes('Pipeline Importer') && !(await names(T.agri)).includes('Pipeline Buyer'), 'agriculture sees its request only');
  const all = await names(T.mgr);
  assert.ok(all.includes('Pipeline Buyer') && all.includes('Pipeline Importer'), 'the manager sees both');
  // the team works it: accepted, then contacted
  assert.equal((await req('POST', `/api/team/inquiries/${T.packLead}`, { token: T.pack, body: { assign: 'me' } })).status, 200);
  assert.equal((await req('POST', `/api/team/inquiries/${T.packLead}`, { token: T.pack, body: { status: 'contacted' } })).status, 200);
  const worked = readData('inquiries.json').find((i) => i.id === T.packLead);
  assert.equal(worked.status, 'contacted');
  assert.ok(worked.assignee?.name, 'it has an owner');
  assert.equal((await req('POST', `/api/team/inquiries/${T.packLead}`, { token: T.agri, body: { status: 'won' } })).status === 200, false, 'the other team cannot change it');
});

test('13. saving again changes nothing; deleting removes it everywhere', async () => {
  const full = (await req('GET', '/api/packaging-products?scope=all', { token: T.pack })).json;
  const box = full.find((p) => p.id === T.boxId);
  const count = full.length;
  assert.equal((await req('POST', '/api/team/packaging-products', { token: T.pack, body: { product: box } })).status, 200);
  const again = readData('packaging-products.json');
  assert.equal(again.length, count, 'no duplicate');
  assert.equal(again.find((p) => p.id === T.boxId).sizes.find((s) => s.id === T.small).pricePer1000, 2000, 'prices survive a product save');
  assert.equal((await req('DELETE', `/api/team/packaging-products/${T.boxId}`, { token: T.pack })).status, 200);
  assert.ok(!(await req('GET', '/api/packaging-products')).json.some((p) => p.id === T.boxId), 'gone from the public list');
  assert.ok(!fs.existsSync(path.join(UPLOADS, 'packaging', path.basename(T.photo))), 'its photo, used by nothing else, is removed');
});

test('14. a restarted server reads the same data; the repo data folder is untouched', () => {
  const code = `const { app } = await import(${JSON.stringify(new URL('../server.js', import.meta.url).href)});
    const s = app.listen(0, async () => {
      const base = 'http://127.0.0.1:' + s.address().port;
      const pk = await (await fetch(base + '/api/packaging-products', { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
      const ag = await (await fetch(base + '/api/products', { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
      console.log(JSON.stringify({ hasHidden: pk.some((p) => p.name === 'Pipeline Hidden Box'), aflatoxin: ag.find((p) => p.id === 'cleaned-natural-sesame-seeds')?.spec?.aflatoxin }));
      s.close(); process.exit(0);
    });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: { ...process.env, ...ENV }, encoding: 'utf8', timeout: 60_000 });
  const line = (r.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `restart output: ${r.stderr?.slice(-500)}`);
  const seen = JSON.parse(line);
  assert.equal(seen.aflatoxin, '4 ppb total max', 'the specification survives a restart');
  assert.equal(seen.hasHidden, false);
  assert.deepEqual(snapshot(REPO_DATA), repoBefore, 'nothing in the repo data folder changed');
});

test('15. the performance log: an AI reader key reads what just happened, in counts only', async () => {
  const made = await req('POST', '/api/admin/ai-access/keys', { token: T.admin, body: { name: 'Pipeline reader' } });
  assert.equal(made.status, 200);
  assert.equal((await req('GET', '/api/ai/log', { token: made.json.key })).status, 403, 'off until the admin switches it on');
  await req('POST', '/api/admin/ai-access', { token: T.admin, body: { enabled: true } });
  const r = await req('GET', '/api/ai/log?days=7', { token: made.json.key });
  assert.equal(r.status, 200);
  const log = r.json, text = JSON.stringify(log);
  assert.ok(log.enquiries.byLine.packaging >= 1 && log.enquiries.byLine.agriculture >= 1, 'the enquiries of stage 12 are counted');
  assert.equal(log.catalogue.agriculture.products, readData('products.json').length, 'the agriculture catalogue as stored');
  assert.equal(log.catalogue.packaging.products, readData('packaging-products.json').filter((p) => p.site !== false).length, 'the packaging catalogue as stored');
  for (const s of ['Pipeline Buyer', 'Pipeline Importer', 'buyer.pipeline@example.com', 'importer.pipeline@example.com', 'Sesame for Rotterdam', 'Pipeline boxes, please']) assert.ok(!text.includes(s), `${s} must not be in the log`);
});
