import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev-only: Next blocks cross-origin requests to dev assets by default (403),
  // which stops the client bundle from loading and the app from hydrating on any
  // hostname other than `localhost`. Without this, opening the app at
  // http://127.0.0.1:3000 or the LAN URL (e.g. http://192.168.0.114:3000, from a
  // phone) renders inert HTML — Privy never initialises and "Connect" silently
  // does nothing. Entries are hostnames only (no scheme, no port); `*` matches
  // one label. Adjust the LAN pattern to your subnet (the dev server prints its
  // Network URL on boot).
  allowedDevOrigins: ["127.0.0.1", "192.168.0.*"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
