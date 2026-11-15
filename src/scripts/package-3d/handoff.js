// A 3D design made on a product page, carried to the quote form on the packaging page
// (box packaging-3d). The product page keeps it in this browser tab's own storage: the
// choices and a picture of the package. The quote form (pack.js) takes it once and sends
// it with the request. Nothing is uploaded until the visitor sends the form.
const KEY = 'olira-3d-design';
const MAX = 1_800_000; // characters: a picture about 1,000 pixels wide fits a few times over
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The ways a package can be printed in the 3D view, in the visitor's words. */
export const PRINTS = { logo: 'your logo on one face', wrap: 'one artwork over the whole package', faces: 'artwork on the faces you chose' };

/** Keep the design for the quote form. False when this browser cannot (storage off or full). */
export function keepDesign(design) {
  try {
    const s = JSON.stringify(design);
    if (s.length > MAX) return false;
    sessionStorage.setItem(KEY, s);
    return true;
  } catch (e) { return false; }
}

/** The kept design if it is whole (a product, a way of printing, a PNG picture), else null. */
export function keptDesign() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    const whole = d && ID.test(d.productId || '') && Object.hasOwn(PRINTS, d.print) && typeof d.picture === 'string' && d.picture.startsWith('data:image/png;base64,');
    return whole ? d : null;
  } catch (e) { return null; }
}

export function dropDesign() { try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } }

/** The design's picture as a file to send (decoded here: the page's policy does not let it be fetched). */
export function pictureOf(design) {
  try {
    const bin = atob(design.picture.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  } catch (e) { return null; }
}
