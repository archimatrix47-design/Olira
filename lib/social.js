// The website's contact channels and social pages: one list for the server,
// both marketing workspaces and the public pages, so a platform is added in one
// place. Both marketing teams (agriculture and packaging) set them; a blank one
// is hidden on the website.
//
// WhatsApp is special: its link carries a phone number, so the public never gets
// it in a page or from the public API; the WhatsApp buttons ask for it on press
// (POST /api/contact/reveal), like the call button.
export const SOCIAL_PLATFORMS = [
  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'https://wa.me/2519XXXXXXXX', hint: 'Used by every WhatsApp button. Leave blank to use the main phone number.' },
  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/yourname', hint: 'Shown with WhatsApp and email on every page. Leave blank to hide it.' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourpage' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourname' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourname' },
  { key: 'messenger', label: 'Messenger', placeholder: 'https://m.me/yourpage' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourcompany' },
  { key: 'x', label: 'X', placeholder: 'https://x.com/yourname' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourname' },
];
export const SOCIAL_KEYS = SOCIAL_PLATFORMS.map((p) => p.key);
/** The social pages shown as links (not the contact channels, WhatsApp and Telegram). */
export const SOCIAL_PAGES = SOCIAL_PLATFORMS.filter((p) => p.key !== 'whatsapp' && p.key !== 'telegram');

/** Only an empty string or a clean http(s) link of up to 300 characters is kept. */
export function sanitizeSocialUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 300);
  if (s === '') return '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}
