// The agriculture enquiry's structured terms: volume in metric tons, destination
// port, Incoterm and shipment window. The form asks for them as separate fields
// (src/components/site/InquiryForm.astro); they are stored on the lead, shown
// to the team and the manager, counted in the lead score and exported in the CSV.
// Enquiries from before these fields keep working: the inbox still reads a port
// and a quantity written into the message (src/scripts/admin/leads.js).

export const INCOTERMS = ['FOB Djibouti', 'CFR', 'CIF', 'Other'];
export const MAX_VOLUME_MT = 100000;
/** Product values that do not name a product: the form's fallbacks and choices. */
export const GENERIC_PRODUCT = /^(Agricultural products|Packaging|Not specified|Other|Several products)?$/i;

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Returns { terms } (only the fields given) or { error, field }. */
export function cleanAgriTerms(b = {}) {
  const terms = {};
  if (b.volumeMt !== undefined && b.volumeMt !== null && b.volumeMt !== '') {
    const raw = typeof b.volumeMt === 'number' ? b.volumeMt : String(b.volumeMt).trim();
    const n = typeof raw === 'number' ? raw : (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_VOLUME_MT) return { error: `Enter the volume in metric tons, a number up to ${MAX_VOLUME_MT.toLocaleString('en-US')}.`, field: 'volumeMt' };
    terms.volumeMt = Math.round(n * 1000) / 1000;
  }
  if (b.port !== undefined && typeof b.port !== 'string') return { error: 'Invalid port field', field: 'port' };
  const port = text(b.port, 80);
  if (port) terms.port = port;
  if (b.incoterm !== undefined && b.incoterm !== '') {
    if (!INCOTERMS.includes(b.incoterm)) return { error: 'Choose an Incoterm from the list.', field: 'incoterm' };
    terms.incoterm = b.incoterm;
  }
  if (b.window !== undefined && typeof b.window !== 'string') return { error: 'Invalid shipment window field', field: 'window' };
  const window = text(b.window, 60);
  if (window) terms.window = window;
  return { terms };
}
