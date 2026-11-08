// BOX social-links: the site's social pages and WhatsApp link. The public list leaves
// the WhatsApp number out; the marketing teams edit the full record.
import path from 'path';
import { SOCIAL_KEYS, sanitizeSocialUrl } from './social.js';

export function registerSocialLinks(app, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth }) {
  const socialPath = path.join(dataDir, 'social-links.json');

  // The platforms and the link check live in lib/social.js (one list for the
  // server, the admin, the marketing workspaces and the public pages).
  function cleanSocial(body) {
    const data = {};
    for (const key of SOCIAL_KEYS) data[key] = sanitizeSocialUrl(body?.[key]);
    return data;
  }

  // The marketing teams edit these from their workspaces (/api/team/social-links).
  app.get('/api/social-links', (req, res) => {
    const data = readJsonFile(socialPath, {});
    // a WhatsApp link carries a phone number; the public gets it via /api/contact/reveal
    const { whatsapp, ...rest } = data;
    res.json({ ...rest, whatsapp: whatsapp ? 'set' : '' });
  });

  // Both marketing teams (agriculture and packaging) look after the contact links
  // and social pages, from their workspaces. The full record, WhatsApp link
  // included, is for them only.
  const marketingTeam = roleAuth(['agri', 'pack'], 'Contact links are looked after by the marketing teams.');
  app.get('/api/team/social-links', marketingTeam, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(cleanSocial(readJsonFile(socialPath, {})));
  });
  app.post('/api/team/social-links', marketingTeam, (req, res) => {
    const data = cleanSocial(req.body);
    if (!writeJsonFile(socialPath, data)) return res.status(500).json({ error: 'The links could not be saved.' });
    audit('social_links_saved', req, { by: req.teamUser.id, role: req.teamUser.role });
    res.json({ success: true, data });
  });

  return { readSocialLinks: () => readJsonFile(socialPath, {}) };
}
