// BOX contact: the company's address, emails and phone numbers. Phone numbers never
// appear in a page or a public response: a visitor gets them only by pressing a call
// or WhatsApp button, which calls POST /api/contact/reveal.
import path from 'path';
import { BOT_RE } from './site-basics.js';
import { sanitizeSocialUrl } from './social.js';

export function registerContact(app, { dataDir, readJsonFile, writeJsonFile, audit, adminAuth, checkOrigin, isAdminRequest, makeRateLimiter, readSocialLinks }) {
  const contactsPath = path.join(dataDir, 'contact-details.json');

  // Phone numbers are kept away from scrapers: the public response leaves them
  // out, and a visitor gets them only by pressing a call or WhatsApp icon, which
  // calls POST /api/contact/reveal. A signed-in admin gets the full record.

  app.get('/api/contact-details', (req, res) => {
    const data = readJsonFile(contactsPath, { phones: [], emails: [] });
    if (isAdminRequest(req)) return res.json(data);
    const { phones, ...rest } = data;
    res.set('Cache-Control', 'no-store');
    res.json({ ...rest, phones: [] });
  });

  // POST /api/contact/reveal: the numbers behind the call and WhatsApp icons.
  // POST (not a link a crawler follows), rate limited, never cached, bots refused.
  const revealLimit = makeRateLimiter(Number(process.env.REVEAL_RATE_PER_MIN) || 20, 'contact-reveal');
  app.post('/api/contact/reveal', revealLimit, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (BOT_RE.test(String(req.headers['user-agent'] || ''))) return res.status(403).json({ error: 'Forbidden' });
    if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    const c = readJsonFile(contactsPath, { phones: [] });
    const social = readSocialLinks();
    const dial = (p) => String(p || '').replace(/[^\d+]/g, '');
    const phones = (Array.isArray(c.phones) ? c.phones : []).filter(Boolean).slice(0, 4)
      .map((p, i) => ({ label: i === 0 ? 'Sales' : i === 1 ? 'Office' : 'Phone', display: String(p).slice(0, 50), href: 'tel:' + dial(p) }));
    const mainDigits = dial(c.phones?.[0]).replace('+', '');
    const waUrl = sanitizeSocialUrl(social.whatsapp || '') || (mainDigits ? 'https://wa.me/' + mainDigits : '');
    const waDigits = (waUrl.match(/wa\.me\/(\d{8,15})/) || [])[1];
    res.json({
      phones,
      whatsapp: waUrl ? { href: waUrl, display: waDigits ? (waDigits === mainDigits ? phones[0].display : '+' + waDigits) : 'WhatsApp chat' } : null
    });
  });

  // Keep only known text fields (trimmed, capped) plus numeric coordinates. The
  // public pages print these at build time, so a stray object or a non-numeric
  // latitude must never reach them.
  function cleanPlace(obj, keys) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = {};
    for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) out[k] = obj[k].trim().slice(0, 120);
    for (const [k, lim] of [['lat', 90], ['lng', 180]]) {
      const v = typeof obj[k] === 'string' ? Number(obj[k]) : obj[k];
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  app.post('/api/contact-details', adminAuth, (req, res) => {
    const { phones, emails, address, office, factory } = req.body;

    const data = {
      phones: Array.isArray(phones) ? phones.slice(0, 20).map(p => String(p).slice(0, 50)) : [],
      emails: Array.isArray(emails) ? emails.slice(0, 20).map(e => String(e).slice(0, 200)) : [],
      address: cleanPlace(address, ['line1', 'line2', 'poBox', 'city', 'country']),
      office: cleanPlace(office, ['label', 'name', 'city']),
      factory: cleanPlace(factory, ['label', 'name', 'city'])
    };

    if (!writeJsonFile(contactsPath, data)) {
      return res.status(500).json({ error: 'Failed to save contact details' });
    }
    audit('contact_details_saved', req);
    res.json({ success: true, data });
  });
}
