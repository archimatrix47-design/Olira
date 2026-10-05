// The sitemap, built with the pages: every public page and product page, the
// date it was built, and each product's picture (Google and Bing read both).
import type { APIRoute } from 'astro';
import { SITE, products, packagingProducts } from '../lib/site-data';
import { agriUrl, packUrl } from '../lib/seo';
import { cutoutOf } from '../scripts/catalogue-panel.js';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = () => {
  const today = new Date().toISOString().slice(0, 10);
  const pages: { loc: string; priority: string; images?: { loc: string; title: string }[] }[] = [
    { loc: '/', priority: '1.0', images: [{ loc: '/og-home.jpg', title: 'Olira Agro Industry' }] },
    { loc: '/agriculture/', priority: '0.9', images: products.filter((p) => p.image).map((p) => ({ loc: p.image!, title: p.name })) },
    { loc: '/packaging/', priority: '0.9', images: packagingProducts.filter((p) => p.image).map((p) => ({ loc: cutoutOf(p)?.cutout || p.image!, title: p.name })) },
    ...products.map((p) => ({ loc: agriUrl(p), priority: '0.7', images: p.image ? [{ loc: p.image, title: p.name }] : [] })),
    ...packagingProducts.map((p) => ({ loc: packUrl(p), priority: '0.7', images: p.image ? [{ loc: cutoutOf(p)?.cutout || p.image, title: p.name }] : [] })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${pages.map((p) => `  <url>
    <loc>${esc(SITE + p.loc)}</loc>
    <lastmod>${today}</lastmod>
    <priority>${p.priority}</priority>${(p.images || []).map((i) => `
    <image:image><image:loc>${esc(SITE + i.loc)}</image:loc><image:title>${esc(i.title)}</image:title></image:image>`).join('')}
  </url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
