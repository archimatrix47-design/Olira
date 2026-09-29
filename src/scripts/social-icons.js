// Line icons for the contact channels and social pages, drawn in the same style
// as the call and WhatsApp icons (ReachIcons.astro): 24 x 24, a 1.8 stroke in the
// current colour. Fixed markup from this file; never built from saved data.
const svg = (inner, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ICONS = {
  email: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.9 7.9"/>'),
  whatsapp: svg('<path d="M3.6 20.4l1.2-4.1a8.6 8.6 0 1 1 3.1 3z"/><path d="M9.1 8.3c.3-.5.8-.4 1-.1l.8 1.7c.1.3 0 .5-.2.7l-.5.5c.6 1.3 1.6 2.3 2.9 2.9l.5-.5c.2-.2.4-.3.7-.2l1.7.8c.3.2.4.7-.1 1-.7.6-1.5.8-2.3.5a8 8 0 0 1-4.9-4.9c-.3-.8-.1-1.6.5-2.3z" fill="currentColor" stroke="none"/>'),
  telegram: svg('<path d="M21.5 3.5L2.8 10.8l6.3 2.1 2.2 6.6 3.3-4.3 5.1 3.7z"/><path d="M9.1 12.9l12.4-9.4"/>'),
  facebook: svg('<path d="M15 3.5h-2.4A3.6 3.6 0 009 7.1V10H6.5v3.4H9v7.1h3.4v-7.1h2.5l.5-3.4h-3V7.4a1 1 0 011-1H15z"/>'),
  instagram: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/>'),
  tiktok: svg('<path d="M13.8 3.5v11.2a3.6 3.6 0 11-3.6-3.6"/><path d="M13.8 3.5c.5 2.6 2.3 4.4 5 4.8"/>'),
  messenger: svg('<path d="M12 3.2c-4.9 0-8.8 3.6-8.8 8.2 0 2.5 1.2 4.8 3.2 6.3v3.1l2.9-1.6c.9.2 1.8.4 2.7.4 4.9 0 8.8-3.7 8.8-8.2S16.9 3.2 12 3.2z"/><path d="M7.6 13.8l3.1-3.3 2.3 2.2 3.4-3.5-3.1 3.3-2.3-2.2z"/>'),
  linkedin: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8.2 10.6v5.9M8.2 7.7v.1M11.8 16.5v-3.3a2.3 2.3 0 014.6 0v3.3M11.8 10.6v5.9"/>'),
  x: svg('<path d="M4.5 4.5l15 15M19.5 4.5l-15 15"/>'),
  youtube: svg('<rect x="2.8" y="5.8" width="18.4" height="12.4" rx="4"/><path d="M10.2 9.4v5.2l4.4-2.6z" fill="currentColor"/>'),
  chat: svg('<path d="M4.5 5h15a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H11l-4.8 3.6V17H4.5A1.5 1.5 0 013 15.5v-9A1.5 1.5 0 014.5 5z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>', 24),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 24),
};
