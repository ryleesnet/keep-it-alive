import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["deso-protocol"],
};

module.exports = {
  allowedDevOrigins: ['10.150.3.245'],
}

export default nextConfig;
