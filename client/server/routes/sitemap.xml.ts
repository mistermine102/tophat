// /sitemap.xml (prerendered by `nuxt generate`, nuxt.config.ts): the home page and the text pages (src/guides.ts).
import { defineEventHandler, setHeader } from 'h3';
import { ABOUT, GUIDES } from '../../src/guides';
import { SITE_URL } from '../../src/site';

export default defineEventHandler((event) => {
  const paths = ['/', ...GUIDES.map((g) => g.path), ABOUT.path];
  const urls = paths.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n');
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
});
