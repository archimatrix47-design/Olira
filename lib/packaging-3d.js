// BOX packaging-3d: A packaging product in 3D at its own measurements: it folds, opens and lays flat, wears the visitor's logo or artwork, and shows on the website only when both the packaging team and the manager have switched it on.
// Given what it needs by server.js (see boxes/README.md). Returns what other boxes may use.
//
// The server's part is the two switches. The packaging team holds one and the manager
// holds the other; 3D shows on the website only while both are on (the AND gate,
// view3dLive in lib/box-styles.js). Each account can move only its own role's switch,
// so neither side can put 3D on the site alone, and either side can take it off.
//
// The geometry (lib/package-shapes.js) and the view (src/scripts/package-3d/) need
// nothing from the server: the pages build the package from the catalogue's sizes.
import path from 'path';
import { view3dLive } from './box-styles.js';

/** Which switch an account holds: the manager's, or the packaging team's. */
export const switchFor = (role) => (role === 'manager' ? 'manager' : role === 'pack' ? 'team' : null);

export function registerPackaging3d(app, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth }) {
  const file = path.join(dataDir, 'packaging-3d.json');
  // a missing or unreadable file is two switches off: 3D stays off the site
  const read = () => { const s = readJsonFile(file, {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };
  const view3dOn = () => view3dLive(read());
  const shown = (s) => ({ on: s?.on === true, by: typeof s?.by === 'string' ? s.by : null, at: typeof s?.at === 'string' ? s.at : null });
  const state = (s = read()) => ({ team: shown(s.team), manager: shown(s.manager), live: view3dLive(s) });

  // public: whether the website shows 3D now. Product pages ask before they draw one,
  // so a switch turned off takes effect on the next visit, without a rebuild.
  app.get('/api/packaging-3d', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ on: view3dOn() });
  });

  const staff = roleAuth(['pack', 'manager'], 'The 3D view is switched on by the packaging team and the manager.');
  app.get('/api/team/packaging-3d', staff, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ...state(), yours: switchFor(req.teamUser.role) });
  });
  // POST { on: true | false }: sets the caller's own switch, never the other one
  app.post('/api/team/packaging-3d', staff, (req, res) => {
    const on = req.body?.on;
    if (typeof on !== 'boolean') return res.status(400).json({ error: 'Say whether to switch the 3D view on or off.' });
    const which = switchFor(req.teamUser.role);
    const s = read();
    s[which] = { on, by: req.teamUser.name || req.teamUser.id, at: new Date().toISOString() };
    if (!writeJsonFile(file, s)) return res.status(500).json({ error: 'The switch could not be saved. Try again.' });
    audit('packaging_3d_switched', req, { switch: which, on, live: view3dLive(s), by: req.teamUser.id });
    res.json({ ...state(s), yours: which });
  });

  return { view3dOn };
}
