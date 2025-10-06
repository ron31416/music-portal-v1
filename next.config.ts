import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,

  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];

    if (isProd) {
      base.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/(.*)", headers: base }];
  },

  // NEW: canonicalize www → apex (does not affect other subdomains)
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.ronsmusicstore.com" }],
        destination: "https://ronsmusicstore.com/:path*",
        permanent: true, // 308
      },
    ];
  },
};

export default nextConfig;
