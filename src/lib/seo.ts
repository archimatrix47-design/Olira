// Search and answer-engine data shared by every page: product URLs, the
// company's identity as schema.org, breadcrumbs and FAQ markup. Google, Bing
// and AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot) read the
// same structured data and the same visible text, so everything here is built
// from the site's own data and never says more than the pages do.
import { SITE, contact, products, packagingProducts, certifications, FAMILIES } from './site-data';

export const ORG_ID = `${SITE}/#organization`;
export const SITE_ID = `${SITE}/#website`;
export const AGRO_ID = `${SITE}/agriculture/#brand`;
export const PACK_ID = `${SITE}/packaging/#brand`;

export const slugify = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Agriculture product ids are already readable slugs; packaging ids are not (pk_flat), so their names are used. */
export const agriSlug = (p: { id: string; name: string }) => (/^[a-z0-9-]+$/.test(p.id) ? p.id : slugify(p.name));
export const packSlug = (p: { id: string; name: string }) => slugify(p.name) || p.id;
export const agriUrl = (p: { id: string; name: string }) => `/agriculture/${agriSlug(p)}/`;
export const packUrl = (p: { id: string; name: string }) => `/packaging/${packSlug(p)}/`;

export const familyLabel = Object.fromEntries(FAMILIES.map((f: { id: string; label: string }) => [f.id, f.label]));
export const abs = (path: string) => (/^https?:/.test(path) ? path : `${SITE}${path}`);

/** The company, its two product lines and the website, as one schema.org graph. */
export function organizationGraph(sameAs: string[] = []) {
  return [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: 'Olira Agro Industry',
      alternateName: ['Olira', 'Olira Agro', 'Olira Packaging'],
      url: `${SITE}/`,
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` },
      image: `${SITE}/og-home.jpg`,
      description: 'Ethiopian exporter of Humera sesame, pulses, spices and coffee, and maker of paper bags, food boxes, medical packets and aluminium foil bags printed with the customer\'s logo. Head office in Addis Ababa, processing facility in Burayu, since 2008.',
      foundingDate: '2008',
      email: contact.email,
      // no telephone: the numbers are kept out of the page source (see ReachIcons.astro)
      address: { '@type': 'PostalAddress', streetAddress: 'Soreti Building, 2nd Floor, Room 214, Lemi Kura Subcity, Woreda 08', postOfficeBoxNumber: '46325', addressLocality: 'Addis Ababa', addressCountry: 'ET' },
      location: [
        { '@type': 'Place', name: 'Head office', address: { '@type': 'PostalAddress', streetAddress: 'Soreti Building, Lemi Kura Subcity', addressLocality: 'Addis Ababa', addressCountry: 'ET' }, ...(contact.office?.lat ? { geo: { '@type': 'GeoCoordinates', latitude: contact.office.lat, longitude: contact.office.lng } } : {}) },
        { '@type': 'Place', name: 'Olira processing facility', address: { '@type': 'PostalAddress', addressLocality: 'Burayu', addressRegion: 'Oromia', addressCountry: 'ET' }, ...(contact.factory?.lat ? { geo: { '@type': 'GeoCoordinates', latitude: contact.factory.lat, longitude: contact.factory.lng } } : {}) },
      ],
      areaServed: 'Worldwide',
      knowsAbout: ['Sesame export', 'Humera sesame', 'Ethiopian pulses', 'Ethiopian spices', 'Ethiopian coffee', 'Kraft paper bags', 'Food packaging', 'Flexographic printing', 'Aluminium foil bags'],
      contactPoint: [
        { '@type': 'ContactPoint', contactType: 'sales', email: contact.email, availableLanguage: ['English', 'Amharic'], url: `${SITE}/agriculture/#contact`, areaServed: 'Worldwide' },
        { '@type': 'ContactPoint', contactType: 'customer service', email: contact.email, availableLanguage: ['English', 'Amharic'], url: `${SITE}/packaging/#quote`, areaServed: 'ET' },
      ],
      brand: [{ '@id': AGRO_ID }, { '@id': PACK_ID }],
      ...(certifications.length ? { hasCredential: certifications.map((c: { name: string; description?: string }) => ({ '@type': 'EducationalOccupationalCredential', name: c.name, description: c.description || undefined })) } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    },
    { '@type': 'Brand', '@id': AGRO_ID, name: 'Olira Agro', url: `${SITE}/agriculture/`, description: 'Agricultural exports: Humera sesame, pulses, spices and coffee from Ethiopia.' },
    { '@type': 'Brand', '@id': PACK_ID, name: 'Olira Packaging', url: `${SITE}/packaging/`, description: 'Paper bags, bakery and food boxes, medical packets and aluminium foil bags, made to size and printed with the customer\'s logo.' },
    { '@type': 'WebSite', '@id': SITE_ID, name: 'Olira Agro Industry', url: `${SITE}/`, inLanguage: 'en', publisher: { '@id': ORG_ID } },
  ];
}

