import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The top menu (fresh-eyes review FR-R4): the same three links in the same order
// on every public page, Contact to the footer every page has, and each page's own
// sections after them.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const header = read('src/components/site/SiteHeader.astro');

test('the header builds the same three links for every page', () => {
  assert.match(header, /const PRIMARY: Link\[\] = \[\{ href: '\/agriculture\/', label: 'Agriculture' \}, \{ href: '\/packaging\/', label: 'Packaging' \}, \{ href: '#reach-us', label: 'Contact' \}\];/);
  assert.match(header, /const groups = section\.length \? \[PRIMARY, section\] : \[PRIMARY\];/, 'the page\'s sections come after them');
  assert.match(read('src/components/site/SiteFooter.astro'), /<div class="foot-col" id="reach-us">\n {8}<h2>Reach us<\/h2>/, 'Contact lands on the footer\'s Reach us');
});

test('no page brings its own main links any more', () => {
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const f = `${dir}/${e.name}`; if (e.isDirectory()) walk(f); else if (f.endsWith('.astro')) files.push(f); } };
  walk('src/pages'); walk('src/components/site');
  const users = files.filter((f) => /<SiteHeader\b/.test(read(f)));
  assert.ok(users.length >= 5 && users.includes('src/pages/index.astro') && users.includes('src/components/site/ProductPage.astro'), `${users.length} pages use the header`);
  for (const f of users) assert.doesNotMatch(read(f), /<SiteHeader[^>]*\bgroups=/, `${f} passes its own main links`);
  // the matcher itself
  assert.match('<SiteHeader groups={[[x]]} />', /<SiteHeader[^>]*\bgroups=/);
});
