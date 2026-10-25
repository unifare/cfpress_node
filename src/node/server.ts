import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createD1, applyMigrations, openSQLite } from "./d1-sqlite";
import { createDrizzleClient, resolveDialect } from "../shared/db";
import { createLocalR2Bucket } from "./r2-local";
import { createMemoryKV } from "./kv-local";
import { createLocalAssets } from "./assets-local";
import { nodeToWebRequest, sendWebResponse } from "./http-adapter";
import type { Env } from "../shared/types";
// Import default fetch handler & scheduled from src/index
import appWorker from "../index";

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  dbPath?: string;
  mediaDir?: string;
  publicDir?: string;
  migrationsDir?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const root = process.cwd();
  const port = options.port ?? (process.env.CFP_PORT ? parseInt(process.env.CFP_PORT, 10) : (process.env.PORT ? parseInt(process.env.PORT, 10) : 47913));
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  const dataDir = resolve(root, options.dataDir ?? process.env.CFPRESS_DATA_DIR ?? "./data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = resolve(dataDir, options.dbPath ?? process.env.CFPRESS_DB_PATH ?? "cfpress.sqlite");
  const mediaDir = resolve(dataDir, options.mediaDir ?? process.env.CFPRESS_MEDIA_DIR ?? "uploads");
  const publicDir = resolve(root, options.publicDir ?? process.env.CFPRESS_PUBLIC_DIR ?? "public");
  const migrationsDir = resolve(root, options.migrationsDir ?? process.env.CFPRESS_MIGRATIONS_DIR ?? "content/migrations");

  console.log(`[CFPress] Initializing SQLite database at: ${dbPath}`);
  const sqlite = openSQLite(dbPath);
  const d1 = createD1(sqlite);

  console.log(`[CFPress] Applying database migrations from: ${migrationsDir}`);
  await applyMigrations(d1, migrationsDir);

  // Seed default site media policy (public / site isolation) so previews and front-end images resolve
  try {
    sqlite.prepare(
      "INSERT OR IGNORE INTO settings (id, site_id, key, value, autoload) VALUES ('setting-default-media', 'default', 'cfpress.media', ?, 1)"
    ).run(JSON.stringify({ provider: "r2", require_session: false, isolation: "site" }));
  } catch {}

  const r2 = createLocalR2Bucket(mediaDir);
  const kv = createMemoryKV();
  const assets = createLocalAssets(publicDir);

  const env: Env = {
    DB: d1 as any,
    db: createDrizzleClient(d1 as any),
    DB_DIALECT: resolveDialect({ DB_DIALECT: process.env.CFPRESS_DB_DIALECT }),
    MEDIA: r2 as any,
    CACHE: kv as any,
    ASSETS: assets as any,
    CFPRESS_CACHE_MIRROR_KV: process.env.CFPRESS_CACHE_MIRROR_KV ?? "false",
    CFPRESS_UI_LOCALE_FOLLOW_SITE: process.env.CFPRESS_UI_LOCALE_FOLLOW_SITE ?? "false",
    IMGBB_API_KEY: process.env.IMGBB_API_KEY,
    POSTIMAGES_API_KEY: process.env.POSTIMAGES_API_KEY,
  };

  const ctx = {
    waitUntil(promise: Promise<any>) {
      promise.catch((err) => console.error("[CFPress Background Task Error]", err));
    },
    passThroughOnException() {},
  };

  const server = createServer(async (req, res) => {
    try {
      const webReq = nodeToWebRequest(req);
      const webRes = await appWorker.fetch(webReq, env, ctx);
      await sendWebResponse(webRes, res);
    } catch (err: any) {
      console.error("[CFPress Request Error]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Internal Server Error: " + (err?.message || "Unknown error"));
      }
    }
  });

  // Scheduled background tasks (cron triggers every 5 minutes by default)
  const cronIntervalMs = 5 * 60 * 1000;
  const cronTimer = setInterval(() => {
    appWorker.scheduled(
      { cron: ["*", "/5 * * * *"].join(""), scheduledTime: Date.now() } as any,
      env,
      ctx
    ).catch((err) => console.error("[CFPress Scheduled Task Error]", err));
  }, cronIntervalMs);

  server.listen(port, host, () => {
    console.log(`[CFPress] Server running on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`[CFPress] Admin UI available at: http://${host === "0.0.0.0" ? "localhost" : host}:${port}/admin`);
  });

  const stop = async () => {
    clearInterval(cronTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    d1.close();
  };

  const shutdown = async () => {
    console.log("\n[CFPress] Shutting down server...");
    await stop();
    console.log("[CFPress] Server stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    server,
    stop,
    d1,
    env,
  };
}
