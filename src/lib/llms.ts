// The site for AI assistants (llmstxt.org): /llms.txt is the short guide with
// links, /llms-full.txt has every product's details. Built from the same data as
// the pages, so it says nothing the pages do not. Phone numbers stay out, as
// they do everywhere in the page source (see ReachIcons.astro).
import { SITE, contact, products, packagingProducts, certifications, FLEXO_MAX_COLOURS } from './site-data';
import { agriUrl, packUrl, familyLabel, agriFaq, packFaq } from './seo';
import { withStatus } from '../../lib/certificates.js';
import { specRows, priceFrom, etb } from '../scripts/catalogue-panel.js';

const certLines = () => certifications.map((c) => withStatus(c)).filter((c) => c.status !== 'expired').map((c) =>
  `- ${c.name}${c.description ? `: ${c.description}` : ''}${c.issuer ? `. Issued by ${c.issuer}` : ''}${c.number ? `, no. ${c.number}` : ''}${c.validUntil ? `, valid until ${c.validUntil}` : ''}${c.file ? `. Certificate: ${SITE}${c.file}` : '. Copy on request'}${c.verifyUrl ? `. Check with the issuer: ${c.verifyUrl}` : ''}`);

const intro = `# Olira Agro Industry

> Ethiopian company with two product lines. Olira Agro exports Humera sesame, pulses, spices and coffee, cleaned, sorted and tested at its facility in Burayu (${contact.factory.city}). Olira Packaging makes paper bags, bakery and food boxes, medical packets and aluminium foil bags in Addis Ababa, made to size and printed with the customer's logo. Head office in Addis Ababa, since 2008.

- Email: ${contact.email}
- Address: ${contact.addressLines.join(', ')}, Ethiopia
- Phone and WhatsApp: shown on the website behind the call and WhatsApp buttons
- Agricultural enquiries: ${SITE}/agriculture/#contact (product, volume and destination port; answered within 24 hours)
- Packaging quotes: ${SITE}/packaging/#quote (packing list with sizes, quantities and print colours; usually answered within 24 hours)`;

export function llmsShort() {
  return `${intro}

## Agricultural exports (Olira Agro)

- [Agricultural exports overview](${SITE}/agriculture/): the range, the Burayu facility and certifications
${products.map((p) => `- [${p.name}](${SITE}${agriUrl(p)}): ${p.category || 'Agriculture'}${p.purity ? `, ${p.purity} purity` : ''}${p.moq ? `, minimum order ${p.moq}` : ''}`).join('\n')}

## Printed packaging (Olira Packaging)

- [Packaging overview](${SITE}/packaging/): catalogue, mockup studio, packing list and quote request
${packagingProducts.map((p) => { const f = priceFrom(p); return `- [${p.name}](${SITE}${packUrl(p)}): ${familyLabel[p.family || 'bags'] || 'Packaging'}${f ? `, from ${etb(f.price)} per 1,000` : ''}`; }).join('\n')}

## Certifications

${certLines().join('\n') || '- None listed'}

## Optional

- [Full details of every product](${SITE}/llms-full.txt)
- [Sitemap](${SITE}/sitemap.xml)
`;
}

export function llmsFull() {
  const agri = products.map((p) => `### ${p.name}

- Page: ${SITE}${agriUrl(p)}
- Category: ${p.category || 'Agriculture'}
- Origin: Ethiopia${p.purity ? `\n- Purity: ${p.purity}` : ''}${p.moq ? `\n- Minimum order: ${p.moq}` : ''}

${p.description || ''}
${(p.specs || []).map((s) => `- ${s}`).join('\n')}`).join('\n\n');
  const pack = packagingProducts.map((p) => {
    const rows = specRows(p, FLEXO_MAX_COLOURS);
    const sizes = (p.sizes || []).filter((s) => s.w && s.h).map((s) => `${s.label} ${[s.w, s.d, s.h].filter(Boolean).join(' x ')} cm`);
    return `### ${p.name}

- Page: ${SITE}${packUrl(p)}
- Group: ${familyLabel[p.family || 'bags'] || 'Packaging'}
${rows.map(([k, v]) => `- ${k}: ${v}`).join('\n')}${sizes.length ? `\n- Measurements: ${sizes.join('; ')}` : ''}

${p.description || ''}
${(p.specs || []).map((s) => `- ${s}`).join('\n')}`;
  }).join('\n\n');
  const qa = (list: { q: string; a: string }[]) => list.map(({ q, a }) => `**${q}**\n${a}`).join('\n\n');
  return `${intro}

## Agricultural exports (Olira Agro)

${agri}

## Printed packaging (Olira Packaging)

Printing is flexographic, with one ink station per colour, from plain stock up to ${FLEXO_MAX_COLOURS} colours. Visitors can design a bag in the mockup studio (${SITE}/packaging/#studio) and send it with a quote request.

${pack}

## Certifications

${certLines().join('\n') || '- None listed'}

## Questions buyers ask

${qa(agriFaq())}

${qa(packFaq())}
`;
}
