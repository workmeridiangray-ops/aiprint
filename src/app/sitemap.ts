import type { MetadataRoute } from 'next';
import { SITE_PAGES } from '@/lib/site';
export default function sitemap(): MetadataRoute.Sitemap { const base = process.env.APP_URL ?? 'http://localhost:3000'; return SITE_PAGES.map(p => ({ url: base + (p === '/' ? '' : p) })); }
