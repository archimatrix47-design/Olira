import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const motion = read('src/scripts/motion.js');
const css = read('src/styles/sheet.css');
const layout = read('src/layouts/SiteLayout.astro');

// the body of the stylesheet's main @media print block (the one that resets the reveals)
function printBlock() {
  const at = css.indexOf('@media print {\n  @page');
  assert.ok(at >= 0, 'sheet.css has the print block');
  let depth = 0, i = css.indexOf('{', at);
  for (let j = i; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(i + 1, j);
  }
  return '';
}
// the selectors of the rule in `block` whose declarations include `decl`
function selectorsWith(block, decl) {
  const out = [];
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[2].replace(/\s+/g, ' ').includes(decl)) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out.join(', ');
}

// every public page's own files: scripts (not the staff tools), pages, components, layouts
function publicFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!/^src\/(scripts\/(admin|team)|pages\/(admin|team))$/.test(rel)) walk(rel); }
      else if (/\.(js|ts|astro)$/.test(e.name)) out.push(rel);
    }
  };
  ['src/scripts', 'src/pages', 'src/components/site', 'src/layouts'].forEach(walk);
  return out;
}
// what makes content wait for a scroll: a scroll-triggered library or a reveal marker
const WAITS = [/ScrollTrigger/, /from ['"]gsap/, /\bdata-rise\b/, /\bdata-reveal\b/];

test('the matchers that find scroll-gated content work', () => {
  assert.ok(WAITS.some((r) => r.test("import { ScrollTrigger } from 'gsap/ScrollTrigger';")));
  assert.ok(WAITS.some((r) => r.test('<div class="contact" data-rise>')));
  assert.equal(WAITS.some((r) => r.test('<div class="contact">')), false);
});

test('printing before scrolling: nothing on the public pages waits for a scroll to be seen', () => {
  const files = publicFiles();
  assert.ok(files.length > 30 && files.includes('src/pages/packaging.astro') && files.includes('src/scripts/motion.js'), `scanned ${files.length} files`);
  for (const f of files) for (const r of WAITS) assert.equal(r.test(read(f)), false, `${f} matches ${r}`);
  assert.equal(/"gsap"/.test(read('package.json')), false, 'no animation library is installed');
  assert.doesNotMatch(motion, /opacity: 0[^}]*\}\s*\)\s*;?\s*$/m, 'motion.js does not leave anything hidden');
  // the CSS entrances: only with motion allowed, ending on the page's own layout, and off on paper
  const allowed = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference) {\n  .door'));
  assert.match(allowed, /^@media \(prefers-reduced-motion: no-preference\) \{\n {2}\.door \{ animation: enter-rise/);
  assert.equal(css.split('enter-rise').length - 1, 4, 'the keyframes and the three entrances that use them, nowhere else');
  const from = css.match(/@keyframes enter-rise \{ from \{ opacity: ([\d.]+); translate: 0 18px; \} \}/);
  assert.ok(from, 'a "from" only: it ends where the page lays it out');
  assert.ok(Number(from[1]) >= 0.5, `it starts visible (opacity ${from[1]}): text at 0 is not counted as painted, which delays the largest paint`);
  assert.match(selectorsWith(printBlock(), 'animation: none !important'), /\*/, 'on paper nothing is mid-entrance');
});

test('on paper: no header buttons, chat button, quote bar or theme switch; black ink', () => {
  const hidden = selectorsWith(printBlock(), 'display: none !important');
  for (const sel of ['.head-end', '#themeBtn', '.fab', '.quote-bar']) assert.ok(hidden.includes(sel), `${sel} is hidden in print`);
  assert.match(selectorsWith(printBlock(), 'color: #000 !important'), /\*/, 'dark mode prints dark text on white paper');
  assert.match(selectorsWith(printBlock(), 'transition: none !important'), /\*/, 'at once: a colour transition (footer links) must not print half-way');
});

test('the printed page says where it came from', () => {
  assert.match(layout, /<p class="print-url">Printed from \{url\}/);
  assert.match(css, /\.print-url \{ display: none; \}/, 'not on screen');
  assert.match(selectorsWith(printBlock(), 'display: block'), /\.print-url/, 'on paper');
});
