import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/og/[id]": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
