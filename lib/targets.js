// Monthly targets per business line, set by the manager: enquiries received,
// quotes sent and the value won in the month. The dashboard and each team's
// Insights show progress against them; the numbers themselves are counted in
// the browser from the enquiries (src/scripts/team/targets-progress.js).
//
//   GET  /api/team/targets   the manager and both teams (a team gets its own line)
//   POST /api/team/targets   the manager only: { targets: { agri: {...}, pack: {...} } }
import path from 'node:path';

export const CURRENCIES = ['USD', 'EUR', 'ETB'];
const LINES = ['agri', 'pack'];
const whole = (v, max) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(/[\s,]/g, '')); return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN; };

/** Returns { targets } or { error }. Blank means "no target". */
export function cleanTargets(raw) {
  const out = {};
  for (const line of LINES) {
    const t = raw?.[line] || {};
    const enquiries = whole(t.enquiries, 100000), quotes = whole(t.quotes, 100000), wonValue = whole(t.wonValue, 1e12);
    if ([enquiries, quotes, wonValue].some(Number.isNaN)) return { error: 'Targets are whole numbers, or blank for no target.' };
    const currency = CURRENCIES.includes(t.currency) ? t.currency : line === 'pack' ? 'ETB' : 'USD';
    out[line] = { enquiries, quotes, wonValue, currency };
  }
  return { targets: out };
}

export function registerTargets(app, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth }) {
  const file = path.join(dataDir, 'targets.json');
  const read = () => cleanTargets(readJsonFile(file, {}) || {}).targets;
  const anyone = roleAuth(['manager', 'agri', 'pack'], 'Targets are for the manager and the teams.');
  const manager = roleAuth(['manager'], 'Only a manager sets the targets.');

  app.get('/api/team/targets', anyone, (req, res) => {
    const all = read();
    res.set('Cache-Control', 'no-store');
    res.json({ targets: req.user.role === 'manager' ? all : { [req.user.role]: all[req.user.role] } });
  });

  app.post('/api/team/targets', manager, (req, res) => {
    const r = cleanTargets(req.body?.targets);
    if (r.error) return res.status(400).json({ error: r.error });
    if (!writeJsonFile(file, { ...r.targets, updatedAt: new Date().toISOString(), by: req.user.id })) return res.status(500).json({ error: 'The targets could not be saved.' });
    audit('targets_saved', req, { by: req.user.id });
    res.json({ success: true, targets: r.targets });
  });
}
