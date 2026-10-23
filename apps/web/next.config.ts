import type { NextConfig } from "next";

const apiTarget = process.env.CLOUDROUTE_API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: apiTarget + "/v1/:path*" }];
  },
};

export default nextConfig;
