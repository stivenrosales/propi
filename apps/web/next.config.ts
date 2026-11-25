import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // pnpm workspace: trace dependencies from the monorepo root.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  // Do not write an AGENTS.md into the app on `next dev`.
  agentRules: false,
  devIndicators: false,
  // The workspace packages ship TypeScript sources (with .ts import extensions).
  transpilePackages: ["@propi/core", "@propi/app", "@propi/db"],
  // node-postgres and the Prisma runtime stay as Node modules on the server.
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "@prisma/client"],
  // PostHog reverse proxy (see src/components/analytics.tsx).
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
};

export default nextConfig;
