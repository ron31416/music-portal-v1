/** @type {import('next-sitemap').IConfig} */
const isProd = process.env.VERCEL_ENV === 'production';
const siteUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

module.exports = {
  siteUrl,
  generateRobotsTxt: isProd,         // only generate robots.txt in Production
  exclude: ['/api/*'],
  // On Preview, if a robots is generated for any reason, disallow crawling
  robotsTxtOptions: isProd
    ? { policies: [{ userAgent: '*', allow: '/' }] }
    : { policies: [{ userAgent: '*', disallow: '/' }] },
};
