// BOX enquiries: a buyer's enquiry arriving from the website. It is checked, saved
// before any email is tried (so a mail problem never loses a buyer), routed to its team,
// and acknowledged. Working it afterwards is the enquiry-work box.
import { checkBundle } from './packaging-rules.js';
import { clientIp } from './site-basics.js';
import { cleanAgriTerms, GENERIC_PRODUCT, lineOfProduct } from './enquiry.js';

export function registerEnquiries(app, { rateLimit, audit, logError, leads, sendEmail, loadEmailConfig, parseIntake, saveIntakeFiles, teamEmailsFor, workspaceUrl, catalogue, recordInquiry }) {
  app.use('/api/inquiry', rateLimit);

  // Limits on what a stranger can leave and make us send (white-hat, 23 Nov 2026): files are
  // capped per address per day (real artwork is a few MB; 24 MB a request with no daily cap
  // filled the store in minutes), and the thank-you mail goes to an address once a day, with
  // the name in it only when it looks like a name (not a link or a sales pitch).
  const DAY_FILE_BUDGET = (Number(process.env.INTAKE_DAY_BUDGET_MB) || 60) * 1024 * 1024;
  const filesToday = new Map(), thankedAt = new Map();
  const today = () => new Date().toISOString().slice(0, 10);
  const budgetLeft = (ip) => { const r = filesToday.get(ip); return r && r.day === today() ? DAY_FILE_BUDGET - r.bytes : DAY_FILE_BUDGET; };
  const spend = (ip, bytes) => { if (filesToday.size > 5000) filesToday.clear(); const r = filesToday.get(ip); filesToday.set(ip, { day: today(), bytes: (r && r.day === today() ? r.bytes : 0) + bytes }); };
  const NAME_LIKE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;

  // Helper function to validate email
  // the length first: the pattern's time grows with the square of a long input, and one
  // 1 MB "address" froze the whole server for minutes (white-hat, 23 Nov 2026)
  function isValidEmail(email) {
    const s = String(email).trim();
    if (s.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  // Helper function to sanitize HTML content
  function sanitizeHtml(text) {
    if (!text) return '';
    return String(text)
      .trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Submit product inquiry
  app.post('/api/inquiry', (req, res, next) => parseIntake(req, res, next), async (req, res) => {
    const { name, email, company, message, product, phone, website } = req.body || {};
    const uploads = Object.values(req.files || {}).flat();

    // Honeypot: the hidden `website` field is invisible to humans. If it's
    // filled, this is almost certainly a bot — return success so the bot sees no
    // signal to adapt, but send nothing. This blocks the confirmation-email
    // amplification vector without adding friction for real users.
    if (typeof website === 'string' && website.trim() !== '') {
      audit('inquiry_honeypot', req);
      return res.json({ success: true, message: 'Inquiry sent successfully' });
    }

    // Validate required fields (the message is checked once the line is known: an
    // agriculture enquiry that names its product may leave it empty)
    if (!name || !email) {
      return res.status(400).json({ error: 'Missing required fields: name, email, message' });
    }

    // Validate field types and lengths
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return res.status(400).json({ error: 'Invalid name field' });
    }

    if (typeof email !== 'string' || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (message != null && message !== '' && (typeof message !== 'string' || message.length > 2000)) {
      return res.status(400).json({ error: 'Invalid message field' });
    }

    // Validate optional fields
    if (company && (typeof company !== 'string' || company.length > 100)) {
      return res.status(400).json({ error: 'Invalid company field' });
    }

    // 200 matches the cap the products API applies to a product name, since the
    // dropdown now submits the product name itself rather than a short slug.
    if (product && (typeof product !== 'string' || product.length > 200)) {
      return res.status(400).json({ error: 'Invalid product field' });
    }

    if (phone && (typeof phone !== 'string' || phone.length > 20)) {
      return res.status(400).json({ error: 'Invalid phone field' });
    }

    // A quote bundle (several packaging products, sizes and quantities) is checked
    // against the live catalogue, including each product's minimum order. The page
    // checks the same minimums, but only this check counts.
    let bundle = null;
    if (req.body.bundle !== undefined && req.body.bundle !== '') {
      let raw = req.body.bundle;
      if (typeof raw === 'string') { try { raw = raw.length <= 8000 ? JSON.parse(raw) : null; } catch { raw = null; } }
      const r = checkBundle(raw, catalogue());
      if (r.error) return res.status(400).json({ error: r.error, ...(r.code ? { code: r.code, productId: r.productId, min: r.min } : {}) });
      bundle = r.items;
    }

    // Which team gets it: the page says so (data-line), a bundle is always
    // packaging, and a product named in the packaging catalogue is packaging even
    // when its name has no "bag" in it (pizza boxes, foil bags).
    const catalogueNames = new Set(catalogue().map((p) => p.name.toLowerCase()));
    const line = req.body.line === 'pack' || bundle || catalogueNames.has(String(product || '').toLowerCase()) ? 'pack'
      : req.body.line === 'agri' ? 'agri' : lineOfProduct(product);

    // The agriculture form's own fields: volume (MT), destination port, Incoterm and
    // shipment window (lib/enquiry.js). With a named product they can stand in for
    // the message; without one, the message must say what the buyer wants.
    let terms = null;
    if (line === 'agri') {
      const t = cleanAgriTerms(req.body);
      if (t.error) return res.status(400).json({ error: t.error, code: 'invalid_field', field: t.field });
      if (Object.keys(t.terms).length) terms = t.terms;
    }
    const named = line === 'agri' && typeof product === 'string' && !GENERIC_PRODUCT.test(product.trim());
    if (!String(message || '').trim() && !named) {
      return res.status(400).json({ error: 'Missing required fields: name, email, message' });
    }

    // Files and the studio design are only taken with a packaging request, and
    // only when the visitor ticked the box to send them.
    if (uploads.length && line !== 'pack') {
      return res.status(400).json({ error: 'Files can only be sent with a packaging request.' });
    }
    if (uploads.length && req.body.consent !== '1') {
      return res.status(400).json({ error: 'Tick the box to send your files with the request.' });
    }
    let design = null;
    if (line === 'pack' && typeof req.body.design === 'string' && req.body.design.length <= 2000) {
      try { design = cleanDesign(JSON.parse(req.body.design)); } catch { design = null; }
    }

    // The lead is saved before any email is attempted, so a mail problem never loses it.
    const rec = await recordInquiryRecord({ name, email, company, message, product, phone, design, bundle, line, terms }, false);
    let fileNote = '';
    if (rec && uploads.length) {
      const ip = clientIp(req), size = uploads.reduce((n, u) => n + (u.size || u.buffer?.length || 0), 0);
      const r = size > budgetLeft(ip) ? { saved: [], rejected: uploads.map((u) => u.originalname), full: true } : await saveIntakeFiles(rec, uploads);
      if (r.saved.length) spend(ip, size);
      await updateInquiryRecord(rec, { files: rec.files || [], ...(r.rejected.length ? { filesRejected: r.rejected.slice(0, 5) } : {}) });
      fileNote = r.saved.length ? `${r.saved.length} file${r.saved.length === 1 ? '' : 's'} attached` : '';
      if (r.rejected.length) {
        audit('inquiry_files_rejected', req, { count: r.rejected.length, full: !!r.full });
        if (!r.saved.length) {
          // tell the visitor, but the enquiry itself is in
          recordInquiry(product, req, line);
          return res.status(400).json({ error: r.full ? 'Your request is in, but the files could not be stored. Send them by email when we reply.' : 'Your request is in, but the files were not a type we accept (PDF, AI, EPS, SVG, PNG, JPG or WebP). Send them by email when we reply.', saved: true });
        }
      }
    }

    const config = loadEmailConfig();
    if (!config || !config.recipientEmail) {
      // Still capture the lead so a mail-config gap never loses a customer; the
      // admin can see it (flagged un-emailed) in the Inquiries inbox.
      recordInquiry(product, req, line);
      // saved: the visitor's request is in, so they are not told to send it again
      if (rec) return res.json({ success: true, saved: true, emailed: false, message: 'Inquiry received' });
      return res.status(500).json({ error: 'Email not configured' });
    }

    // Create HTML email with sanitized content
    const sanitizedName = sanitizeHtml(name);
    const sanitizedEmail = sanitizeHtml(email);
    const sanitizedCompany = sanitizeHtml(company);
    const sanitizedProduct = sanitizeHtml(product || 'Not specified');
    const sanitizedMessage = sanitizeHtml(message || 'No message: the details are above.').replace(/\n/g, '<br/>');
    const termRows = terms ? [
      ['Volume', terms.volumeMt != null ? `${terms.volumeMt.toLocaleString('en-US')} MT` : ''],
      ['Destination port', terms.port], ['Incoterm', terms.incoterm], ['Shipment window', terms.window],
    ].filter(([, v]) => v) : [];

    const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #39572f 0%, #2a3f20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">New Product Inquiry</h2>
      </div>
      <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #ddd;">
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Product:</strong><br/>
          ${sanitizedProduct}
        </div>
        ${termRows.map(([k, v]) => `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">${k}:</strong><br/>
          ${sanitizeHtml(v)}
        </div>`).join('')}
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Name:</strong><br/>
          ${sanitizedName}
        </div>
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Email:</strong><br/>
          <a href="mailto:${sanitizedEmail}">${sanitizedEmail}</a>
        </div>
        ${sanitizedCompany ? `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Company:</strong><br/>
          ${sanitizedCompany}
        </div>` : ''}
        <div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Message:</strong><br/>
          ${sanitizedMessage}
        </div>
        ${bundle ? `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Quote bundle:</strong>
          <table style="border-collapse: collapse; margin-top: 6px; font-size: 14px;">
            ${bundle.map((b) => `<tr>
              <td style="padding: 4px 12px 4px 0;">${sanitizeHtml(b.name)}${b.size ? `, ${sanitizeHtml(b.size)}` : ''}${b.dims ? ` <span style="color:#666">(${sanitizeHtml(b.dims)})</span>` : ''}</td>
              <td style="padding: 4px 12px 4px 0; text-align: right;">${b.qty.toLocaleString('en-US')}</td>
              <td style="padding: 4px 0; color: #666;">${b.colours === 0 ? 'plain' : b.colours ? `${b.colours} colour print` : ''}</td>
            </tr>`).join('')}
          </table>
        </div>` : ''}
        ${fileNote || design ? `<div style="margin-bottom: 15px;">
          <strong style="color: #39572f;">Design and files:</strong><br/>
          ${sanitizeHtml([design ? (design.source === 'page' ? 'Design made on the product page in 3D' : `Design from the mockup studio${design.view === '3d' ? ' (3D box)' : ''}`) : '', fileNote].filter(Boolean).join(', '))}
        </div>` : ''}
        ${rec ? `<p style="margin: 18px 0 0;"><a href="${sanitizeHtml(workspaceUrl(rec))}" style="color: #186078; font-weight: bold;">Open it in the ${line === 'pack' ? 'packaging' : 'agriculture'} workspace</a></p>` : ''}
      </div>
      <div style="background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px;">
        <p style="margin: 0;">This is an automated inquiry from Olira Agro Industry website</p>
      </div>
    </div>
  `;

    try {
      // the sales team for this line and the managers get the notification too, on blind copy
      const teamCopies = teamEmailsFor(line).filter((m) => m.toLowerCase() !== String(config.recipientEmail).toLowerCase());
      await sendEmail(config.recipientEmail, `New Product Inquiry: ${sanitizedProduct.replace(/[\u0000-\u001f\u007f]+/g, ' ')}`, htmlContent, teamCopies.length ? { bcc: teamCopies.join(', ') } : {});

      // Also send confirmation to customer
      const confirmationHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #39572f 0%, #2a3f20 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Thank You for Your Inquiry</h2>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #ddd;">
          <p>${NAME_LIKE.test(String(name).trim()) ? `Dear ${sanitizedName},` : 'Hello,'}</p>
          <p>Thank you for your interest in Olira Agro Industry products. We have received your inquiry and will get back to you within 24 hours.</p>
          <p style="margin-top: 20px;">Best regards,<br/><strong>Olira Agro Industry Team</strong></p>
        </div>
      </div>
    `;

      const thankKey = sanitizedEmail.toLowerCase();
      if (!(thankedAt.get(thankKey) > Date.now() - 86400000)) {
        if (thankedAt.size > 5000) thankedAt.clear();
        thankedAt.set(thankKey, Date.now());
        await sendEmail(sanitizedEmail, 'Thank You - Olira Agro Industry Inquiry', confirmationHtml);
      }

      if (rec) await updateInquiryRecord(rec, { emailed: true });
      recordInquiry(product, req, line); // count as a conversion, attributed to the product
      res.json({ success: true, message: 'Inquiry sent successfully' });
    } catch (error) {
      console.error('Email send error:', error);
      // Email delivery failed, but the lead is already saved (emailed: false) and
      // can be actioned from the team workspace and the manager's.
      recordInquiry(product, req, line);
      // A request that is saved has arrived, whatever the mail server did; telling
      // the visitor it failed made them send it again (a duplicate lead).
      if (rec) return res.json({ success: true, saved: true, emailed: false, message: 'Inquiry received' });
      res.status(500).json({ error: 'Failed to send inquiry. Please try again.' });
    }
  });

  // Persist a submitted inquiry so the teams can work it. The lead is captured
  // here regardless of whether the notification email is delivered, so an SMTP
  // outage never silently loses a customer (and with the database down it waits
  // in a file: lib/lead-store.js). Values are stored raw (not HTML): the staff
  // screens render them as text content, never as markup.
  async function recordInquiryRecord(data, emailed) {
    try {
      const rec = {
        id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        name: String(data.name || '').trim().slice(0, 100),
        email: String(data.email || '').trim().slice(0, 200),
        company: String(data.company || '').trim().slice(0, 100),
        product: String(data.product || '').trim().slice(0, 200),
        phone: String(data.phone || '').trim().slice(0, 40),
        message: String(data.message || '').trim().slice(0, 2000),
        line: data.line === 'pack' || data.line === 'agri' ? data.line : lineOfProduct(data.product),
        emailed: !!emailed,
        status: 'new'
      };
      if (data.design) rec.design = data.design;
      if (data.bundle?.length) rec.bundle = data.bundle;
      if (data.terms) Object.assign(rec, data.terms); // volumeMt, port, incoterm, window (lib/enquiry.js)
      return await leads.add(rec);
    } catch (err) {
      logError('inquiry_record_failed', err);
      return null;
    }
  }

  // rec: the enquiry as saved (the form's follow-up changes it before anyone else
  // has seen it, so there is nothing newer to lose)
  async function updateInquiryRecord(rec, patchFields) {
    try {
      Object.assign(rec, patchFields);
      return await leads.put(rec);
    } catch (err) {
      logError('inquiry_update_failed', err);
      return false;
    }
  }

  // The bag design a visitor made in the packaging studio, kept so the packaging
  // team can re-render it. Only known settings, in range, are stored.
  function cleanDesign(d) {
    if (!d || typeof d !== 'object') return null;
    const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');
    const numIn = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
    const faceId = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{1,16}$/.test(v) ? v : '');
    return {
      template: str(d.template, 40), templateName: str(d.templateName, 60),
      // a size id from the product's own sizes (small, medium, large for older bags)
      size: str(d.size, 30).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'medium',
      ink: ['black', 'teal', 'leaf', 'red', 'white'].includes(d.ink) ? d.ink : 'black',
      text1: str(d.text1, 18), text2: str(d.text2, 28),
      // full artwork may be moved further than a logo (up to half the panel)
      scale: numIn(d.scale, 0.5, 1.4, 1), dx: numIn(d.dx, -600, 600, 0), dy: numIn(d.dy, -1600, 1600, 0),
      oneInk: d.oneInk === true, hasLogo: d.hasLogo === true,
      // what the studio's logo check found in the file, and whether the visitor
      // removed a white box from it on the preview (the file sent is the original)
      logoCheck: ['boxed', 'light'].includes(d.logoCheck) ? d.logoCheck : '',
      boxRemoved: d.boxRemoved === true,
      // a logo and text, or the visitor's own full artwork (sent as a file) across the print area
      mode: d.mode === 'artwork' ? 'artwork' : 'brand',
      fit: d.fit === 'contain' ? 'contain' : 'cover',
      hasArtwork: d.mode === 'artwork' && d.hasArtwork === true,
      // seen as a 3D box (lib/box-styles.js) rather than the photo, and on which board
      view: d.view === '3d' ? '3d' : 'photo',
      board: d.view === '3d' && ['kraft', 'white', 'foil'].includes(d.board) ? d.board : '',
      // made on a product page's 3D view rather than in the studio: how it is printed, and on which faces
      source: d.source === 'page' ? 'page' : 'studio',
      print: ['logo', 'wrap', 'faces'].includes(d.print) ? d.print : '',
      face: faceId(d.face),
      faces: Array.isArray(d.faces) ? d.faces.map(faceId).filter(Boolean).slice(0, 8) : [],
    };
  }
}
