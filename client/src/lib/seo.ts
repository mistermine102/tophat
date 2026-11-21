// Head tags of a page: title, description, canonical URL and the link preview (Open Graph / Twitter card).
import { useHead, useRuntimeConfig, useSeoMeta } from '#imports';
import { SITE_NAME } from '../site';

export function usePageSeo(p: { title: string; description: string; path: string; fullTitle?: boolean }) {
  const site = useRuntimeConfig().public.siteUrl as string;
  const url = `${site}${p.path === '/' ? '/' : p.path}`;
  const title = p.fullTitle ? p.title : `${p.title} · ${SITE_NAME}`;
  const image = `${site}/og.png`;
  useHead({ title, link: [{ rel: 'canonical', href: url }] });
  useSeoMeta({
    description: p.description,
    ogType: 'website',
    ogSiteName: SITE_NAME,
    ogTitle: title,
    ogDescription: p.description,
    ogUrl: url,
    ogImage: image,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: p.description,
    twitterImage: image,
  });
}
