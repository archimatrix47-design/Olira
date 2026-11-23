// BOX agri-catalogue: the agriculture products. The public list, the agriculture
// team's edits, their order, photos, and the facts as a spreadsheet.
import path from 'path';
import { cleanSpec } from './agri-spec.js';
import { toCsv, agriRows, agriImport } from './facts-csv.js';
import { memoryUpload, processAndSaveImage } from './image-upload.js';

export function registerAgriProducts(app, { dataDir, productImagesDir, readJsonFile, writeJsonFile, audit, roleAuth }) {
  const productsPath = path.join(dataDir, 'products.json');

  const AGRI_ONLY = 'Agriculture products are looked after by the agriculture team.';

  // Slug helper for product/cert IDs
  function makeSlug(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  // ----- PRODUCTS -----

  // GET /api/products (public)
  app.get('/api/products', (req, res) => {
    const products = readJsonFile(productsPath, []);
    res.json(products);
  });

  // POST /api/products (agriculture team) — add or update one product (matched by id)
  // Body: { product: {...} }
  const PRODUCT_IMAGE_RE = /^\/(?:uploads\/products|products\/photos|images)\/[\w.-]+(?:\/[\w.-]+)*$/;
  app.post('/api/products', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    const { product } = req.body || {};

    if (product && typeof product === 'object') {
      // Validate required fields
      if (!product.name || !product.description) {
        return res.status(400).json({ error: 'Product name and description are required' });
      }
      if (product.image != null && product.image !== '' && (typeof product.image !== 'string' || !PRODUCT_IMAGE_RE.test(product.image) || product.image.includes('..'))) {
        return res.status(400).json({ error: 'Upload the photo again.' });
      }
      const list = readJsonFile(productsPath, []);
      // an id is plain letters, digits, - and _ (anything else, an object or a path, is made from the name)
      const id = typeof product.id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(product.id) ? product.id : makeSlug(product.name);
      const idx = list.findIndex(p => p.id === id);
      const normalized = {
        id,
        name: String(product.name).slice(0, 200),
        category: String(product.category || 'General').slice(0, 50),
        description: String(product.description).slice(0, 2000),
        purity: String(product.purity || '').slice(0, 50),
        moq: String(product.moq || '').slice(0, 50),
        specs: Array.isArray(product.specs) ? product.specs.slice(0, 20).map(s => String(s).slice(0, 200)) : [],
        // the specification sheet (lib/agri-spec.js); kept as it was when the form does not send it
        spec: product.spec === undefined ? (idx >= 0 ? cleanSpec(list[idx].spec) : {}) : cleanSpec(product.spec),
        image: product.image || null
      };
      audit('product_saved', req, { id, by: req.teamUser.id });
      if (idx >= 0) list[idx] = normalized;
      else list.push(normalized);

      if (!writeJsonFile(productsPath, list)) {
        return res.status(500).json({ error: 'Failed to save product' });
      }
      return res.json({ success: true, product: normalized });
    }

    res.status(400).json({ error: 'Body must contain { product: {...} }' });
  });

  // The agriculture products' facts as a spreadsheet (lib/facts-csv.js, UX-2): the
  // purity, minimum and specification sheet of each product, downloaded and imported
  // back, previewed first and saved only when every row is acceptable.
  app.get('/api/products/facts.csv', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="olira-agriculture-facts.csv"');
    res.set('Cache-Control', 'no-store');
    res.send(toCsv(agriRows(readJsonFile(productsPath, []))));
  });
  app.post('/api/products/facts', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    const text = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!text.trim() || text.length > 300_000) return res.status(400).json({ error: 'Choose the CSV file you downloaded and filled in (up to 300 KB).' });
    const list = readJsonFile(productsPath, []);
    const r = agriImport(text, list);
    if (req.body?.apply !== true || r.errors.length || !r.changes.length) return res.json({ changes: r.changes, errors: r.errors, applied: false });
    const next = r.next.map((p) => ({ ...p, spec: cleanSpec(p.spec) }));
    if (!writeJsonFile(productsPath, next)) return res.status(500).json({ error: 'The changes could not be saved.' });
    audit('agri_facts_imported', req, { changes: r.changes.length, by: req.teamUser.id });
    res.json({ changes: r.changes, errors: [], applied: true });
  });

  // POST /api/products/order (agriculture team) — body { ids: [...] }. Reorders the
  // existing products only (unknown ids are ignored, missing ones keep their relative
  // order at the end), so a stale tab can never drop or invent a product. The first
  // product is the front card of the agriculture page's stack.
  app.post('/api/products/order', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'Body must be { ids: [string, ...] }' });
    }
    const list = readJsonFile(productsPath, []);
    const byId = new Map(list.map((p) => [p.id, p]));
    const seen = new Set();
    const ordered = [];
    for (const id of ids) {
      if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
    }
    for (const p of list) if (!seen.has(p.id)) ordered.push(p);
    if (!writeJsonFile(productsPath, ordered)) {
      return res.status(500).json({ error: 'Failed to save order' });
    }
    res.json({ success: true, ids: ordered.map((p) => p.id) });
  });

  // DELETE /api/products/:id (agriculture team)
  app.delete('/api/products/:id', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    const list = readJsonFile(productsPath, []);
    const next = list.filter(p => p.id !== req.params.id);
    if (next.length === list.length) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (!writeJsonFile(productsPath, next)) {
      return res.status(500).json({ error: 'Failed to delete' });
    }
    audit('product_deleted', req, { id: req.params.id, by: req.teamUser.id });
    res.json({ success: true });
  });

  // POST /api/upload/product-image (agriculture team) — auto-resize to 1200px WebP + 480px thumb
  app.post('/api/upload/product-image', roleAuth(['agri'], AGRI_ONLY), (req, res) => {
    memoryUpload.single('image')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      try {
        const baseName = `${makeSlug(req.body.productId || 'product')}-${Date.now()}`;
        const { fullPath, thumbPath } = await processAndSaveImage(
          req.file.buffer,
          req.file.mimetype,
          productImagesDir,
          baseName,
          { maxWidth: 1200, thumbWidth: 480 }
        );
        res.json({
          success: true,
          path: `/uploads/products/${fullPath}`,
          thumb: `/uploads/products/${thumbPath}`,
          originalSize: req.file.size
        });
      } catch (error) {
        console.error('Image processing error:', error);
        res.status(500).json({ error: 'Failed to process image' });
      }
    });
  });

  return { agriProducts: () => readJsonFile(productsPath, []) || [] };
}
