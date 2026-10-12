// Compressed copies of the built site. The build writes a Brotli (.br) and a gzip
// (.gz) copy beside every text file in dist/ once (scripts/precompress.mjs), so the
// server sends a third of the bytes without compressing anything per request,
// which a shared host's CPU limits would feel. The server sends the copy the browser
// accepts, with the original file's type and the cache headers set before it; any
// other request falls through to express.static.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** File types worth compressing: text. Images and fonts are compressed already. */
export const COMPRESSIBLE = /\.(html|js|mjs|css|svg|json|txt|xml|webmanifest|map)$/i;
/** Below this a compressed copy saves less than the extra header costs. */
export const MIN_BYTES = 1024;

/** Write file.br and file.gz beside every compressible file under `dir`; returns what it wrote. */
export function precompressDir(dir) {
  const out = { files: 0, before: 0, br: 0, gz: 0 };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!COMPRESSIBLE.test(e.name)) continue;
      const buf = fs.readFileSync(f);
      if (buf.length < MIN_BYTES) continue;
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      const gz = zlib.gzipSync(buf, { level: 9 });
      fs.writeFileSync(`${f}.br`, br);
      fs.writeFileSync(`${f}.gz`, gz);
      out.files++; out.before += buf.length; out.br += br.length; out.gz += gz.length;
    }
  };
  walk(dir);
  return out;
}

/** Which encoding to send: Brotli if accepted, else gzip, else none. q=0 refuses one. */
export function pickEncoding(header = '') {
  const accepted = new Map();
  for (const part of String(header).toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map((s) => s.trim()).find((s) => s.startsWith('q='));
    accepted.set(name, q ? Number(q.slice(2)) : 1);
  }
  const ok = (n) => (accepted.get(n) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/**
 * Middleware: serve dist's compressed copy of the file a URL names. "/x/" and "/x"
 * mean "/x/index.html", as express.static reads them. Only GET and HEAD, only inside
 * `root`, only when the copy exists.
 */
export function servePrecompressed(root) {
  const base = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch (e) { return next(); }
    if (rel.includes('\0')) return next();
    let file = path.resolve(base, `.${rel}`);
    if (file !== base && !file.startsWith(base + path.sep)) return next(); // outside dist
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    else if (!path.extname(file)) file = path.join(file, 'index.html');
    if (!COMPRESSIBLE.test(file)) return next();
    const enc = pickEncoding(req.headers['accept-encoding']);
    res.vary('Accept-Encoding');
    if (!enc) return next();
    const copy = `${file}${enc === 'br' ? '.br' : '.gz'}`;
    let stat;
    try { stat = fs.statSync(copy); if (!stat.isFile()) return next(); } catch (e) { return next(); }
    // the original must exist, and be no newer than its copy: a page rewritten after
    // the build is sent as it is now, uncompressed, rather than as it was
    try { const o = fs.statSync(file); if (!o.isFile() || o.mtimeMs > stat.mtimeMs + 1000) return next(); } catch (e) { return next(); }
    res.type(path.extname(file));
    res.set('Content-Encoding', enc);
    res.set('Content-Length', String(stat.size));
    res.set('ETag', `W/"${enc}-${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`);
    res.set('Last-Modified', stat.mtime.toUTCString());
    // as express.static does: without a rule of its own a page is checked every time,
    // so a browser never guesses a lifetime and shows an old page after a deploy
    if (!res.get('Cache-Control')) res.set('Cache-Control', 'public, max-age=0');
    if (req.fresh) return res.status(304).end();
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(copy).on('error', next).pipe(res);
  };
}
