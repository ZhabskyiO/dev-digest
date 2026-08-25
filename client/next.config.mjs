import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The vendored @devdigest/shared uses ESM-style `./x.js` specifiers that
  // resolve to `.ts` sources (matching the server, which runs it under tsx).
  // TypeScript handles that mapping for `import type`, but the first RUNTIME
  // import (a Zod schema in a component) makes webpack resolve the real module
  // graph — teach it the same .js → .ts mapping.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
};

export default withNextIntl(nextConfig);
