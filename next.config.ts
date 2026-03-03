import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Type checking is handled by `tsc --noEmit` in CI.
    // next build's checker diverges from tsc on contextual typing through
    // complex intersection types, causing false positives.
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
