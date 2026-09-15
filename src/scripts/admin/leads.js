// Reading enquiries: market, volume and port from what the buyer wrote, a
// transparent lead score, and pipeline timing. Everything here runs in the
// admin's browser on data the admin already has; nothing is sent anywhere.
import { countryName } from './format.js';

export const STAGES = [
  { id: 'new', label: 'New', open: true },
  { id: 'read', label: 'Opened', open: true },
  { id: 'contacted', label: 'Contacted', open: true },
  { id: 'quoted', label: 'Quoted', open: true },
  { id: 'won', label: 'Won', open: false },
  { id: 'lost', label: 'Lost', open: false },
  { id: 'archived', label: 'Archived', open: false },
];
export const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;
export const lineOf = (product) => (/packag|bag/i.test(product || '') ? 'pack' : 'agri');

// International dialling codes, longest prefix wins. Buyers type their own
// numbers, so this is a hint about the market, not a verified location.
const DIAL = {
  1: 'US', 7: 'RU', 20: 'EG', 27: 'ZA', 30: 'GR', 31: 'NL', 32: 'BE', 33: 'FR', 34: 'ES', 39: 'IT', 40: 'RO', 41: 'CH', 44: 'GB', 45: 'DK', 46: 'SE', 47: 'NO', 48: 'PL', 49: 'DE',
  52: 'MX', 55: 'BR', 60: 'MY', 61: 'AU', 62: 'ID', 63: 'PH', 64: 'NZ', 65: 'SG', 66: 'TH', 81: 'JP', 82: 'KR', 84: 'VN', 86: 'CN', 90: 'TR', 91: 'IN', 92: 'PK', 94: 'LK', 98: 'IR',
  211: 'SS', 212: 'MA', 213: 'DZ', 216: 'TN', 218: 'LY', 233: 'GH', 234: 'NG', 249: 'SD', 251: 'ET', 252: 'SO', 253: 'DJ', 254: 'KE', 255: 'TZ', 256: 'UG', 291: 'ER',
  351: 'PT', 353: 'IE', 358: 'FI', 380: 'UA', 852: 'HK', 880: 'BD', 886: 'TW',
  961: 'LB', 962: 'JO', 963: 'SY', 964: 'IQ', 965: 'KW', 966: 'SA', 967: 'YE', 968: 'OM', 970: 'PS', 971: 'AE', 972: 'IL', 973: 'BH', 974: 'QA',
};
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'mail.ru', 'yandex.ru', 'yandex.com', 'qq.com', '163.com', '126.com', 'sina.com', 'zoho.com', 'web.de', 'rediffmail.com']);
// country-code domains that are used generically and say nothing about a market
const GENERIC_CC = new Set(['co', 'io', 'me', 'tv', 'ai', 'app', 'cc', 'ws', 'fm', 'ly', 'to', 'gg']);

export function marketOf(i) {
  const raw = String(i.phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (/^(\+|00)/.test(raw) && digits) {
    const d = raw.startsWith('00') ? digits.slice(2) : digits;
    for (const len of [3, 2, 1]) { const cc = DIAL[d.slice(0, len)]; if (cc) return { cc, name: countryName(cc), from: 'phone code' }; }
  }
  const domain = String(i.email || '').split('@')[1]?.toLowerCase() || '';
  const tld = domain.split('.').pop();
  if (tld && tld.length === 2 && !GENERIC_CC.has(tld)) {
    const cc = tld === 'uk' ? 'GB' : tld.toUpperCase();
    return { cc, name: countryName(cc), from: 'email domain' };
  }
  return null;
}

export function detailsOf(i) {
  const msg = String(i.message || '');
  const port = (msg.match(/Destination port:\s*(.+)/i) || [])[1]?.trim() || null;
  let volume = (msg.match(/Quantity:\s*(.+)/i) || [])[1]?.trim() || null;
  if (!volume) {
    const m = msg.match(/(\d[\d,.]*)\s*(metric\s*tons?|mt\b|tonnes?|tons?\b|kg\b|containers?|fcl\b|bags?\b|pcs\b|pieces\b)/i);
    if (m) volume = `${m[1]} ${m[2].toUpperCase() === 'MT' ? 'MT' : m[2].toLowerCase()}`;
  }
  const domain = String(i.email || '').split('@')[1]?.toLowerCase() || '';
  return { port, volume, domain, freeMail: FREE_MAIL.has(domain), market: marketOf(i) };
}

/** Lead score out of 100 with the reason for every point, so it can be trusted or ignored. */
export function scoreOf(i) {
  const d = detailsOf(i);
  const generic = /^(Agricultural products|Packaging|Not specified)?$/i.test(i.product || '');
  // [points, passed, label shown on the lead, name used when it is missing]
  const checks = [
    [15, !!String(i.company || '').trim(), String(i.company || '').trim() ? 'Company named' : 'No company name', 'company name'],
    [20, !!d.domain && !d.freeMail, d.domain ? (d.freeMail ? 'Personal email address' : 'Business email domain') : 'No email domain', 'business email'],
    [15, /^(\+|00)\d/.test(String(i.phone || '').trim()), i.phone ? (/^(\+|00)\d/.test(String(i.phone).trim()) ? 'Phone with country code' : 'Phone without country code') : 'No phone', 'phone with country code'],
    [10, !generic, generic ? 'No specific product' : 'Specific product', 'specific product'],
    [15, !!d.volume, d.volume ? `Volume given (${d.volume})` : 'No volume given', 'volume'],
    [15, !!(d.port || d.market), d.port ? `Destination given (${d.port})` : d.market ? `Market from ${d.market.from} (${d.market.name})` : 'No destination or market', 'destination or market'],
    [10, String(i.message || '').replace(/Destination port:.*|Quantity:.*/gi, '').trim().length >= 80, 'Detailed message', 'detail in the message'],
  ];
  const score = checks.reduce((n, [pts, ok]) => n + (ok ? pts : 0), 0);
  const band = score >= 70 ? 'strong' : score >= 40 ? 'fair' : 'thin';
  return { score, band, checks: checks.map(([pts, ok, label, gap]) => ({ pts, ok, label: ok || label !== 'Detailed message' ? label : 'Short message', gap })), details: d };
}
export const BAND_LABEL = { strong: 'Strong lead', fair: 'Fair lead', thin: 'Thin lead' };

/** Hours from arrival to the first stage change, or null when not recorded. */
export function firstResponseHours(i) {
  const first = (i.history || []).find((x) => x.from === 'new' || x.status !== 'new');
  if (!first) return null;
  return Math.max(0, (Date.parse(first.at) - Date.parse(i.createdAt)) / 3600000);
}
export const ageHours = (i) => (Date.now() - Date.parse(i.createdAt)) / 3600000;

export const RESPONSE_BUCKETS = [
  { label: 'Under 1 hour', test: (h) => h < 1 },
  { label: '1 to 4 hours', test: (h) => h >= 1 && h < 4 },
  { label: '4 to 24 hours', test: (h) => h >= 4 && h < 24 },
  { label: '1 to 3 days', test: (h) => h >= 24 && h < 72 },
  { label: 'Over 3 days', test: (h) => h >= 72 },
];

export const median = (arr) => {
  const v = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function inPeriod(list, days, offset = 0) {
  const end = Date.now() - offset * 86400000, start = end - days * 86400000;
  return list.filter((i) => { const t = Date.parse(i.createdAt); return t > start && t <= end; });
}
