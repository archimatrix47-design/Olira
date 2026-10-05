// Search engine ownership checks, set from Admin, Marketing tags.
//
// Google's HTML file method asks for a file named google<code>.html containing
// "google-site-verification: google<code>.html"; Bing's asks for /BingSiteAuth.xml.
// Both are answered from the codes saved in integrations-config.json, so no
// rebuild or upload is needed. The admin may paste the whole file name, a meta
// tag or just the code; only the code is kept.

/** The part of Google's file name between "google" and ".html", or null. */
export function cleanGoogleCode(v) {
  const s = String(v || '').trim().replace(/^.*\//, '').replace(/^google/i, '').replace(/\.html$/i, '');
  return /^[a-z0-9]{8,64}$/i.test(s) ? s : null;
}

/** Bing's 32-character code, found anywhere in what was pasted, or null. */
export function cleanBingCode(v) {
  const m = String(v || '').slice(0, 400).match(/(?:^|[^a-f0-9])([a-f0-9]{32})(?![a-f0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

export function registerSearchVerification(app, { rateLimit, adminAuth, loadIntegrationsConfig, saveIntegrationsConfig, audit }) {
  app.post('/api/integrations/verification', rateLimit, adminAuth, (req, res) => {
    const { google, bing } = req.body || {};
    const g = google ? cleanGoogleCode(google) : '';
    const b = bing ? cleanBingCode(bing) : '';
    if (g === null) return res.status(400).json({ error: 'That is not a Google file name. It looks like google1a2b3c4d5e6f7a8b.html.', field: 'google' });
    if (b === null) return res.status(400).json({ error: 'That is not a Bing code. It is 32 letters and digits, from the meta tag or the BingSiteAuth.xml file.', field: 'bing' });
    const config = loadIntegrationsConfig();
    config.verification = { google: g, bing: b };
    if (!saveIntegrationsConfig(config)) return res.status(500).json({ error: 'The codes could not be saved.' });
    audit('search_verification_saved', req, { google: !!g, bing: !!b });
    res.json({ success: true, config: config.verification });
  });

  // only the saved code answers; any other google*.html falls through to the 404 page
  app.get(/^\/google([a-z0-9]{8,64})\.html$/i, (req, res, next) => {
    const code = loadIntegrationsConfig().verification?.google;
    if (!code || code !== req.params[0]) return next();
    res.type('text/html').set('Cache-Control', 'no-cache').send(`google-site-verification: google${code}.html`);
  });
  app.get('/BingSiteAuth.xml', (req, res, next) => {
    const code = loadIntegrationsConfig().verification?.bing;
    if (!code) return next();
    res.type('application/xml').set('Cache-Control', 'no-cache').send(`<?xml version="1.0"?>\n<users>\n\t<user>${code}</user>\n</users>\n`);
  });
}
