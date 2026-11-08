// Every event the pages send must be one the server records: an event missing
// from the server's list is dropped without a sound, and the manager's numbers
// silently undercount (studio_artwork was, until 2026-11-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|astro)$/.test(f.name)) files.push(p); } };
walk(path.join(ROOT, 'src'));
const server = fs.readFileSync(path.join(ROOT, 'lib/analytics.js'), 'utf8');
const allowed = new Set([...(server.match(/const TRACK_EVENTS = new Set\(\[([^\]]+)\]\)/)?.[1] || '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
// handled on their own in the /api/track route
for (const special of ['product', 'leave', 'vitals']) if (new RegExp(`body\.event === '${special}'`).test(server)) allowed.add(special);

test('the scan sees the pages and the server list', () => {
  assert.ok(files.length > 40, 'the page scripts are scanned');
  assert.ok(allowed.size > 10, 'the server list is read');
  // the matchers themselves: one sent event is found, one unknown is not allowed
  assert.ok(sent().has('bundle_add'));
  assert.ok(!allowed.has('not_an_event'));
});

function sent() {
  const names = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/track\(\{\s*event:\s*'([a-z_]+)'/g)) names.add(m[1]);
    // oliraTrack(kind === 'phone' ? 'reveal_phone' : ...): the names, not the compared values
    for (const m of src.matchAll(/oliraTrack\?\.\(([^)]*)\)/g)) for (const n of m[1].replace(/===\s*'[^']*'/g, '').matchAll(/'([a-z_]+)'/g)) names.add(n[1]);
  }
  return names;
}

test('every event a page sends is recorded by the server', () => {
  const missing = [...sent()].filter((e) => !allowed.has(e));
  assert.deepEqual(missing, [], `sent by the pages but dropped by the server: ${missing.join(', ')}`);
});
