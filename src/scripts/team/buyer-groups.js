// Grouping enquiries by buyer, and what is known about each buyer. Pure: no page,
// no session, so the tests run it in Node (test/buyers.test.js); buyers.js shows it.
import { detailsOf } from '../admin/leads.js';

const OPEN = ['new', 'read', 'contacted', 'quoted'];
const lineOf = (l) => (l?.line === 'pack' ? 'pack' : 'agri');

const LEGAL = /\b(l\.?l\.?c|ltd|limited|plc|inc|incorporated|corp|corporation|co|company|gmbh|b\.?v|n\.?v|s\.?a|sarl|s\.?r\.?l|s\.?p\.?a|fze|fzco|fz-llc|pte|pvt|private|ag|oy|ab|jsc|ojsc|llp|est|establishment)\b\.?/g;
/** A company name reduced to what identifies it: "Gulf Trading L.L.C." -> "gulf trading". */
export const companyKey = (name) => String(name || '').toLowerCase().replace(LEGAL, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Enquiries grouped by buyer: the same company name first, then the same business
 * email domain (an enquiry without a company joins the company that used its
 * domain), then the same email address. Returns [{ key, leads }].
 */
export function groupBuyers(list) {
  const groups = new Map(), byDomain = new Map();
  const put = (key, l) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(l); };
  const withCo = [], rest = [];
  for (const l of list) (companyKey(l.company) ? withCo : rest).push(l);
  for (const l of withCo) {
    const key = `co:${companyKey(l.company)}`;
    const d = detailsOf(l);
    if (d.domain && !d.freeMail && !byDomain.has(d.domain)) byDomain.set(d.domain, key);
    put(key, l);
  }
  for (const l of rest) {
    const d = detailsOf(l);
    const email = String(l.email || '').trim().toLowerCase();
    put(d.domain && !d.freeMail ? (byDomain.get(d.domain) || `dom:${d.domain}`) : `em:${email || l.id}`, l);
  }
  return [...groups].map(([key, ls]) => ({ key, leads: ls.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) }));
}

const mostCommon = (arr) => { const c = new Map(); for (const v of arr) if (v) c.set(v, (c.get(v) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
const lastTouch = (l) => Math.max(Date.parse(l.createdAt) || 0, ...(l.activity || []).map((a) => Date.parse(a.at) || 0), ...(l.history || []).map((x) => Date.parse(x.at) || 0));
const sumBy = (list) => { const s = {}; for (const q of list) if (q && Number(q.total)) s[q.currency] = (s[q.currency] || 0) + Number(q.total); return s; };
export const money = (sums) => Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${Math.round(n).toLocaleString('en-US')}`).join(' and ');

/** What the list and the detail show about one buyer. */
export function summarise({ key, leads: ls }) {
  const people = [];
  for (const l of ls) {
    const email = String(l.email || '').trim().toLowerCase();
    if (!people.some((p) => (email && p.email === email) || (!email && p.name === l.name))) people.push({ name: l.name || '', email, phone: l.phone || '' });
  }
  const company = mostCommon(ls.map((l) => String(l.company || '').trim()));
  const market = mostCommon(ls.map((l) => detailsOf(l).market?.name));
  return {
    key, leads: ls, people, company,
    name: company || people[0]?.name || people[0]?.email || 'Unknown buyer',
    market,
    lines: [...new Set(ls.map(lineOf))],
    first: ls.at(-1)?.createdAt, last: Math.max(...ls.map(lastTouch)),
    open: ls.filter((l) => OPEN.includes(l.status)).length,
    won: ls.filter((l) => l.status === 'won').length,
    lost: ls.filter((l) => l.status === 'lost').length,
    quoted: sumBy(ls.map((l) => l.quote)),
    wonValue: sumBy(ls.filter((l) => l.status === 'won').map((l) => l.quote)),
    products: [...new Set(ls.map((l) => l.product).filter((p) => p && !/^(Agricultural products|Packaging|Not specified|Other|Several products)$/i.test(p)))],
    ports: [...new Set(ls.map((l) => detailsOf(l).port).filter(Boolean))],
  };
}
