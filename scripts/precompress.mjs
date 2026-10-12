// After the build: a Brotli and a gzip copy of every text file in dist/, which the
// server sends to browsers that accept them (lib/precompressed.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { precompressDir } from '../lib/precompressed.js';

const dist = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const r = precompressDir(dist);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`🗜  precompressed ${r.files} files: ${kb(r.before)} to ${kb(r.br)} (br), ${kb(r.gz)} (gzip)`);