export const graph = (...nodes: object[]) => ({ '@context': 'https://schema.org', '@graph': nodes.flat() });

/** BreadcrumbList from [name, path] pairs. */
export const breadcrumbs = (items: [string, string][]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
});

/** FAQPage from the questions shown on the page (they must be visible there too). */
export const faqPage = (url: string, items: { q: string; a: string }[]) => ({
  '@type': 'FAQPage', '@id': `${abs(url)}#faq`,
  mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const tons = (moq: string) => { const m = String(moq || '').match(/([\d.]+)\s*MT/i); return m ? Number(m[1]) : null; };

/** Questions buyers ask, answered only with what the site already states. */
export function agriFaq() {
  const named = products.map((p: { name: string }) => p.name);
  const mins = products.map((p: { moq: string }) => tons(p.moq)).filter((n: number | null): n is number => n != null);
  const certs = certifications.map((c: { name: string }) => c.name);
  return [
    { q: 'What does Olira Agro export?', a: `${list(named)}, all from Ethiopia.` },
    ...(mins.length ? [{ q: 'What is the minimum order?', a: `From ${Math.min(...mins)} MT to ${Math.max(...mins)} MT, depending on the product. Each product's minimum is on its page.` }] : []),
    { q: 'Where are the products processed?', a: `At our facility in Burayu, ${contact.factory?.city || 'west of Addis Ababa'}, where they are cleaned, sorted and tested. The facility processes 20 MT of sesame a day.` },
    ...(certs.length ? [{ q: 'Which certifications does Olira hold?', a: `${list(certs)}.` }] : []),
    { q: 'How do I get a quote?', a: 'Send the product, volume and destination port with the enquiry form on the agriculture page. The export team answers within 24 hours.' },
  ];
}

export function packFaq() {
  const families = FAMILIES.map((f: { id: string; label: string }) => ({ label: f.label.toLowerCase(), n: packagingProducts.filter((p: { family: string }) => p.family === f.id).length })).filter((f: { n: number }) => f.n);
  return [
    { q: 'What packaging does Olira make?', a: `${list(families.map((f: { label: string; n: number }) => `${f.label} (${f.n} products)`))}, made to your size and printed with your logo.` },
    { q: 'Can you print our logo?', a: 'Yes. We print with flexographic presses, one ink station per colour, from plain stock up to 4 colours. Choose the colours for each product in your packing list.' },
    { q: 'Can I see my design before I order?', a: 'Yes. The mockup studio on the packaging page puts your logo, text or full artwork on our bags and boxes. Download the mockup, or send it with your quote request.' },
    { q: 'Which artwork files should I send?', a: 'PDF, AI, EPS or SVG print best. PNG, JPG and WebP also work. Attach up to 3 files of 10 MB each to the quote request.' },
    { q: 'How do I get a quote?', a: 'Add the products you need to the packing list, with the size, quantity and print colours of each, and send it with your artwork. We usually reply within 24 hours.' },
  ];
}
