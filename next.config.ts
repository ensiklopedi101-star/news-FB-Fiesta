import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Edge TTS opens a WebSocket from Node; keeping it external lets Next trace
  // `ws` and friends instead of trying to bundle a socket client.
  serverExternalPackages: ["msedge-tts"],
  outputFileTracingIncludes: {
    "/api/og/[id]": ["./assets/fonts/**/*", "./public/brand/*.png"],
  },
};

export default nextConfig;
