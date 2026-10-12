// The company's own facts, shown on the home page and in the agriculture
// specification sheet from this one list, so the two can never differ. They are
// the site's original copy; change them here, and only to facts the company can
// show (CLAUDE.md: claims must be true).
export const SINCE = 2008;

export const COMPANY_LINE = `Addis Ababa, Ethiopia. Agricultural exports and printed packaging since ${SINCE}.`;

export interface Fact { label: string; value: string; note: string }
export const FACILITY_FACTS: Fact[] = [
  { label: 'Established', value: String(SINCE), note: 'Founded by two agronomists with 50+ years combined' },
  { label: 'Capacity', value: '20 MT', note: 'Sesame processed per day in Burayu' },
  { label: 'Purity', value: '99.95%', note: 'Purity every sesame lot must reach' },
  { label: 'Food safety', value: 'ISO 22000', note: 'Food safety certified, with GMP and organic options' },
];
