// Tell Bing (and the other IndexNow engines: Yandex, Seznam, Naver) that the
// site's pages changed, so they recrawl in hours rather than weeks. Google does
// not use IndexNow; it reads the sitemap. Runs after each deploy (.cpanel.yml)
// and never fails the deploy.
//
//   node scripts/indexnow.mjs [--dry]
//
// The key file public/<key>.txt proves the site is ours; it must be served at
// https://oliraagroindustry.com/<key>.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = 'oliraagroindustry.com';
const dry = process.argv.includes('--dry');

try {
  const keyFile = fs.readdirSync(path.join(root, 'public')).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
  if (!keyFile) throw new Error('no IndexNow key file in public/');
  const key = keyFile.replace('.txt', '');
  const sitemap = fs.readFileSync(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  const urlList = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(`https://${HOST}/`));
  if (!urlList.length) throw new Error('no URLs in dist/sitemap.xml');
  const body = { host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList };
  if (dry) { console.log(`IndexNow (dry run): ${urlList.length} URLs`, body.keyLocation); process.exit(0); }
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  // 200 and 202 mean accepted; 403 means the key file is not reachable yet
  console.log(`IndexNow: ${res.status} for ${urlList.length} URLs`);
} catch (e) {
  console.log(`IndexNow skipped: ${e.message}`);
}
