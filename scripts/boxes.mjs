// The boxes and their wiring (boxes/README.md explains them).
//
//   npm run boxes                 work out the real wiring and save the map
//   npm run boxes:check           compare the code with the saved boxes and map
//   npm run box:new -- <id> "what it does"   start a new box, wired in
//
// A box is one function of the site: its definition is boxes/parts/<id>.json. This
// tool reads those, finds what the code really does (who imports whom, which screen
// calls which route, which events pass between them, and, from the running app, which
// box was handed which wire), and reports every difference in plain words. test/boxes.test.js
// runs the same check, so a change that leaves the boxes behind fails the tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOXES = path.join(ROOT, 'boxes');
const PARTS = path.join(BOXES, 'parts');
const KINDS = {
  foundation: 'Foundations',
  admin: 'What the admin looks after',
  catalogue: 'Catalogues',
  sales: 'Enquiries and sales',
  insight: 'How the site is doing',
  public: 'What visitors see',
  staff: 'Staff screens',
  shared: 'Shared parts',
  tools: 'Tools',
};
const posix = (p) => p.split(path.sep).join('/');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const isTest = (f) => f.startsWith('test/') || f.endsWith('-test.mjs');
const isServer = (f) => f === 'server.js' || f.startsWith('lib/');

/* ---------- what the boxes say ---------- */
export function loadBoxes() {
  return fs.readdirSync(PARTS).filter((f) => f.endsWith('.json')).sort().map((f) => ({ _file: f, ...JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8')) }));
}

/* ---------- what the code does ---------- */
function sourceFiles() {
  const out = ['server.js'];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (!/\.cache\.json$/.test(e.name)) out.push(p); // caches are made by the build, not written by hand
    }
  };
  ['lib', 'src', 'scripts', 'test'].forEach(walk);
  return out.sort();
}
const CODE = /\.(js|mjs|ts|astro)$/;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+)\1/g;
function resolveImport(file, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.split('?')[0]));
  for (const c of [base, `${base}.js`, `${base}.ts`, `${base}.mjs`, `${base}.astro`]) if (exists(c) && fs.statSync(path.join(ROOT, c)).isFile()) return c;
  return null;
}
/** A file without its comment lines: an import named in a sentence is not an import. */
const codeOf = (f) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function importsOf(files) {
  const out = new Map();
  // this tool writes import lines into new files, so its own text is not scanned
  for (const f of files.filter((x) => CODE.test(x) && x !== 'scripts/boxes.mjs')) {
    const list = [];
    for (const m of codeOf(f).matchAll(IMPORT)) list.push({ spec: m[2], to: resolveImport(f, m[2]) });
    out.set(f, list);
  }
  return out;
}
/**
 * A page script's calls to the server: "/api/..." at the start of a string. Anything
 * inserted counts as one unknown part. An address built on another host (the local AI
 * model's own /api/chat, say) starts with that host, so it is not one of these.
 */
function apiCallsIn(text) {
  const calls = new Set();
  for (const m of text.matchAll(/[`'"]\/api\/([^`'"\s<>)]*)/g)) {
    const url = `/api/${m[1]}`.replace(/\$\{[^}]*\}?/g, ':x').split('?')[0].replace(/[/.,]+$/, '');
    if (url !== '/api') calls.add(url);
  }
  return [...calls];
}
function routeMatches(routePath, url) {
  if (typeof routePath !== 'string' || !routePath.startsWith('/')) return false;
  const a = routePath.split('/'), b = url.split('/');
  // a call that ends in an inserted part may stand for the rest of the address
  if (b.at(-1).includes(':x') && b.at(-1) !== ':x') { const stem = b.at(-1).replace(':x', ''); if (a.length >= b.length && a.slice(0, b.length - 1).every((s, i) => s === b[i] || s.startsWith(':') || b[i] === ':x') && a[b.length - 1].startsWith(stem)) return true; }
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i] || s.startsWith(':') || b[i] === ':x');
}
function findCycles(imports) {
  const cycles = [], state = new Map(), stack = [];
  const visit = (f) => {
    state.set(f, 1); stack.push(f);
    for (const { to } of imports.get(f) || []) {
      if (!to || !CODE.test(to) || isTest(to)) continue;
      if (state.get(to) === 1) cycles.push([...stack.slice(stack.indexOf(to)), to]);
      else if (!state.has(to)) visit(to);
    }
    stack.pop(); state.set(f, 2);
  };
  for (const f of imports.keys()) if (!state.has(f) && !isTest(f)) visit(f);
  return cycles;
}

