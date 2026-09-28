import type { NextConfig } from "next";
import path from "node:path";

// The app imports the map code from the repository's lib/ (LeadIndex, clustering,
// review validation), so the workspace root is the repository, not web/.
const repositoryRoot = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  outputFileTracingRoot: repositoryRoot,
  // The map page is ui/map.html, copied next to the app by scripts/copy-ui.mjs.
  outputFileTracingIncludes: { "/map": ["./generated/map.html"] },
  // The app opens on the Leads table (operator, 2026-09-28); the query string carries
  // over, so an old map link with filters opens the same selection as a table.
  redirects: async () => [{ source: "/", destination: "/leads", permanent: false }],
  turbopack: { root: repositoryRoot },
};

export default nextConfig;
