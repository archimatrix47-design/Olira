// The boxes and their wiring (boxes/README.md). The code and the saved map must agree:
// every file in one box, every connection declared, every route with its owner, every
// call from a page reaching a route. A new function therefore cannot arrive without its
// own box and wiring. Each check below is also shown failing on a seeded fault, so a
// clean result means something.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of ['NODE_ENV', 'PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) process.env[key] = '';
process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-boxes-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.EMAIL_CONFIG_PATH = path.join(tmp, 'email-config.json');
process.env.INTEGRATIONS_CONFIG_PATH = path.join(tmp, 'integrations-config.json');
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_chars_long';
process.env.ADMIN_PASSWORD = 'test_admin_password_123';

const { app, board } = await import('../server.js');
const { analyse, mapDrift, loadBoxes } = await import('../scripts/boxes.mjs');
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the boxes and the code agree', () => {
  const { problems } = analyse(board.plugged);
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the saved map is the real wiring', () => {
  const { wiring } = analyse(board.plugged);
  assert.deepEqual(mapDrift(wiring), []);
  assert.ok(Object.keys(wiring.boxes).length >= 40, 'the boxes were read');
  assert.ok(wiring.plugOrder.length >= 25, 'the running app reported its wiring');
});

test('every route on the running app belongs to a plugged-in box', () => {
  const onApp = app._router.stack.filter((l) => l.route).length;
  const claimed = new Set(board.plugged.flatMap((p) => p.routes.map((r) => r.split(' ').slice(1).join(' '))));
  assert.ok(onApp > 70, 'the app has its routes');
  for (const l of app._router.stack.filter((x) => x.route)) assert.ok(claimed.has(String(l.route.path)), `no box added ${l.route.path}`);
});

test('the pages and the 404 come last, so no box can be hidden behind them', () => {
  const order = board.plugged.map((p) => p.id);
  assert.equal(order.at(-2), 'static-site');
  assert.equal(order.at(-1), 'startup');
  assert.ok(order.indexOf('web-guards') < order.indexOf('admin-sign-in'), 'the guards stand in front of every route');
  assert.equal(order[0], 'storage');
});

test('server.js only wires: no route or logic of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.equal(/\bapp\.(get|post|put|patch|delete|use)\(/.test(src), false, 'routes and guards belong in a box');
  assert.ok(src.split('\n').length < 160, 'the wiring stays short enough to read');
});

test('server code never depends on src/, which the Docker image does not contain', () => {
  for (const f of ['server.js', ...fs.readdirSync(path.join(ROOT, 'lib')).map((x) => `lib/${x}`)]) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/(from|import)\s+'[^']*\/src\//.test(text), false, `${f} imports from src/`);
  }
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(docker, /COPY lib \.\/lib/, 'the image carries lib/');
});

/* ---------- the checker itself: each kind of fault is caught ---------- */
function withPart(id, change, run) {
  const p = path.join(ROOT, 'boxes/parts', `${id}.json`), before = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, `${JSON.stringify(change(JSON.parse(before)), null, 2)}\n`);
  try { return run(); } finally { fs.writeFileSync(p, before); }
}
const problemsWith = (id, change) => withPart(id, change, () => analyse(board.plugged).problems.join('\n'));

test('a file that belongs to no box is reported', () => {
  assert.match(problemsWith('branding', (b) => ({ ...b, files: b.files.filter((f) => f !== 'lib/branding.js') })), /lib\/branding\.js is not in any box/);
});
test('a file in two boxes, or one that does not exist, is reported', () => {
  assert.match(problemsWith('branding', (b) => ({ ...b, files: [...b.files, 'lib/contact.js'] })), /lib\/contact\.js is in two boxes/);
  assert.match(problemsWith('branding', (b) => ({ ...b, files: [...b.files, 'lib/gone.js'] })), /lib\/gone\.js, which does not exist/);
});
test('a connection nobody declared, and a declared one nothing uses, are reported', () => {
  assert.match(problemsWith('contact', (b) => ({ ...b, uses: b.uses.filter((u) => u !== 'social-links') })), /contact connects to social-links, but does not say so/);
  assert.match(problemsWith('branding', (b) => ({ ...b, uses: [...b.uses, 'targets'] })), /branding says it uses targets, but nothing connects them/);
});
test('a data file touched by the wrong box, or owned twice, is reported', () => {
  assert.match(problemsWith('admin-tools', (b) => ({ ...b, reads: [] })), /admin-tools touches team\.json, which belongs to staff-accounts/);
  assert.match(problemsWith('branding', (b) => ({ ...b, data: [...b.data, 'team.json'] })), /team\.json is owned by two boxes/);
});
test('a box with no proof, or still holding the placeholder test, is reported', () => {
  assert.match(problemsWith('search-verification', (b) => ({ ...b, tests: [] })), /has no test/);
});
test('a route answered by nothing, and wires nobody offers, are reported', () => {
  const plugged = clone(board.plugged);
  plugged.find((p) => p.id === 'targets').routes = [];
  assert.match(analyse(plugged).problems.join('\n'), /src\/scripts\/team\/targets\.js calls \/api\/team\/targets, but no route answers it/);
  const noOwner = clone(board.plugged);
  noOwner.find((p) => p.id === 'branding').receives.push({ name: 'mystery', from: null });
  assert.match(analyse(noOwner).problems.join('\n'), /branding is handed "mystery", which no box offers/);
  const twice = clone(board.plugged);
  twice.find((p) => p.id === 'branding').routes.push('GET /api/products');
  assert.match(analyse(twice).problems.join('\n'), /Two boxes answer GET \/api\/products/);
});
test('a box plugged in without a definition, or defined but not plugged in, is reported', () => {
  const extra = clone(board.plugged); extra.push({ id: 'unknown-box', receives: [], offers: [], routes: [], guards: 0 });
  assert.match(analyse(extra).problems.join('\n'), /plugs in "unknown-box", which has no definition/);
  assert.match(analyse(clone(board.plugged).filter((p) => p.id !== 'partners')).problems.join('\n'), /partners says it is plugged in, but server\.js does not plug it in/);
});
test('a stale map is reported', () => {
  const { wiring } = analyse(board.plugged);
  wiring.boxes.branding.does = 'something else';
  assert.ok(mapDrift(wiring).some((m) => /wiring\.json is out of date/.test(m)));
});

test('the board records what really happened', async () => {
  const { createBoard } = await import('../lib/board.js');
  const routes = [];
  const fake = { _router: { stack: [] }, get(p) { this._router.stack.push({ route: { path: p, methods: { get: true } } }); } };
  const { plug, later, plugged } = createBoard(fake);
  const shared = () => {};
  plug('a', (a) => { a.get('/x'); return { shared, label: 'hello' }; });
  const lateWire = later('z', 'soon', () => {});
  const out = plug('b', () => ({ done: true }), { shared, label: 'hello', soon: lateWire, plain: 5 });
  assert.deepEqual(out, { done: true }, 'a box returns what it returns');
  assert.deepEqual(plugged[0].routes, ['GET /x']);
  assert.deepEqual(plugged[1].receives, [{ name: 'shared', from: 'a', as: 'shared' }, { name: 'label', from: 'a', as: 'label' }, { name: 'soon', from: 'z', as: 'soon', late: true }, { name: 'plain', from: null }]);
  assert.equal(routes.length, 0);
  assert.equal(loadBoxes().find((b) => b.id === 'wiring').kind, 'foundation');
});
