// Build-time site data. The admin panel writes these files through the API, so
// the static pages start from whatever was saved at build time, and the page
// scripts (src/scripts) re-read the live API so later edits show without a
// rebuild.
import fs from 'node:fs';
import { SOCIAL_PAGES } from '../../lib/social.js';
import path from 'node:path';

const repoData = path.join(process.cwd(), 'data');
const dataDir = process.env.DATA_DIR || repoData;

// The live copy (DATA_DIR) wins. A file the live folder does not have yet falls
// back to the repo's copy: on a fresh deploy the build runs before the server's
// first start seeds DATA_DIR, and without this the build saw no packaging
// products at all (an empty home page lineup and catalogue).
function read<T>(file: string, fallback: T): T {
  for (const dir of dataDir === repoData ? [repoData] : [dataDir, repoData]) {
    try {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch (err) {
      console.error(`Failed to read ${dir}/${file}:`, err);
    }
  }
  return fallback;
}

export interface Product {
  id: string; name: string; category?: string; description?: string;
  purity?: string; moq?: string; specs?: string[]; image?: string | null;
}
export interface Certification {
  id: string; name: string; description?: string; image?: string | null;
  // the proof (lib/certificates.js): the certificate file and what is printed on it
  issuer?: string; number?: string; scope?: string; validFrom?: string | null; validUntil?: string | null;
  verifyUrl?: string | null; file?: string | null; fileType?: 'pdf' | 'image' | null;
}
interface Place { label?: string; name?: string; city?: string; lat?: number; lng?: number }
export interface Contacts {
  phones: string[]; emails: string[];
  address?: { line1?: string; line2?: string; poBox?: string; city?: string; country?: string } | null;
  office?: Place | null; factory?: Place | null;
}

export const products = read<Product[]>('products.json', []);

// Packaging products, managed in the admin. Those with a photo and print corners are also the mockup studio's bags.
// normalise() is the server's own: older records read as bags with the three studio sizes.
import { normalise, FAMILIES } from '../../lib/packaging.js';
export { FAMILIES };
export interface PackagingSize { id: string; label: string; w: number | null; d: number | null; h: number | null; minOrder: number | null }
export interface PackagingProduct {
  id: string; name: string; handle?: string; family?: string; description?: string; moq?: string; specs?: string[];
  sizes?: PackagingSize[]; minOrder?: number | null; printColours?: number | null;
  image?: string | null; imageDark?: string | null; width?: number | null; height?: number | null;
  quad?: number[][] | null; safeTop?: number; site?: boolean; team?: boolean;
}
// Flexographic printing: the most colours offered when a product does not set its own
// limit. Shown on the packaging page; the packaging team confirms per order.
export const FLEXO_MAX_COLOURS = 4;
export const packagingProducts = read<PackagingProduct[]>('packaging-products.json', [])
  .filter((p) => p && p.id && p.site !== false && p.name)
  .map((raw) => normalise(raw) as PackagingProduct)
  .map(({ id, name, handle, family, description, moq, specs, sizes, minOrder, printColours, image, imageDark, width, height, quad, safeTop }) => ({
    id, name, handle: handle || '', family: family || 'bags', description: description || '', moq: moq || '', specs: specs || [],
    sizes: sizes || [], minOrder: minOrder ?? null, printColours: printColours ?? null,
    image: image || null, imageDark: image ? imageDark || null : null, width, height,
    quad: image && Array.isArray(quad) && quad.length === 4 ? quad : null, safeTop: safeTop ?? 0.1,
  }));
export const certifications = read<Certification[]>('certifications.json', []);

// Partner logos on the home page (lib/partners.js), set by the marketing teams.
export interface Partner { id: string; name: string; logo: string; url?: string; width?: number | null; height?: number | null }
export const partners = read<Partner[]>('partners.json', [])
  .filter((p) => p && p.id && p.name && /^\/uploads\/partners\/[a-z0-9-]+\.webp$/.test(p.logo || ''));
const rawContacts = read<Contacts>('contact-details.json', { phones: [], emails: [] });
const social = read<Record<string, string>>('social-links.json', {});

// Phone numbers and the WhatsApp link are deliberately NOT exported: nothing
// built into the pages may contain them, so scrapers reading the HTML find
// none. The icons in ReachIcons.astro fetch them on click from
// POST /api/contact/reveal.
export function telegramLabel(url: string) {
  const m = url.match(/(?:t|telegram)\.me\/([A-Za-z0-9_]{4,})/);
  return m ? `@${m[1]}` : 'Open Telegram';
}
const telegramUrl = /^https:\/\/\S+$/.test(social.telegram || '') ? social.telegram : '';

// Fallbacks match the published company details, used only if the admin has
// cleared a field.
export const contact = {
  telegramHref: telegramUrl,
  telegramLabel: telegramUrl ? telegramLabel(telegramUrl) : '',
  email: rawContacts.emails?.[0] || 'info@oliraagroindustry.com',
  // "Soreti Building, 2nd Floor, Room 214" / "Lemi Kura Subcity, Woreda 08, Addis Ababa"
  addressLines: [
    rawContacts.address?.line2 || 'Soreti Building, 2nd Floor, Room 214',
    [rawContacts.address?.line1 || 'Lemi Kura Subcity, Woreda 08', rawContacts.address?.city || 'Addis Ababa'].join(', '),
  ],
  officeShort: [rawContacts.office?.name || 'Soreti Building', rawContacts.office?.city || 'Lemi Kura, Addis Ababa'].join(', '),
  factory: {
    lat: rawContacts.factory?.lat ?? 9.0366,
    lng: rawContacts.factory?.lng ?? 38.6364,
    city: rawContacts.factory?.city || '15 km west of Addis Ababa',
  },
  office: rawContacts.office?.lat != null && rawContacts.office?.lng != null ? { lat: rawContacts.office.lat, lng: rawContacts.office.lng } : null,
};

// The social pages that are set, in the platform order of lib/social.js. WhatsApp
// and Telegram are contact channels, shown with the phone and email.
export const socialLinks = SOCIAL_PAGES
  .filter((p) => typeof social[p.key] === 'string' && /^https?:\/\//.test(social[p.key]))
  .map((p) => ({ key: p.key, url: social[p.key], label: p.label }));

export const SITE = 'https://oliraagroindustry.com';
