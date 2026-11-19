import type { NextConfig } from "next";

// Internal display: kept out of search engines and out of other sites' frames.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://accounts.google.com",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The local-data fallback reads the CSVs and images at runtime.
  outputFileTracingIncludes: { "/api/**": ["./sheet-template/**"] },
  async rewrites() {
    // The TV page is a static file (public/tv/), served at the root.
    return [{ source: "/", destination: "/tv/index.html" }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/tv/:file*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
