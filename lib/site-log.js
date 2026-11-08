// BOX site-log: gathers the figures for the performance log (lib/ai-log.js builds it)
// and keeps one line of main figures per day in ai-log.jsonl, for trends.
import fs from 'fs';
import path from 'path';
import { buildAiLog, snapshotOf } from './ai-log.js';
import { cleanTargets } from './targets.js';
import { siteUrl } from './site-basics.js';

export function registerSiteLog(app, { dataDir, distPath, readJsonFile, logError, leads, aggregateAnalytics, todayKey, firstTracked, catalogue, agriProducts, listCertificates, runHealthChecks }) {
  const aiHistoryPath = path.join(dataDir, 'ai-log.jsonl');
  const builtPages = new Map();
  /** A page the build really made (so a made-up address in the analytics never reaches the log). */
  function isBuiltPage(p) {
    if (builtPages.has(p)) return builtPages.get(p);
    const file = path.join(distPath, p.endsWith('/') ? path.join(p, 'index.html') : p);
    const ok = file.startsWith(distPath) && fs.existsSync(file);
    if (builtPages.size < 2000) builtPages.set(p, ok);
    return ok;
  }
  async function buildSiteLog({ days, snapshot = false }) {
    // a day's snapshot covers yesterday (UTC), whole; the log covers the days up to now
    const now = snapshot ? Date.parse(`${todayKey()}T00:00:00Z`) - 1 : Date.now();
    const offset = snapshot ? 1 : 0;
    const inquiries = await leads.all();
    let store = null;
    try { store = await leads.status(); } catch (e) { store = { ok: false }; }
    return buildAiLog({
      now, days,
      cur: aggregateAnalytics(days, offset), prev: aggregateAnalytics(days, offset + days),
      inquiries,
      packaging: catalogue(),
      agri: agriProducts(),
      certificates: listCertificates(),
      emailStatus: readJsonFile(path.join(dataDir, 'email-status.json'), null),
      health: { failing: runHealthChecks().failing, store },
      targets: cleanTargets(readJsonFile(path.join(dataDir, 'targets.json'), {}) || {}).targets,
      isKnownPath: isBuiltPage,
      firstTracked: firstTracked(),
      site: siteUrl(),
    });
  }
  function readAiHistory() {
    try {
      return fs.readFileSync(aiHistoryPath, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).slice(-800);
    } catch (e) { return []; }
  }
  async function snapshotYesterday() {
    const hist = readAiHistory();
    const yesterday = todayKey(new Date(Date.now() - 86400000));
    if (hist.some((h) => h.date === yesterday)) return;
    try {
      const line = snapshotOf(await buildSiteLog({ days: 1, snapshot: true }));
      if (line.date !== yesterday) return;
      if (hist.length >= 1000) fs.writeFileSync(aiHistoryPath, [...hist.slice(-799), line].map((x) => JSON.stringify(x)).join('\n') + '\n');
      else fs.appendFileSync(aiHistoryPath, JSON.stringify(line) + '\n');
    } catch (e) { logError('ai-history', e); }
  }
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(snapshotYesterday, 60000).unref();
    setInterval(snapshotYesterday, 3600000).unref();
  }

  return { buildLog: ({ days }) => buildSiteLog({ days }), history: readAiHistory };
}
