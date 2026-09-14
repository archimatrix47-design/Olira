// Build-time site data. The admin panel writes these files through the API, so
// the static pages start from whatever was saved at build time, and the page
// scripts (src/scripts) re-read the live API so later edits show without a
// rebuild.
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

function read<T>(file: string, fallback: T): T {
  try {
    const p = path.join(dataDir, file);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : fallback;
  } catch (err) {
    console.error(`Failed to read data/${file}:`, err);
    return fallback;
  }
}

export interface Product {
  id: string; name: string; category?: string; description?: string;
  purity?: string; moq?: string; specs?: string[]; image?: string | null;
}
export interface Certification { id: string; name: string; description?: string; image?: string | null }
interface Place { label?: string; name?: string; city?: string; lat?: number; lng?: number }
export interface Contacts {
  phones: string[]; emails: string[];
  address?: { line1?: string; line2?: string; poBox?: string; city?: string; country?: string } | null;
  office?: Place | null; factory?: Place | null;
}

export const products = read<Product[]>('products.json', []);
export const certifications = read<Certification[]>('certifications.json', []);
const rawContacts = read<Contacts>('contact-details.json', { phones: [], emails: [] });
const social = read<Record<string, string>>('social-links.json', {});

// Fallbacks match the published company details, used only if the admin has
// cleared a field.
const phone = rawContacts.phones?.[0] || '+251 911 223 619';
const digits = (s: string) => s.replace(/[^\d+]/g, '');

// WhatsApp opens the admin's WhatsApp link when one is saved, otherwise the main
// phone. The label always names the number the link actually opens.
export function whatsappLabel(url: string, mainPhone: string) {
  if (!url) return mainPhone;
  const m = url.match(/wa\.me\/(\d{8,15})/);
  if (!m) return 'Chat on WhatsApp';
  return digits(mainPhone).replace('+', '') === m[1] ? mainPhone : `+${m[1]}`;
}
export function telegramLabel(url: string) {
  const m = url.match(/(?:t|telegram)\.me\/([A-Za-z0-9_]{4,})/);
  return m ? `@${m[1]}` : 'Open Telegram';
}
const telegramUrl = /^https:\/\/\S+$/.test(social.telegram || '') ? social.telegram : '';

export const contact = {
  phone,
  phoneHref: `tel:${digits(phone)}`,
  whatsappLabel: whatsappLabel(social.whatsapp || '', phone),
  telegramHref: telegramUrl,
  telegramLabel: telegramUrl ? telegramLabel(telegramUrl) : '',
  officePhone: rawContacts.phones?.[1] || '',
  officePhoneHref: rawContacts.phones?.[1] ? `tel:${digits(rawContacts.phones[1])}` : '',
  email: rawContacts.emails?.[0] || 'info@oliraagroindustry.com',
  whatsappHref: social.whatsapp || `https://wa.me/${digits(phone).replace('+', '')}`,
  // "Soreti Building, 2nd Floor, Room 214" / "Lemi Kura Subcity, Woreda 08, Addis Ababa"
  addressLines: [
    rawContacts.address?.line2 || 'Soreti Building, 2nd Floor, Room 214',
    [rawContacts.address?.line1 || 'Lemi Kura Subcity, Woreda 08', rawContacts.address?.city || 'Addis Ababa'].join(', '),
  ],
  officeShort: [rawContacts.office?.name || 'Soreti Building', rawContacts.office?.city || 'Lemi Kura, Addis Ababa'].join(', '),
  factory: {
    lat: rawContacts.factory?.lat ?? 9.0366,
    lng: rawContacts.factory?.lng ?? 38.6364,
  },
};

export const socialLinks = Object.entries(social)
  // WhatsApp and Telegram are contact channels, shown with the phone and email
  .filter(([key, url]) => key !== 'whatsapp' && key !== 'telegram' && typeof url === 'string' && /^https?:\/\//.test(url))
  .map(([key, url]) => ({ key, url, label: { facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', telegram: 'Telegram' }[key] || key }));

export const SITE = 'https://oliraagroindustry.com';
