// What the certifications need, as attention items for the admin's overview and
// the manager's dashboard. The admin fixes them (Certifications); the manager
// sees the same facts and is told who to ask. Statuses come from the server
// (lib/certificates.js): valid, expiring, expired, no-proof.
const names = (list) => list.map((c) => c.name).join(', ');
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** [{ level, title, text }] for the certifications that need someone. */
export function certAlerts(certs, { forManager = false } = {}) {
  if (!Array.isArray(certs)) return [];
  const out = [];
  const ask = forManager ? ' Ask the site administrator to' : '';
  const expired = certs.filter((c) => c.status === 'expired');
  const missing = certs.filter((c) => c.status === 'no-proof');
  const soon = certs.filter((c) => c.status === 'expiring').sort((a, b) => a.daysLeft - b.daysLeft);
  if (expired.length) out.push({ level: 'high', title: `${expired.length} ${expired.length === 1 ? 'certification has' : 'certifications have'} expired`, text: `${names(expired)}. ${expired.length === 1 ? 'It was' : 'They were'} taken off the website, so buyers no longer see ${expired.length === 1 ? 'it' : 'them'}.${ask ? `${ask} upload the renewed certificate.` : ' Upload the renewed certificate and its new dates.'}` });
  if (soon.length) out.push({ level: 'medium', title: `${soon[0].name} expires in ${soon[0].daysLeft} ${soon[0].daysLeft === 1 ? 'day' : 'days'}`, text: `On ${fmt(soon[0].validUntil)} it comes off the website.${soon.length > 1 ? ` ${soon.length - 1} more expire${soon.length === 2 ? 's' : ''} within 60 days.` : ''} Start the renewal with the issuer now.${ask ? `${ask} upload the new certificate when it arrives.` : ''}` });
  if (missing.length) out.push({ level: 'medium', title: `${missing.length} ${missing.length === 1 ? 'certification has' : 'certifications have'} no certificate uploaded`, text: `${names(missing)}. Buyers see "copy on request" instead of a document they can check, and importers often move on.${ask ? `${ask} upload the certificates.` : ' Upload the PDFs or scans.'}` });
  return out;
}

/** The setup checklist line: done only when every certification has its document and none has expired. */
export function certHealth(certs) {
  if (!Array.isArray(certs)) return ['optional', 'Certifications', 'Could not check just now'];
  if (!certs.length) return ['todo', 'Certifications', 'None listed'];
  const proven = certs.filter((c) => c.status === 'valid' || c.status === 'expiring').length;
  const done = proven === certs.length;
  return [done ? 'ok' : 'todo', 'Certifications', `${proven} of ${certs.length} shown with the certificate itself${done ? '' : '. Upload the rest so buyers can check them'}`];
}
