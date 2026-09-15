// Who is signed in to the workspace, and the enquiries loaded for this team.
import { api } from '../admin/api.js';
import { STAGES } from '../admin/leads.js';

export const session = { user: null, members: [], line: 'agri', isAdmin: false };
export const OPEN = ['new', 'read', 'contacted', 'quoted'];
export const CLOSED = ['won', 'lost', 'archived'];
export const LINE_NAME = { agri: 'agriculture', pack: 'packaging' };

let cache = null, loading = null;
export async function leads(force = false) {
  if (cache && !force) return cache;
  if (!loading || force) {
    loading = api(`/api/team/inquiries?line=${session.line}`).then((r) => { cache = Array.isArray(r.inquiries) ? r.inquiries : []; loading = null; return cache; })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}
/** Replace one enquiry in the cache after the server returned it. */
export function putLead(rec) {
  if (!cache) return;
  const i = cache.findIndex((x) => x.id === rec.id);
  if (i >= 0) cache[i] = rec; else cache.unshift(rec);
}
export const isMine = (l) => !!session.user && l.assignee?.id === session.user.id;
/** Open and nobody has accepted it: the one definition behind every "To accept" count. */
export const toAccept = (l) => OPEN.includes(l.status) && !l.assignee;
export const stageName = (id) => STAGES.find((s) => s.id === id)?.label || id;

const CONTACT_TYPES = new Set(['reply', 'call', 'whatsapp', 'email', 'meeting', 'quote']);
/** When the enquiry was last actually worked on: a reply, call, quote or stage change. */
export function lastTouch(l) {
  const times = [Date.parse(l.createdAt)];
  for (const a of l.activity || []) if (CONTACT_TYPES.has(a.type) || a.type === 'accepted') times.push(Date.parse(a.at));
  for (const x of l.history || []) times.push(Date.parse(x.at));
  return Math.max(...times.filter(Number.isFinite));
}
export const hasContact = (l) => (l.activity || []).some((a) => CONTACT_TYPES.has(a.type));
const H = 3600000;

/** Follow-up rules: what is waiting on the team, most urgent first. */
export function followupsOf(list, now = Date.now()) {
  const out = [];
  for (const l of list) {
    if (!OPEN.includes(l.status)) continue;
    if (!session.isAdmin && l.assignee && !isMine(l)) continue;
    const age = now - Date.parse(l.createdAt), quiet = now - lastTouch(l);
    if (l.status === 'new' && age > 4 * H) out.push({ lead: l, kind: 'accept', label: 'Waiting to be accepted', due: Date.parse(l.createdAt) + 4 * H });
    else if (l.status === 'read' && !hasContact(l) && quiet > 24 * H) out.push({ lead: l, kind: 'contact', label: 'Accepted, buyer not contacted yet', due: lastTouch(l) + 24 * H });
    else if (l.status === 'quoted' && quiet > 5 * 24 * H) out.push({ lead: l, kind: 'quote', label: 'Quote sent, time to follow up', due: lastTouch(l) + 5 * 24 * H });
    else if (l.status === 'contacted' && quiet > 7 * 24 * H) out.push({ lead: l, kind: 'quiet', label: 'Gone quiet for a week', due: lastTouch(l) + 7 * 24 * H });
  }
  return out.sort((a, b) => a.due - b.due);
}
