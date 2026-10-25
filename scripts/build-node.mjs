import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export async function buildNodeServer() {
  const outDir = join(ROOT, "dist");
  mkdirSync(outDir, { recursive: true });

  console.log("[Build] Building Node.js server bundle via esbuild...");
  await build({
    entryPoints: [join(ROOT, "src", "node", "server.ts")],
    bundle: true,
    format: "esm",
    target: "node18",
    platform: "node",
    outfile: join(outDir, "server.mjs"),
    external: [
      "better-sqlite3",
      "node:sqlite",
    ],
    sourcemap: true,
    logLevel: "info",
    banner: {
      js: `// CFPress Standalone Node Server Bundle (Auto-generated)\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`,
    },
  });
  console.log("[Build] Node.js server bundle generated at dist/server.mjs");
}

if (process.argv[1] && process.argv[1].endsWith("build-node.mjs")) {
  buildNodeServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
