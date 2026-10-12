import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The public pages' header, footer, contact button and two accessibility fixes
// (fresh-eyes review FR-R5..R8, C1, A3, A4).
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const header = read('src/components/site/SiteHeader.astro');
const footer = read('src/components/site/SiteFooter.astro');
const css = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ''); // without comments
const sheet = css('src/styles/sheet.css');
const site = css('src/styles/site.css');

// the declarations of every rule whose selector list includes `sel` (inside any @media)
function rulesFor(css, sel) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some((s) => s.trim() === sel)) out.push(m[2].replace(/\s+/g, ' ').trim());
  return out.join(' ');
}
// the body of the first @media block whose text starts with `@media <start>`
function media(css, start) {
  const at = css.indexOf(`@media ${start}`);
  assert.ok(at >= 0, `@media ${start}`);
  let depth = 0;
  for (let j = css.indexOf('{', at); j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, j);
  }
  return '';
}

/* ---------- FR-R5: the packing list only where it belongs ---------- */
function runCounter(stored) {
  const script = header.match(/\{!own && \(\s*<script is:inline>([\s\S]*?)<\/script>/)[1];
  const count = { textContent: '0', attrs: { 'data-zero': '' }, removeAttribute(k) { delete this.attrs[k]; } };
  const link = { hidden: true, label: '', querySelector: () => count, setAttribute(k, v) { if (k === 'aria-label') this.label = v; } };
  const sandbox = { document: { querySelector: (s) => (s === '[data-pl-link]' ? link : null) }, localStorage: { getItem: () => stored } };
  vm.runInNewContext(script, sandbox);
  return { link, count };
}

test('away from packaging, the packing list stays out of the header until it holds something', () => {
  assert.match(header, /data-pl-link aria-label="Packing list" hidden=\{!packagingPage\}/, 'rendered hidden outside /packaging/');
  assert.match(header, /const packagingPage = Astro\.url\.pathname\.startsWith\('\/packaging\/'\)/);
  const empty = runCounter('[]');
  assert.equal(empty.link.hidden, true, 'an empty list is not shown');
  const two = runCounter(JSON.stringify([{ productId: 'a' }, { productId: 'b' }]));
  assert.equal(two.link.hidden, false, 'a list with products is shown on any page');
  assert.equal(two.count.textContent, '2');
  assert.equal(two.link.label, 'Packing list, 2 products');
});

test('on phones the packing list is a bag and its count, named for screen readers', () => {
  assert.match(header, /<Fragment set:html=\{BAG_ICON\} \/><span class="tab-word">/);
  assert.match(read('src/pages/packaging.astro'), /id="plOpen"[^>]*aria-label="Packing list"><Fragment set:html=\{BAG_ICON\} \/>/);
  const phone = media(sheet, '(max-width: 760px) { .sheet-head .tab-btn .tab-word');
  assert.match(phone, /\.sheet-head \.tab-btn \.tab-ico \{ display: block; \}/);
  assert.match(rulesFor(sheet, '.tab-btn .tab-ico'), /display: none/, 'wider screens keep the word');
});

/* ---------- FR-R6: the contact button never floats over the quote bar or the form ---------- */
function runBar() {
  const attrs = new Set();
  const observers = [];
  const el = (name) => ({ name });
  const form = el('form'), foot = el('foot'), after = el('hero');
  const bar = { dataset: { after: '.hero', until: '#quote' }, inert: true, shown: false, toggleAttribute(k, on) { if (k === 'data-shown') this.shown = on; } };
  const sandbox = {
    document: {
      querySelector: (s) => (s === '[data-quote-bar]' ? bar : s === '.hero' ? after : null),
      querySelectorAll: (s) => (s === '#quote, .sheet-foot' ? [form, foot] : s === '.sheet-foot' ? [foot] : []),
      documentElement: { toggleAttribute: (k, on) => (on ? attrs.add(k) : attrs.delete(k)) },
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe(t) { (this.targets ||= []).push(t); } },
  };
  vm.runInNewContext(read('src/scripts/quote-bar.js'), sandbox);
  const [heroIO, untilIO] = observers;
  return {
    attrs, bar,
    scrollPastHero: () => heroIO.cb([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]),
    see: (t, on) => untilIO.cb([{ target: t === 'form' ? form : foot, isIntersecting: on }]),
  };
}

test('while the quote bar shows, the contact button sits in it, not above it', () => {
  const s = runBar();
  s.scrollPastHero();
  assert.equal(s.bar.shown, true);
  assert.ok(s.attrs.has('data-quote-bar-shown'));
  const docked = rulesFor(sheet, 'html[data-quote-bar-shown] .fab');
  assert.match(docked, /bottom: calc\(10px \+ env\(safe-area-inset-bottom\)\)/, 'level with the bar\'s button, not stacked above the bar');
  assert.match(rulesFor(sheet, 'html[data-quote-bar-shown] .quote-bar'), /padding-right: calc\(max\(16px, env\(safe-area-inset-right\)\) \+ 48px \+ 10px\)/, 'the bar keeps room for it');
  assert.match(rulesFor(sheet, 'html[data-quote-bar-shown] .fab-main'), /width: 48px; height: 48px/);
});

test('while the form or the footer is on screen, the contact button steps aside', () => {
  const s = runBar();
  s.scrollPastHero();
  s.see('form', true);
  assert.equal(s.bar.shown, false, 'the bar hides at the form');
  assert.ok(s.attrs.has('data-contact-shown'));
  s.see('form', false);
  assert.ok(!s.attrs.has('data-contact-shown'));
  s.see('foot', true);
  assert.ok(s.attrs.has('data-contact-shown'), 'the footer lists the same ways to reach Olira');
  assert.match(rulesFor(sheet, 'html[data-contact-shown]:not([data-quote-bar-shown]) .fab:not(.is-open)'), /visibility: hidden/);
});

/* ---------- FR-R7: the theme switch lives in the phone menu ---------- */
test('on phones the theme switch is in the menu; both switches share one state', () => {
  const nav = header.slice(header.indexOf('<div class="head-nav" id="headNav">'), header.indexOf('<div class="head-end">'));
  assert.match(nav, /<button class="menu-theme" type="button" data-theme-btn aria-pressed="false">/, 'inside the menu');
  const phone = media(sheet, '(max-width: 760px) {\n  html:has(.sheet-head.has-menu)');
  assert.match(phone, /\.sheet-head\.has-menu #themeBtn \{ display: none; \}/, 'out of the header row');
  assert.match(phone, /\.sheet-head\.has-menu\.menu-open \.menu-theme \{ display: flex;[^}]*min-height: 48px/);
  assert.match(read('src/scripts/common.js'), /\$\$\('#themeBtn, \[data-theme-btn\]'\)/);
});

/* ---------- FR-R8: no staff sign-in links on the public pages ---------- */
test('the public footer does not list the team or admin sign in', () => {
  assert.doesNotMatch(footer, /href="\/(team|admin)\/"/);
});

/* ---------- FR-C1: the home title fits a search result ---------- */
test('the home page title is under 60 characters', () => {
  const title = read('src/pages/index.astro').match(/\n {2}title="([^"]+)"/)[1];
  assert.ok(title.length < 60, `${title.length}: ${title}`);
  assert.match(title, /^Olira Agro Industry, /);
});

/* ---------- FR-A3, A4 ---------- */
test('the studio checkbox is 24 px and its whole row is the tap area', () => {
  assert.match(read('src/pages/packaging.astro'), /<label class="check check-row"><input type="checkbox" id="oneInk">/);
  assert.match(rulesFor(site, '.check.check-row input'), /width: 24px; height: 24px/);
  assert.match(rulesFor(site, '.check.check-row'), /flex: 1 1 auto; min-height: 44px/);
});

test('in Windows contrast themes the carousel dots and cards keep visible borders', () => {
  const forced = media(site, '(forced-colors: active) {\n  .flow-dots');
  assert.match(forced, /\.flow-dots button::before \{ forced-color-adjust: none; background: Canvas; border: 1px solid ButtonText; \}/);
  assert.match(forced, /\.flow-dots button\[aria-current="true"\]::before \{ background: Highlight; border-color: Highlight; \}/);
  assert.match(forced, /\.flow-card \{ border: 1px solid ButtonText; \}/);
});
