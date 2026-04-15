import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  images: {
    // Allow Next.js image optimiser to process our local R2 proxy routes
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        pathname: "/api/**",
      },
      {
        protocol: "https",
        hostname: "**",
        pathname: "/api/**",
      },
    ],
    // Serve thumbnails at these widths — keeps the lot grid fast
    deviceSizes: [640, 1080, 1920],
    imageSizes: [64, 128, 256, 384],
  },
};

export default nextConfig;
