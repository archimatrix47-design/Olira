// "Copy on request" for a certificate without its document. On the line's own
// page the link is #contact and certs.js writes the request into the form; on a
// product page the form is on another page, so the certificate rides along as
// ?cert=<name> and agri.js writes it in there. No imports: the build uses it too.

/** The request link for one certificate. */
export const askFor = (href, name) => (href.startsWith('#') ? href : href.replace(/(#.*)?$/, (hash) => `${href.includes('?') ? '&' : '?'}cert=${encodeURIComponent(name)}${hash}`));

/** The certificate a link asked for, only when it is one of `listed`. */
export const askedCert = (search, listed) => { const c = new URLSearchParams(search).get('cert'); return c && listed.includes(c) ? c : null; };

export const certRequest = (name) => `Please send a copy of your ${name} certificate. `;
