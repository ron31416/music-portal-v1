// next-sitemap.config.js
/** @type {import('next-sitemap').IConfig} */
const isProd = process.env.VERCEL_ENV === 'production';

module.exports = {
  // Replace the fallback with your real prod domain
  siteUrl: process.env.SITE_URL || 'https://music-viewer-v2.vercel.app',
  generateRobotsTxt: true,

  // Optional: keep previews out of Google
  robotsTxtOptions: isProd
    ? {}
    : { policies: [{ userAgent: '*', disallow: '/' }] },
};
