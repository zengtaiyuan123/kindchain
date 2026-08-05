// Generates wrangler.generated.jsonc for standalone Cloudflare deployment.
// D1 database id is injected via the D1_DATABASE_ID environment variable
// (resolved by the deploy workflow through the Cloudflare REST API).
import { writeFileSync } from "node:fs";

const databaseId = process.env.D1_DATABASE_ID;
if (!databaseId) {
  console.error("D1_DATABASE_ID is required");
  process.exit(1);
}

const config = {
  name: "kindchain-living-earth",
  main: "dist/server/index.js",
  compatibility_date: "2026-07-01",
  compatibility_flags: ["nodejs_compat"],
  assets: { directory: "dist/client", binding: "ASSETS" },
  d1_databases: [
    { binding: "DB", database_name: "kindchain-network", database_id: databaseId },
  ],
  observability: { enabled: true },
};

writeFileSync("wrangler.generated.jsonc", JSON.stringify(config, null, 2));
console.log("wrote wrangler.generated.jsonc (D1:", databaseId.slice(0, 8) + "…)");
