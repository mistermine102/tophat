// Where the public site lives (canonical URLs, sitemap, link previews). Env SITE_URL overrides it for another host.
export const SITE_URL = (process.env.SITE_URL ?? 'https://tophat.pro').replace(/\/$/, '');
export const SITE_NAME = 'Tophat';
