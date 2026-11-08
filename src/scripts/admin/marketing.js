// Admin screen: the optional Google tags.
import { $, api, toast, save } from './api.js';
import { bindOnce, invalid } from './form-help.js';

/* ---------- marketing ---------- */
export async function showMarketing() {
  bindOnce('marketing', () => {
    $('#gaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, id = f.elements.measurementId.value.trim().toUpperCase();
      if (id && !/^G-[A-Z0-9]{10}$/.test(id)) return invalid(f.elements.measurementId, 'A Measurement ID looks like G-ABC123DEF4 (G, a dash and 10 letters or digits).');
      await save(f.querySelector('button[type=submit]'), async () => {
        await api('/api/integrations/analytics', { method: 'POST', body: { measurementId: id, propertyId: f.elements.propertyId.value.trim() } });
        loadMarketing();
      }, id ? 'Google Analytics is on.' : 'Google Analytics is off.');
    });
    $('#adsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, id = f.elements.conversionId.value.trim();
      if (id && !/^\d{10}$/.test(id)) return invalid(f.elements.conversionId, 'A Conversion ID is 10 digits.');
      const value = f.elements.conversionValue.value.trim();
      if (value && !(Number(value) >= 0)) return invalid(f.elements.conversionValue, 'The value is a number, for example 10.');
      await save(f.querySelector('button[type=submit]'), async () => {
        await api('/api/integrations/ads', { method: 'POST', body: { conversionId: id, conversionLabel: f.elements.conversionLabel.value.trim(), conversionValue: value || 10 } });
        loadMarketing();
      }, id ? 'Google Ads conversions are on.' : 'Google Ads conversions are off.');
    });
    $('#verifyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, err = $('#verifyErr');
      const google = f.elements.google.value.trim(), bing = f.elements.bing.value.trim();
      // the same reading as the server (lib/search-verification.js), so the admin hears at once
      const g = google.replace(/^.*\//, '').replace(/^google/i, '').replace(/\.html$/i, '');
      if (google && !/^[a-z0-9]{8,64}$/i.test(g)) return invalid(f.elements.google, 'Paste the file name Google gives you. It looks like google1a2b3c4d5e6f7a8b.html.', err);
      if (bing && !/(?:^|[^a-f0-9])[a-f0-9]{32}(?![a-f0-9])/i.test(bing)) return invalid(f.elements.bing, 'Paste the 32-character code from Bing, or the whole meta tag.', err);
      err.hidden = true;
      await save(f.querySelector('button[type=submit]'), async () => {
        await api('/api/integrations/verification', { method: 'POST', body: { google, bing } });
        loadMarketing();
      }, google || bing ? 'Saved. Go back to Google or Bing and press Verify.' : 'Verification codes removed.');
    });
  });
  loadMarketing();
}
async function loadMarketing() {
  try {
    const c = await api('/api/integrations');
    const ga = $('#gaForm').elements, ads = $('#adsForm').elements;
    ga.measurementId.value = c?.analytics?.measurementId || '';
    ga.propertyId.value = c?.analytics?.propertyId || '';
    ads.conversionId.value = c?.ads?.conversionId || '';
    ads.conversionLabel.value = c?.ads?.conversionLabel || '';
    ads.conversionValue.value = c?.ads?.conversionValue ?? '';
    const set = (el, on, text) => { el.className = `a-status ${on ? 'on' : ''}`; el.textContent = text; };
    set($('#gaState'), !!ga.measurementId.value, ga.measurementId.value ? `On, ${ga.measurementId.value}` : 'Off');
    set($('#adsState'), !!ads.conversionId.value, ads.conversionId.value ? 'On' : 'Off');
    const v = $('#verifyForm').elements, g = c?.verification?.google || '', b = c?.verification?.bing || '';
    v.google.value = g ? `google${g}.html` : '';
    v.bing.value = b;
    $('#verifyGoogleLink').hidden = !g;
    if (g) $('#verifyGoogleLink').href = `/google${g}.html`;
    $('#verifyBingLink').hidden = !b;
    set($('#verifyState'), !!(g || b), g && b ? 'Google and Bing' : g ? 'Google' : b ? 'Bing' : 'Not set');
  } catch (e) { toast(e.message, 'error'); }
}
