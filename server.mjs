#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, "dist", "server.mjs");

// Auto-build bundle if not present
if (!existsSync(bundlePath)) {
  console.log("[CFPress] Server bundle not found. Building first...");
  const { buildNodeServer } = await import("./scripts/build-node.mjs");
  await buildNodeServer();
}

const { startServer } = await import("./dist/server.mjs");
startServer().catch((err) => {
  console.error("[CFPress] Fatal startup error:", err);
  process.exit(1);
});
