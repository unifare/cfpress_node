/**
 * Drizzle ORM & Multi-Dialect Database Layer Test Suite
 *
 * Verifies:
 * 1. Every table and column in `PLATFORM_DRIZZLE_TABLES` (`src/shared/db/schema.ts`)
 *    executes a real `SELECT` against the migrated SQLite schema (`content/migrations/`),
 *    proving 100% column-level parity across all 52 platform tables.
 * 2. Drizzle ORM CRUD & upsert operations across `cache.ts`, `repo.ts`,
 *    `revisions.ts`, `d1-store.ts`, `api-keys.ts`, and `tables.ts`.
 * 3. Multi-dialect dynamic DDL (`sqlite`, `postgres`, `mysql`) for extension
 *    tables (`theme_{owner}_{table}`) and `_i18n` sidecars.
 * 4. Multi-dialect SQL placeholder normalization (`?` -> `$1, $2, ...` for PostgreSQL)
 *    and async driver adapters (`createPostgresExecutor`, `createMysqlExecutor`,
 *    `createAsyncDatabaseAdapter`).
 *
 * Usage: node tests/suites/drizzle-orm.test.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { applyMigrations } from "../tools/_apply-migrations.mjs";
import { PLATFORM_SCHEMA } from "../../src/extensions/contract/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const require = createRequire(pathToFileURL(join(root, "package.json")).href);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(
      `  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`
    );
  }
}

function checkTruthy(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──────────────────────────────────────────`);
}

let finished = false;
function summary(tag = "", extraFailures = 0) {
  if (finished) return;
  finished = true;
  const total = fail + extraFailures;
  console.log(`\n${pass} passed, ${total} failed${tag}`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  process.exit(total > 0 ? 1 : 0);
}

process.on("uncaughtException", (e) => {
  console.error("\nSUITE ERROR:", (e && e.stack) || e);
  summary(" (aborted)", 1);
});
process.on("unhandledRejection", (e) => {
  console.error("\nSUITE ERROR (unhandled rejection):", (e && e.stack) || e);
  summary(" (aborted)", 1);
});

function makeD1(sqlite) {
  return {
    prepare(sql) {
      const st = { sql, params: [] };
      const api = {
        bind(...a) {
          st.params = a.length === 1 && Array.isArray(a[0]) ? [...a[0]] : [...a];
          return api;
        },
        async first(col) {
          const r = sqlite.prepare(st.sql).get(...st.params);
          return col !== undefined && r ? r[col] : (r ?? null);
        },
        async all() {
          const rows = sqlite.prepare(st.sql).all(...st.params);
          return { results: rows ?? [], success: true, meta: {} };
        },
        async run() {
          const res = sqlite.prepare(st.sql).run(...st.params);
          return {
            success: true,
            meta: { changes: Number(res.changes || 0), last_row_id: Number(res.lastInsertRowid || 0) },
          };
        },
      };
      return api;
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}

function makeKV() {
  const map = new Map();
  return {
    async get(k) {
      return map.get(k) ?? null;
    },
    async put(k, v) {
      map.set(k, String(v));
    },
    async delete(k) {
      map.delete(k);
    },
  };
}

async function bundleEntry(relEntry, outName) {
  const esbuild = require("esbuild");
  const out = await esbuild.build({
    entryPoints: [join(root, relEntry)],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    platform: "neutral",
    logLevel: "silent",
  });
  const tmp = join(root, "dist", ".test-bundles", outName);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href + "?t=" + Date.now());
}

async function main() {
  const sqlite = new DatabaseSync(":memory:");
  const report = applyMigrations(sqlite, join(root, "content", "migrations"));
  const migrationErrors = report.flatMap((r) => r.errors);

  const dbMod = await bundleEntry("src/shared/db/index.ts", "drizzle-db-bundle.mjs");
  const cacheMod = await bundleEntry("src/shared/cache.ts", "drizzle-cache-bundle.mjs");
  const repoMod = await bundleEntry("src/shared/repo.ts", "drizzle-repo-bundle.mjs");
  const revMod = await bundleEntry("src/platform/revisions.ts", "drizzle-rev-bundle.mjs");
  const d1StoreMod = await bundleEntry("src/extensions/theme/d1-store.ts", "drizzle-d1store-bundle.mjs");
  const tablesMod = await bundleEntry("src/extensions/theme/tables.ts", "drizzle-tables-bundle.mjs");
  const apiKeysMod = await bundleEntry("src/platform/api-keys.ts", "drizzle-apikeys-bundle.mjs");

  const d1 = makeD1(sqlite);
  const env = {
    DB: d1,
    db: dbMod.createDrizzleClient(d1),
    CACHE: makeKV(),
  };

  // ── 1. Column-level schema parity across all 52 platform tables ───────────
  section("1. Drizzle ORM Schema Parity Across All 52 Platform Tables");
  check("all migrations applied cleanly", migrationErrors.length, 0);

  const drizzleTables = dbMod.PLATFORM_DRIZZLE_TABLES;
  const tableNames = Object.keys(drizzleTables).sort();
  const schemaNames = PLATFORM_SCHEMA.map((t) => t.table).sort();
  check("PLATFORM_DRIZZLE_TABLES count matches PLATFORM_SCHEMA (52)", tableNames.length, schemaNames.length);
  check("PLATFORM_DRIZZLE_TABLES keys match PLATFORM_SCHEMA exactly", tableNames, schemaNames);

  const selectFailures = [];
  for (const [name, tbl] of Object.entries(drizzleTables)) {
    try {
      const rows = await dbMod.getDb(env).select().from(tbl).limit(1).all();
      if (!Array.isArray(rows)) {
        selectFailures.push(`${name}: result is not an array`);
      }
    } catch (err) {
      selectFailures.push(`${name}: ${err?.message || err}`);
    }
  }
  check("every PLATFORM_DRIZZLE_TABLES entry executes SELECT against migrated SQLite", selectFailures, []);

  // ── 2. Drizzle ORM CRUD & Upsert Operations ───────────────────────────────
  section("2. Drizzle ORM Operations in Core Modules");

  // 2a. cache.ts (`contentCacheVersions`)
  const v0 = await cacheMod.cacheVersion(env, "default");
  check("initial cacheVersion defaults to '1'", v0, "1");
  const bumped1 = await cacheMod.bumpContentCache(env, "default");
  check("first bumpContentCache returns 2", bumped1, 2);
  const bumped2 = await cacheMod.bumpContentCache(env, "default");
  check("second bumpContentCache upserts to 3", bumped2, 3);
  const vAfter = await cacheMod.cacheVersion(env, "default");
  check("cacheVersion reads bumped version '3' via Drizzle", vAfter, "3");

  // 2b. repo.ts (`adminActivity`)
  await repoMod.activity(env, "u_admin", "test.action", "post", "p_1", { note: "drizzle" }, "127.0.0.1");
  const actRow = await dbMod
    .getDb(env)
    .select()
    .from(dbMod.adminActivity)
    .where(dbMod.eq(dbMod.adminActivity.action, "test.action"))
    .get();
  check("activity() inserts row via Drizzle", actRow?.entity_id, "p_1");
  check("activity() stores ip column via Drizzle", actRow?.ip, "127.0.0.1");

  // 2c. revisions.ts (`postRevisions` & `postAutosaves`)
  const rev1 = await revMod.createRevision(env, "post_1", "u_admin", "en", "Title v1", "Excerpt v1", "Body v1");
  const rev2 = await revMod.createRevision(env, "post_1", "u_admin", "en", "Title v2", "Excerpt v2", "Body v2");
  check("createRevision increments version (1 -> 2)", [rev1, rev2], [1, 2]);

  await revMod.autosave(env, "post_1", "u_admin", "en", { title: "Draft A", excerpt: "Ex A", content: "Body A" });
  await revMod.autosave(env, "post_1", "u_admin", "en", { title: "Draft B", excerpt: "Ex B", content: "Body B" });
  const autoRow = await dbMod
    .getDb(env)
    .select()
    .from(dbMod.postAutosaves)
    .where(dbMod.eq(dbMod.postAutosaves.post_id, "post_1"))
    .get();
  check("autosave upserts on (post_id, user_id, locale) via Drizzle", autoRow?.title, "Draft B");

  // 2d. d1-store.ts (`themeFiles` & `platformSettings`)
  const maxBytes = await d1StoreMod.getMaxBinarySizeLimitBytes(env);
  check("getMaxBinarySizeLimitBytes defaults to 512 KB", maxBytes, 512 * 1024);

  const tplBytes = new TextEncoder().encode("<h1>Hello Drizzle</h1>");
  await d1StoreMod.saveThemeFileToD1(env, "custom-theme", "1.0.0", "templates/index.html", tplBytes, maxBytes);
  check("hasThemeFilesInD1 returns true after save", await d1StoreMod.hasThemeFilesInD1(env, "custom-theme"), true);
  check(
    "getThemeFileTextFromD1 reads template via Drizzle",
    await d1StoreMod.getThemeFileTextFromD1(env, "custom-theme", "templates/index.html"),
    "<h1>Hello Drizzle</h1>"
  );
  const entry = await d1StoreMod.getThemeFileEntryFromD1(env, "custom-theme", "templates/index.html");
  check("getThemeFileEntryFromD1 returns size and contentType", entry?.size, tplBytes.byteLength);
  const fileList = await d1StoreMod.listThemeFilesFromD1(env, "custom-theme");
  check("listThemeFilesFromD1 lists saved file", fileList.map((f) => f.path), ["templates/index.html"]);
  await d1StoreMod.deleteThemeFilesFromD1(env, "custom-theme");
  check("hasThemeFilesInD1 returns false after delete", await d1StoreMod.hasThemeFilesInD1(env, "custom-theme"), false);

  // 2e. api-keys.ts (`apiKeys`)
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO site_users (id, username, email, password_hash, role, status, created_at, updated_at) VALUES ('u_ak', 'akuser', 'ak@example.com', 'hash', 'admin', 'active', 1, 1)"
    )
    .run();
  const createdKey = await apiKeysMod.createApiKey(env, "u_ak", "Drizzle Test Key", ["*"], ["default"], 7);
  checkTruthy("createApiKey mints cfp_live_ token", createdKey.token.startsWith("cfp_live_"));
  const listedKeys = await apiKeysMod.listApiKeys(env, "u_ak", "active");
  check("listApiKeys returns created key via Drizzle", listedKeys.length, 1);
  check("listApiKeys matches created key name", listedKeys[0]?.name, "Drizzle Test Key");
  const authedUser = await apiKeysMod.authenticateApiKey(env, createdKey.token);
  check("authenticateApiKey resolves active user", authedUser?.id, "u_ak");
  const revoked = await apiKeysMod.revokeApiKey(env, createdKey.id, "u_ak");
  check("revokeApiKey revokes key via Drizzle", revoked, true);
  const afterRevoke = await apiKeysMod.authenticateApiKey(env, createdKey.token);
  check("authenticateApiKey rejects revoked key", afterRevoke, null);

  // 2f. tables.ts (`syncOwnerTables`, `listOwnerTableDefs`, `resolveOwnerTable`)
  const synced = await tablesMod.syncOwnerTables(
    env,
    "theme",
    "catalog",
    {
      tables: [
        {
          name: "item",
          translatable: ["title"],
          fields: [
            { key: "title", type: "text", required: true },
            { key: "price", type: "number" },
          ],
        },
      ],
    },
    "default"
  );
  check("syncOwnerTables creates theme_catalog_item", synced[0]?.table, "theme_catalog_item");
  const ownerDefs = await tablesMod.listOwnerTableDefs(env, "default", { type: "theme", name: "catalog" });
  check("listOwnerTableDefs reads registry via Drizzle", ownerDefs.length, 1);
  check("listOwnerTableDefs hydrates translatable array", ownerDefs[0]?.translatable, ["title"]);
  const resolvedDef = await tablesMod.resolveOwnerTable(env, "default", "theme", "catalog", "item");
  check("resolveOwnerTable resolves table_name via Drizzle", resolvedDef?.table_name, "theme_catalog_item");

  // ── 3. Multi-Dialect Dynamic DDL (`sqlite`, `postgres`, `mysql`) ──────────
  section("3. Multi-Dialect Dynamic DDL Generation");

  check("resolveDialect defaults to sqlite", dbMod.resolveDialect({}), "sqlite");
  check("resolveDialect maps postgresql -> postgres", dbMod.resolveDialect({ DB_DIALECT: "postgresql" }), "postgres");
  check("resolveDialect maps mariadb -> mysql", dbMod.resolveDialect({ DB_DIALECT: "mariadb" }), "mysql");

  const sampleFields = [
    { key: "title", type: "text" },
    { key: "body", type: "longtext" },
    { key: "price", type: "number" },
    { key: "featured", type: "boolean" },
    { key: "published_on", type: "date" },
    { key: " synced_at", type: "datetime" }.key ? { key: "synced_at", type: "datetime" } : { key: "synced_at", type: "datetime" },
  ];

  const sqliteDdl = dbMod.mainTableDdl("theme_shop_item", sampleFields, "sqlite");
  const pgDdl = dbMod.mainTableDdl("theme_shop_item", sampleFields, "postgres");
  const mysqlDdl = dbMod.mainTableDdl("theme_shop_item", sampleFields, "mysql");

  checkTruthy("SQLite DDL uses REAL and INTEGER", sqliteDdl.includes("price REAL") && sqliteDdl.includes("created_at INTEGER"));
  checkTruthy(
    "Postgres DDL uses DOUBLE PRECISION and BIGINT",
    pgDdl.includes("price DOUBLE PRECISION") && pgDdl.includes("created_at BIGINT")
  );
  checkTruthy(
    "MySQL DDL uses VARCHAR(191), LONGTEXT, DOUBLE, TINYINT(1)",
    mysqlDdl.includes("id VARCHAR(191) PRIMARY KEY") &&
      mysqlDdl.includes("body LONGTEXT") &&
      mysqlDdl.includes("price DOUBLE") &&
      mysqlDdl.includes("featured TINYINT(1)")
  );

  const mysqlI18nDdl = dbMod.i18nTableDdl("theme_shop_item_i18n", ["title", "body"], "mysql");
  checkTruthy(
    "MySQL i18n DDL uses VARCHAR(191) PK columns and LONGTEXT prose columns",
    mysqlI18nDdl.includes("row_id VARCHAR(191) NOT NULL") && mysqlI18nDdl.includes("title LONGTEXT")
  );

  // ── 4. Multi-Dialect Placeholder Normalization & Async Driver Adapter ─────
  section("4. Multi-Dialect SQL Placeholder Normalization & Driver Adapter");

  const rawSql = `SELECT * FROM posts WHERE site_id = ? AND title = 'What? ''?' AND "col?" = ? -- comment ?\n AND status = ?`;
  const pgSql = dbMod.normalizeSqlPlaceholders(rawSql, "postgres");
  check(
    "Postgres placeholder normalizer converts only real bind parameters to $1, $2, $3",
    pgSql,
    `SELECT * FROM posts WHERE site_id = $1 AND title = 'What? ''?' AND "col?" = $2 -- comment ?\n AND status = $3`
  );
  check(
    "SQLite placeholder normalizer leaves SQL unchanged",
    dbMod.normalizeSqlPlaceholders(rawSql, "sqlite"),
    rawSql
  );

  // Simulate a PostgreSQL pool (`query(text, values)`) backed by our in-memory SQLite
  const pgCaptured = [];
  const fakePgPool = {
    async query(text, values = []) {
      pgCaptured.push({ text, values });
      // Convert $1, $2 back to ? to execute against in-memory SQLite
      const sqliteText = text.replace(/\$\d+/g, "?");
      const isSelect = /^\s*select\b/i.test(sqliteText);
      if (isSelect) {
        const rows = sqlite.prepare(sqliteText).all(...values);
        return { rows, rowCount: rows.length };
      }
      const res = sqlite.prepare(sqliteText).run(...values);
      return { rows: [], rowCount: Number(res.changes || 0) };
    },
  };

  const pgExecutor = dbMod.createPostgresExecutor(fakePgPool);
  const pgAdapter = dbMod.createAsyncDatabaseAdapter(pgExecutor, "postgres");
  const pgDrizzle = dbMod.createDrizzleClient(pgAdapter);

  const pgSites = await pgDrizzle
    .select({ id: dbMod.sites.id, name: dbMod.sites.name })
    .from(dbMod.sites)
    .where(dbMod.eq(dbMod.sites.id, "default"))
    .all();

  check("Drizzle over Postgres adapter returns default site", pgSites.length, 1);
  checkTruthy(
    "Postgres executor received $1 placeholder instead of ?",
    pgCaptured.length > 0 && pgCaptured[0].text.includes("$1") && !pgCaptured[0].text.includes("?")
  );

  summary();
}

main().catch((e) => {
  console.error("\nSUITE ERROR:", (e && e.stack) || e);
  summary(" (aborted)", 1);
});
