// The content security policy's script rule. Every inline script the site runs is
// written at build time (the theme switch, the phone menu, the packing-list count,
// the analytics loader...), so the server allows exactly those, by the SHA-256 of
// their text, instead of 'unsafe-inline'; and nothing on the site uses eval, so
// 'unsafe-eval' is gone too. The hashes are read from the built pages, and read
// again whenever a build replaces them (builtScriptHashes), so a new build never
// needs a server restart to run.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const INLINE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const DATA = /\btype\s*=\s*["']?application\/(ld\+)?json/i; // data, not run: no hash needed

/** The 'sha256-...' source of each distinct inline script in the HTML pages under dir. */
export function inlineScriptHashes(dir) {
  const hashes = new Set();
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.html')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(INLINE)) {
          if (DATA.test(m[1])) continue;
          hashes.add(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
        }
      }
    }
  };
  if (dir && fs.existsSync(dir)) walk(dir);
  return [...hashes].sort();
}

/**
 * The hashes for the build in dir as one policy source: a function the policy
 * calls on each request, which reads the pages again only when the build's
 * index.html has changed since the last read.
 */
export function builtScriptHashes(dir) {
  let stamp = null, joined = '';
  return function hashesNow() {
    let now = 'none';
    try { now = String(fs.statSync(path.join(dir, 'index.html')).mtimeMs); } catch (e) { now = 'none'; }
    if (now !== stamp) { stamp = now; joined = inlineScriptHashes(dir).join(' '); }
    // never an empty source: with no inline scripts in the build, 'self' repeats harmlessly
    return joined || "'self'";
  };
}

/** script-src: the site itself, the built inline scripts, and the optional Google tag. */
export const scriptSources = (hashes) => ["'self'", ...(typeof hashes === 'function' ? [hashes] : hashes), 'https://www.googletagmanager.com'];

/** Features the site never uses, switched off for it and anything it embeds. */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()';
