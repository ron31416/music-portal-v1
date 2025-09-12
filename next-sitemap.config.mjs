// next-sitemap.config.mjs
export default {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  generateRobotsTxt: true,
  robotsTxtOptions: { policies: [{ userAgent: "*", allow: "/" }] },
};
