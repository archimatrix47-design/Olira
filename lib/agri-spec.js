// An agricultural product's specification: what an importer's quality team checks
// before asking for a sample. The agriculture team fills them in (Agriculture
// products); the product page shows them as a specification sheet, with the
// same values in its structured data and in llms-full.txt. One list for the
// server, the build and the editor. No Node imports: the browser uses it too.
export const SPEC_FIELDS = [
  { key: 'grade', label: 'Grade', hint: 'For example Export grade, whitish' },
  { key: 'moisture', label: 'Moisture', hint: 'For example 6% max' },
  { key: 'oil', label: 'Oil content', hint: 'For example 50% min' },
  { key: 'ffa', label: 'Free fatty acids (FFA)', hint: 'For example 1.5% max' },
  { key: 'admixture', label: 'Admixture', hint: 'For example 0.05% max' },
  { key: 'cropYear', label: 'Crop year', hint: 'For example 2025/26' },
  { key: 'origin', label: 'Growing area', hint: 'For example Humera, Tigray' },
  { key: 'packing', label: 'Packing', hint: 'For example 25 or 50 kg PP bags' },
  { key: 'container', label: 'Container load', hint: 'For example 19 MT per 20 ft' },
  { key: 'documents', label: 'Documents supplied', hint: 'For example phytosanitary, certificate of origin, analysis' },
  { key: 'leadTime', label: 'Lead time', hint: 'For example 3 weeks from order' },
];
const KEYS = new Set(SPEC_FIELDS.map((f) => f.key));

/** Known fields only, each a short single line of text; empty ones are left out. */
export function cleanSpec(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!KEYS.has(k) || typeof v !== 'string') continue;
    const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (t) out[k] = t;
  }
  return out;
}

/** The filled-in fields in the list's order, as [label, value] rows. */
export const specRowsOf = (spec) => SPEC_FIELDS.filter((f) => spec?.[f.key]).map((f) => [f.label, spec[f.key]]);
