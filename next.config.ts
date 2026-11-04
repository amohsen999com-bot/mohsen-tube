import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The SQLite catalog is opened by path at runtime, so tell the bundler to ship it with the API functions
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/mohsen.db"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
};

export default nextConfig;