/**
 * Compare the boxes with the code. `plugged` is the running app's record of its wiring
 * (lib/board.js). Returns { problems, wiring }: problems are plain sentences, and
 * wiring is the map that `npm run boxes` saves.
 */
export function analyse(plugged) {
  const boxes = loadBoxes();
  const problems = [];
  const say = (m) => problems.push(m);
  const byId = new Map(boxes.map((b) => [b.id, b]));

  /* the definitions themselves */
  for (const b of boxes) {
    if (`${b.id}.json` !== b._file) say(`${b._file}: its id is "${b.id}"; the file must be named after the id.`);
    for (const k of ['name', 'does', 'kind']) if (!b[k]) say(`${b.id}: says nothing for "${k}".`);
    if (!KINDS[b.kind]) say(`${b.id}: "${b.kind}" is not a kind of box (${Object.keys(KINDS).join(', ')}).`);
    for (const k of ['files', 'tests', 'uses', 'data', 'reads']) if (!Array.isArray(b[k])) say(`${b.id}: "${k}" must be a list.`);
    if (!b.tests?.length && !b.checkedBy) say(`${b.id}: has no test. List one under "tests", or say how it is checked under "checkedBy".`);
    for (const u of b.uses || []) if (!byId.has(u)) say(`${b.id}: uses "${u}", which is not a box.`);
    for (const t of b.tests || []) if (exists(t) && /BOX-TODO/.test(read(t))) say(`${b.id}: ${t} is still the placeholder. Write what this box must do.`);
  }

  /* every file is in exactly one box */
  const owner = new Map();
  for (const b of boxes) for (const f of [...(b.files || []), ...(b.tests || [])]) {
    if (!exists(f)) say(`${b.id}: lists ${f}, which does not exist.`);
    if (owner.has(f)) say(`${f} is in two boxes: ${owner.get(f)} and ${b.id}.`);
    else owner.set(f, b.id);
  }
  const files = sourceFiles();
  for (const f of files) if (!owner.has(f)) say(`${f} is not in any box. Add it to the box it belongs to, in boxes/parts/, or start a new one with: npm run box:new -- <id> "what it does"`);

  /* imports */
  const imports = importsOf(files);
  const boxImports = new Map(boxes.map((b) => [b.id, new Set()]));
  for (const [f, list] of imports) {
    for (const { spec, to } of list) {
      if (!to) { if (!/\.(png|jpg|webp|svg|json)$/.test(spec) || !isTest(f)) say(`${f} imports ${spec}, which does not exist.`); continue; }
      if (isServer(f) && to.startsWith('src/')) say(`${f} imports ${to}. Server code must not depend on src/: the Docker image does not contain it. Put shared rules in lib/.`);
      if (isTest(f) || f === 'server.js') continue;
      const [a, c] = [owner.get(f), owner.get(to)];
      if (a && c && a !== c) boxImports.get(a).add(c);
    }
  }
  for (const c of findCycles(imports)) say(`These files import each other in a circle: ${c.join(' -> ')}`);

  /* the wires of the running app */
  const plugs = new Map(plugged.map((p) => [p.id, p]));
  for (const p of plugged) if (!byId.has(p.id)) say(`server.js plugs in "${p.id}", which has no definition in boxes/parts/.`);
  for (const b of boxes) if (b.plugged && !plugs.has(b.id)) say(`${b.id} says it is plugged in, but server.js does not plug it in.`);
  for (const p of plugged) if (byId.has(p.id) && !byId.get(p.id).plugged) say(`${p.id} is plugged in by server.js: add "plugged": true to its definition.`);
  const boxWires = new Map(boxes.map((b) => [b.id, new Set()]));
  for (const p of plugged) {
    for (const r of p.receives) {
      if (r.from === null) { if (!(byId.get(p.id)?.settings || []).includes(r.name)) say(`${p.id} is handed "${r.name}", which no box offers. Offer it from a box, or list it under "settings" if it is a plain value.`); }
      else if (r.from !== p.id) boxWires.get(p.id)?.add(r.from);
    }
  }

  /* every route has its box, and every call from a page reaches a route */
  const routes = [];
  for (const p of plugged) for (const r of p.routes) { const [method, ...rest] = r.split(' '); routes.push({ box: p.id, method, path: rest.join(' ') }); }
  const seen = new Set();
  for (const r of routes) { const k = `${r.method} ${r.path}`; if (seen.has(k)) say(`Two boxes answer ${k}.`); seen.add(k); }
  const boxCalls = new Map(boxes.map((b) => [b.id, new Map()]));
  for (const f of files.filter((x) => x.startsWith('src/') && CODE.test(x))) {
    for (const url of apiCallsIn(codeOf(f))) {
      const hit = routes.filter((r) => routeMatches(r.path, url));
      if (!hit.length) { say(`${f} calls ${url}, but no route answers it: a wire connected to nothing.`); continue; }
      const a = owner.get(f);
      for (const r of hit) if (a && r.box !== a) { const m = boxCalls.get(a); (m.get(r.box) || m.set(r.box, new Set()).get(r.box)).add(url); }
    }
  }

  /* events passed between page scripts */
  const sends = new Map(), hears = new Map();
  const note = (map, ev, id) => (map.get(ev) || map.set(ev, new Set()).get(ev)).add(id);
  for (const f of files.filter((x) => x.startsWith('src/') && CODE.test(x))) {
    const t = read(f), id = owner.get(f);
    for (const m of t.matchAll(/new CustomEvent\('([a-z]+:[a-z_-]+)'/g)) note(sends, m[1], id);
    for (const m of t.matchAll(/addEventListener\('([a-z]+:[a-z_-]+)'/g)) note(hears, m[1], id);
  }
  for (const [ev, who] of hears) if (!sends.has(ev)) say(`${[...who].join(', ')} listens for the event ${ev}, which nothing sends.`);
  const boxEvents = new Map(boxes.map((b) => [b.id, new Set()]));
  for (const [ev, who] of hears) for (const id of who) for (const s of sends.get(ev) || []) if (s !== id) boxEvents.get(id)?.add(s);

  /* data files have one owner */
  const dataOwner = new Map();
  for (const b of boxes) for (const d of b.data || []) { if (dataOwner.has(d)) say(`The data file ${d} is owned by two boxes: ${dataOwner.get(d)} and ${b.id}.`); dataOwner.set(d, b.id); }
  for (const f of files.filter((x) => x.startsWith('lib/') && x.endsWith('.js'))) {
    const b = byId.get(owner.get(f));
    for (const m of read(f).matchAll(/'([a-z-]+\.(?:json|jsonl|log|txt))'/g)) {
      const d = m[1];
      if (d === 'package.json') continue;
      if (!dataOwner.has(d)) say(`${f} uses the data file ${d}, which no box owns. Add it under "data" in the box that looks after it.`);
      else if (b && dataOwner.get(d) !== b.id && !(b.reads || []).includes(d)) say(`${b.id} touches ${d}, which belongs to ${dataOwner.get(d)}. Ask that box through a wire, or list it under "reads".`);
    }
  }

  /* what each box says it connects to, against what it really connects to */
  const wiringBoxes = {};
  for (const b of boxes) {
    const actual = new Set([...boxImports.get(b.id), ...boxWires.get(b.id), ...boxCalls.get(b.id).keys(), ...boxEvents.get(b.id)]);
    for (const a of actual) if (!(b.uses || []).includes(a)) say(`${b.id} connects to ${a}, but does not say so. Add "${a}" to "uses" in boxes/parts/${b.id}.json, or remove the connection.`);
    for (const u of b.uses || []) if (!actual.has(u)) say(`${b.id} says it uses ${u}, but nothing connects them. Remove "${u}" from "uses" in boxes/parts/${b.id}.json.`);
    const p = plugs.get(b.id);
    wiringBoxes[b.id] = {
      name: b.name, does: b.does, kind: b.kind,
      files: b.files, tests: b.tests, data: b.data, reads: b.reads,
      uses: [...(b.uses || [])].sort(),
      usedBy: boxes.filter((o) => (o.uses || []).includes(b.id)).map((o) => o.id),
      plugOrder: p ? plugged.indexOf(p) + 1 : null,
      receives: p?.receives || [],
      offers: p?.offers || [],
      routes: p?.routes || [],
      guards: p?.guards || 0,
      imports: [...boxImports.get(b.id)].sort(),
      calls: Object.fromEntries([...boxCalls.get(b.id)].sort().map(([k, v]) => [k, [...v].sort()])),
      sends: [...sends].filter(([, w]) => w.has(b.id)).map(([e]) => e).sort(),
      hears: [...hears].filter(([, w]) => w.has(b.id)).map(([e]) => e).sort(),
      ...(b.checkedBy ? { checkedBy: b.checkedBy } : {}),
    };
  }
  return { problems, wiring: { about: 'Generated by npm run boxes from boxes/parts/ and the running app. Do not edit by hand.', kinds: KINDS, plugOrder: plugged.map((p) => p.id), boxes: wiringBoxes } };
}

/* ---------- the saved map ---------- */
const mermaidId = (id) => id.replace(/-/g, '_');
function mapMarkdown(w) {
  const ids = Object.keys(w.boxes);
  const lines = ['# The boxes and their wiring', '', 'Generated by `npm run boxes`. Edit `boxes/parts/`, not this file. For a map you can click, open `boxes/map.html`.', ''];
  lines.push('## How the server boxes are wired', '', 'Each arrow means "is given something by". The order is the order `server.js` plugs them in.', '', '```mermaid', 'flowchart LR');
  for (const id of w.plugOrder) lines.push(`  ${mermaidId(id)}["${w.boxes[id].name}"]`);
  const edges = new Set();
  for (const id of w.plugOrder) for (const r of w.boxes[id].receives) if (r.from && r.from !== id) edges.add(`  ${mermaidId(id)} ${r.late ? '-.->' : '-->'} ${mermaidId(r.from)}`);
  lines.push(...[...edges].sort(), '```', '');
  for (const [kind, title] of Object.entries(w.kinds)) {
    const list = ids.filter((id) => w.boxes[id].kind === kind);
    if (!list.length) continue;
    lines.push(`## ${title}`, '', '| Box | What it does | Connects to | Routes | Files |', '| --- | --- | --- | --- | --- |');
    for (const id of list) { const b = w.boxes[id]; lines.push(`| **${id}** | ${b.does} | ${b.uses.join(', ') || 'nothing'} | ${b.routes.length} | ${b.files.length} |`); }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
function mapHtml(w) {
  const data = JSON.stringify(w).replace(/</g, '\\u003c');
  return fs.readFileSync(path.join(ROOT, 'scripts/boxes-map.template.html'), 'utf8').replace('/*__WIRING__*/null', () => data);
}
const stable = (w) => `${JSON.stringify(w, null, 1)}\n`;
function save(w) {
  fs.writeFileSync(path.join(BOXES, 'wiring.json'), stable(w));
  fs.writeFileSync(path.join(BOXES, 'MAP.md'), mapMarkdown(w));
  fs.writeFileSync(path.join(BOXES, 'map.html'), mapHtml(w));
}
/** The saved map against the real one: an empty list means they agree. */
export function mapDrift(w) {
  const out = [];
  const same = (f, want) => { const p = path.join(BOXES, f); if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== want.replace(/\r\n/g, '\n')) out.push(`boxes/${f} is out of date. Run: npm run boxes`); };
  same('wiring.json', stable(w)); same('MAP.md', mapMarkdown(w)); same('map.html', mapHtml(w));
  return out;
}

/* ---------- running it ---------- */
async function runningWiring() {
  for (const key of ['PORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME', 'RECIPIENT_EMAIL', 'CORS_ORIGINS', 'SITE_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) process.env[key] = '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-boxes-'));
  Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: tmp, UPLOADS_DIR: path.join(tmp, 'uploads'), EMAIL_CONFIG_PATH: path.join(tmp, 'email-config.json'), INTEGRATIONS_CONFIG_PATH: path.join(tmp, 'integrations-config.json'), JWT_SECRET: 'boxes_tool_only_0123456789abcdef0123', ADMIN_PASSWORD: 'boxes_tool_only_password' });
  const log = console.log; console.log = () => {}; // the app's start-up notes are not the tool's output
  const { board } = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
  console.log = log;
  return board.plugged;
}
function report(problems) {
  for (const p of problems) console.log(`  - ${p}`);
  console.log(problems.length ? `\n${problems.length} thing${problems.length === 1 ? '' : 's'} to put right.` : 'The boxes and the code agree.');
}

/** npm run box:new -- <id> "what it does": a definition, a module, a test, and the line in server.js. */
function newBox(id, does) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id || '')) { console.log('Give the box a short name in lowercase with hyphens: npm run box:new -- price-list "what it does"'); return 1; }
  if (!does) { console.log('Say in a sentence what the box does: npm run box:new -- price-list "Publishes the price list"'); return 1; }
  const part = path.join(PARTS, `${id}.json`), lib = path.join(ROOT, 'lib', `${id}.js`), testFile = path.join(ROOT, 'test', `${id}.test.js`);
  for (const f of [part, lib, testFile]) if (fs.existsSync(f)) { console.log(`${posix(path.relative(ROOT, f))} already exists.`); return 1; }
  const Pascal = id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
  fs.writeFileSync(part, `${JSON.stringify({ id, name: Pascal.replace(/([a-z])([A-Z])/g, '$1 $2'), does, kind: 'shared', plugged: true, files: [`lib/${id}.js`], tests: [`test/${id}.test.js`], uses: [], data: [], reads: [] }, null, 2)}\n`);
  fs.writeFileSync(lib, `// BOX ${id}: ${does}\n// Given what it needs by server.js (see boxes/README.md). Returns what other boxes may use.\n\nexport function register${Pascal}(app, wires) {\n  return {};\n}\n`);
  fs.writeFileSync(testFile, `// BOX-TODO: say what this box must do. The boxes check fails until this line is gone.\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { register${Pascal} } from '../lib/${id}.js';\n\ntest('${id}: what it must do', () => {\n  assert.equal(typeof register${Pascal}, 'function');\n});\n`);
  let s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const importLine = "import { registerStartup } from './lib/startup.js';", marker = '/* ---------- last: the pages, the 404 and the error handler ---------- */';
  if (s.split(importLine).length !== 2 || s.split(marker).length !== 2) { console.log('server.js no longer has the lines this tool expects: add the import and the plug() line by hand.'); return 1; }
  s = s.replace(importLine, `${importLine}${nl}import { register${Pascal} } from './lib/${id}.js';`).replace(marker, `plug('${id}', register${Pascal}, {});${nl}${nl}${marker}`);
  fs.writeFileSync(path.join(ROOT, 'server.js'), s);
  console.log(`Started the box "${id}":\n  boxes/parts/${id}.json   what it is and what it connects to\n  lib/${id}.js             its code\n  test/${id}.test.js       what it must do\n  server.js                plugged in, before the pages\n\nNext: write the code, hand it the wires it needs in server.js, list its connections under "uses", write the test, then run: npm run boxes`);
  return 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'new') process.exit(newBox(rest[0], rest.slice(1).join(' ')));
  const { problems, wiring } = analyse(await runningWiring());
  if (cmd === '--check') {
    const all = [...problems, ...mapDrift(wiring)];
    report(all);
    process.exit(all.length ? 1 : 0);
  }
  save(wiring);
  report(problems);
  console.log(`Saved boxes/wiring.json, boxes/MAP.md and boxes/map.html (${Object.keys(wiring.boxes).length} boxes).`);
  process.exit(problems.length ? 1 : 0);
}
