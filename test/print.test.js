import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('printing before scrolling: everything the scroll reveals hide is shown on paper', () => {
  const rise = motion.match(/const RISE = '([^']+)'/)?.[1];
  assert.ok(rise, 'motion.js still names its reveals in RISE');
  const heads = motion.match(/gsap\.utils\.toArray\('(\.band \.headline, \.sec-title h2)'\)/)?.[1];
  assert.ok(heads, 'motion.js still reveals the section headlines');
  const shown = selectorsWith(printBlock(), 'opacity: 1 !important');
  for (const sel of [...rise.split(','), ...heads.split(','), '[data-rise]', '.door'].map((s) => s.trim())) {
    assert.ok(shown.includes(sel), `${sel} is shown in print (sheet.css), over GSAP's inline opacity`);
  }
  assert.match(selectorsWith(printBlock(), 'transform: none !important'), /\.specsheet/, 'and moved back into place');
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
