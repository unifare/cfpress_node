/**
 * Theme template and asset management test suite:
 * - Listing files for bundled and custom themes
 * - Reading template & asset files
 * - Copying (duplicating) a theme into a new custom theme
 * - Writing/updating custom theme files
 * - Exporting a theme to ZIP
 * - Deleting custom theme files and clean uninstallation
 *
 * Usage: node tests/suites/theme-assets.test.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { zipSync, unzipSync } from "fflate";
import { assetsStub } from "../fixtures/_assets-stub.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const require = createRequire(pathToFileURL(join(root, "package.json")));

let pass = 0, fail = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else {
    fail++; failures.push(name);
    console.log(`  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
  }
}
function checkTruthy(name, v, detail = "") {
  if (v) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
function section(title) { console.log(`\n── ${title} ──────────────────────────────────────────`); }

async function compileWorker() {
  const esbuild = require("esbuild");
  const out = await esbuild.build({
    entryPoints: [join(root, "src/index.ts")],
    bundle: true, format: "esm", target: "es2022", write: false,
    platform: "neutral", logLevel: "silent",
  });
  const tmp = join(root, "dist", ".test-bundles", "theme-assets-bundle.mjs");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href + "?t=" + Date.now());
}

function makeD1(sqlite) {
  return {
    prepare(sql) {
      const st = { sql, params: [] };
      const api = {
        bind(...a) { st.params = a; return api; },
        async first(c) {
          const r = sqlite.prepare(st.sql).get(...st.params);
          return c !== undefined && r ? r[c] : (r ?? null);
        },
        async all() {
          const rows = sqlite.prepare(st.sql).all(...st.params);
          return { results: rows ?? [] };
        },
        async run() {
          const res = sqlite.prepare(st.sql).run(...st.params);
          return { success: true, meta: { changes: res.changes } };
        },
      };
      return api;
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}

function makeR2() {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        text: async () => new TextDecoder().decode(entry.bytes),
        arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength),
        size: entry.bytes.byteLength,
        customMetadata: entry.customMetadata,
      };
    },
    async put(key, body, opts) {
      let bytes;
      if (typeof body === "string") bytes = new TextEncoder().encode(body);
      else if (body instanceof Uint8Array) bytes = body;
      else if (body?.stream) {
        const chunks = [];
        const reader = body.stream().getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
        bytes = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
      } else if (body instanceof ArrayBuffer) {
        bytes = new Uint8Array(body);
      } else {
        bytes = new Uint8Array(0);
      }
      store.set(key, { bytes, customMetadata: opts?.customMetadata });
      return { key, size: bytes.byteLength };
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const objects = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix)) {
          objects.push({ key: k, size: v.bytes.byteLength });
        }
      }
      return { objects, truncated: false };
    },
  };
}

function makeKV() {
  const map = new Map();
  return {
    async get(k) { return map.get(k) ?? null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
  };
}

async function main() {
  const d1Dir = join(root, "data");
  if (!existsSync(d1Dir)) { console.error("Local D1 not found."); process.exit(2); }
  const files = readdirSync(d1Dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) { console.error("Local D1 sqlite not found."); process.exit(2); }
  const sqlite = new DatabaseSync(join(d1Dir, files[0]));
  const d1 = makeD1(sqlite);
  const r2 = makeR2();
  const kv = makeKV();
  const worker = await compileWorker();

  const env = {
    DB: d1,
    MEDIA: r2,
    CACHE: kv,
    ASSETS: assetsStub(),
  };

  function cleanup() {
    sqlite.prepare("DELETE FROM admin_sessions WHERE id='sess_admin_test_token'").run();
    sqlite.prepare("DELETE FROM site_users WHERE id='user_super'").run();
    sqlite.prepare("DELETE FROM theme_installs WHERE name IN ('mobai-custom', 'd1-test-theme', 'grand-resort-test', 'grand-resort-copy')").run();
    sqlite.prepare("DELETE FROM extension_versions WHERE extension_name IN ('mobai-custom', 'd1-test-theme', 'grand-resort-test', 'grand-resort-copy')").run();
    sqlite.prepare("DELETE FROM theme_files WHERE theme_name IN ('mobai-custom', 'd1-test-theme', 'grand-resort-test', 'grand-resort-copy')").run();
    sqlite.prepare("DELETE FROM platform_settings WHERE key='theme.max_binary_size_kb'").run();
  }
  cleanup();

  // Seed admin user and session
  const adminId = "user_super";
  sqlite.prepare(
    "INSERT INTO site_users (id, username, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(adminId, "superadmin", "super@example.com", "hash", "superadmin", "active", 1000, 1000);
  const sessionId = "sess_admin_test_token";
  sqlite.prepare(
    "INSERT INTO admin_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, adminId, Math.floor(Date.now() / 1000) + 86400, 1000);

  // Helper for authed API calls
  async function callApi(path, method = "GET", body = null) {
    const headers = {
      Cookie: `cfpress_admin=${sessionId}`,
    };
    let reqBody;
    if (body instanceof FormData) {
      reqBody = body;
    } else if (body !== null && typeof body === "object") {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
    const req = new Request(`http://127.0.0.1/api/v1/${path}`, {
      method,
      headers,
      body: reqBody,
    });
    return worker.default.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
  }

  section("1. List bundled theme files");
  {
    const res = await callApi("extensions/themes/default/files");
    check("status is 200", res.status, 200);
    const data = await res.json();
    check("theme name is default", data.theme, "default");
    check("bundled is true", data.bundled, true);
    checkTruthy("contains files array", Array.isArray(data.files) && data.files.length > 0);
    const paths = data.files.map((f) => f.path);
    checkTruthy("contains theme.json", paths.includes("theme.json"));
    checkTruthy("contains templates/home.html", paths.includes("templates/home.html"));
    checkTruthy("contains templates/parts/header.html", paths.includes("templates/parts/header.html"));
    checkTruthy("contains langs/zh-CN.json", paths.includes("langs/zh-CN.json"));
    checkTruthy("all files marked readonly", data.files.every((f) => f.readonly === true));
  }

  section("2. Read bundled theme file");
  {
    const res = await callApi("extensions/themes/default/file?path=templates/home.html");
    check("read status is 200", res.status, 200);
    const data = await res.json();
    check("file path matches", data.path, "templates/home.html");
    check("readonly is true", data.readonly, true);
    checkTruthy("content contains HTML", typeof data.content === "string" && data.content.length > 50);
  }

  section("3. Write to bundled theme is refused");
  {
    const res = await callApi("extensions/themes/default/file", "PUT", {
      path: "templates/home.html",
      content: "<h1>Hacked</h1>",
    });
    check("refused with 400", res.status, 400);
    const data = await res.json();
    checkTruthy("error explains bundled is read-only", data.error?.includes("read-only"));
  }

  section("4. Copy theme (Duplicate)");
  {
    const res = await callApi("extensions/themes/default/copy", "POST", {
      name: "mobai-custom",
      title: "我的定制墨白",
    });
    check("copy status is 201", res.status, 201);
    const data = await res.json();
    check("copied theme name is mobai-custom", data.name, "mobai-custom");
    check("copied title matches", data.title, "我的定制墨白");
    checkTruthy("copied file count > 0", data.files > 5);

    // Verify D1 records
    const row = sqlite.prepare("SELECT * FROM theme_installs WHERE name='mobai-custom'").get();
    checkTruthy("theme_installs has row", !!row);
    check("active is 0 initially", row.active, 0);

    const ver = sqlite.prepare("SELECT * FROM extension_versions WHERE extension_name='mobai-custom'").get();
    checkTruthy("extension_versions has row", !!ver);
  }

  section("5. Custom theme files list & edit");
  {
    const res = await callApi("extensions/themes/mobai-custom/files");
    check("list status is 200", res.status, 200);
    const data = await res.json();
    check("bundled is false", data.bundled, false);
    checkTruthy("files marked readonly: false", data.files.every((f) => f.readonly === false));

    // Read theme.json in cloned theme
    const mfRes = await callApi("extensions/themes/mobai-custom/file?path=theme.json");
    check("read manifest status is 200", mfRes.status, 200);
    const mfData = await mfRes.json();
    const parsedMf = JSON.parse(mfData.content);
    check("manifest name was updated to mobai-custom", parsedMf.name, "mobai-custom");
    check("manifest title was updated", parsedMf.title, "我的定制墨白");

    // Write a new custom template
    const writeRes = await callApi("extensions/themes/mobai-custom/file", "PUT", {
      path: "templates/landing.html",
      content: "<section>Landing Page Custom Content</section>",
    });
    check("write status is 200", writeRes.status, 200);

    // Read back
    const readBack = await callApi("extensions/themes/mobai-custom/file?path=templates/landing.html");
    check("read back status is 200", readBack.status, 200);
    const readData = await readBack.json();
    check("content matched exactly", readData.content, "<section>Landing Page Custom Content</section>");
  }

  section("6. Export theme to ZIP");
  {
    const res = await callApi("extensions/themes/mobai-custom/export");
    check("export status is 200", res.status, 200);
    check("content-type is zip", res.headers.get("content-type"), "application/zip");
    const buf = await res.arrayBuffer();
    checkTruthy("received non-empty zip bytes", buf.byteLength > 100);

    // Unzip and inspect
    const unzipped = unzipSync(new Uint8Array(buf));
    checkTruthy("unzipped contains theme.json", !!unzipped["theme.json"]);
    checkTruthy("unzipped contains templates/landing.html", !!unzipped["templates/landing.html"]);
    const landingStr = new TextDecoder().decode(unzipped["templates/landing.html"]);
    check("unzipped template content matches", landingStr, "<section>Landing Page Custom Content</section>");
  }

  section("7. Delete file & uninstall custom theme");
  {
    // Essential file protection
    const delMf = await callApi("extensions/themes/mobai-custom/file?path=theme.json", "DELETE");
    check("deleting theme.json is refused (400)", delMf.status, 400);

    // Normal file deletion
    const delLanding = await callApi("extensions/themes/mobai-custom/file?path=templates/landing.html", "DELETE");
    check("delete custom template is 200", delLanding.status, 200);

    // Verify deleted
    const checkDel = await callApi("extensions/themes/mobai-custom/file?path=templates/landing.html");
    check("reading deleted file answers 400 not found", checkDel.status, 400);

    // Uninstall custom theme
    const uninst = await callApi("extensions/themes/mobai-custom", "DELETE");
    check("uninstall status is 200", uninst.status, 200);
    const row = sqlite.prepare("SELECT * FROM theme_installs WHERE name='mobai-custom'").get();
    check("theme_installs record is gone", row ?? null, null);
    const verRow = sqlite.prepare("SELECT * FROM extension_versions WHERE extension_name='mobai-custom'").get();
    check("extension_versions record is gone after uninstall", verRow ?? null, null);
  }

  section("7b. Duplicate theme with adminMenus & langs (Grand Azure Resort scenario)");
  {
    // Install a source theme with adminMenus and langs
    const manifest = {
      name: "grand-resort-test",
      title: "Grand Azure Resort Test",
      version: "1.0.0",
      adminMenus: [
        {
          id: "resort-rooms",
          label: "Suites & Rooms",
          label_key: "theme.grand-resort-test.menu.rooms",
          screen: "custom",
          args: { view: "templates/index.html" },
        },
      ],
      langs: {
        en: {
          "theme.grand-resort-test.menu.rooms": "Rooms",
        },
      },
    };
    const files = {
      "theme.json": new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      "templates/index.html": new TextEncoder().encode("<p>Index</p>"),
      "langs/zh-CN.json": new TextEncoder().encode(JSON.stringify({
        "theme.grand-resort-test.menu.rooms": "房型管理",
      }, null, 2)),
    };
    const zipped = zipSync(files);
    const form = new FormData();
    form.append("file", new Blob([zipped], { type: "application/zip" }), "grand-resort-test.zip");
    const upRes = await callApi("extensions/themes/upload", "POST", form);
    check("upload grand-resort-test status is 201", upRes.status, 201);

    // Duplicate grand-resort-test into grand-resort-copy
    const copyRes = await callApi("extensions/themes/grand-resort-test/copy", "POST", {
      name: "grand-resort-copy",
      title: "Grand Azure Copy",
    });
    check("copy grand-resort status is 201", copyRes.status, 201);
    const copyData = await copyRes.json();
    check("copied name is grand-resort-copy", copyData.name, "grand-resort-copy");

    // Verify manifest has updated adminMenu label_key and langs prefix
    const mfRes = await callApi("extensions/themes/grand-resort-copy/file?path=theme.json");
    check("read cloned theme.json status is 200", mfRes.status, 200);
    const mfData = await mfRes.json();
    const clonedMf = JSON.parse(mfData.content);
    check("adminMenu label_key migrated to new namespace", clonedMf.adminMenus?.[0]?.label_key, "theme.grand-resort-copy.menu.rooms");
    check("inline langs migrated to new namespace", Object.keys(clonedMf.langs?.en || {})[0], "theme.grand-resort-copy.menu.rooms");

    // Verify langs/zh-CN.json migrated to new namespace
    const langRes = await callApi("extensions/themes/grand-resort-copy/file?path=langs/zh-CN.json");
    check("read cloned langs/zh-CN.json status is 200", langRes.status, 200);
    const langData = await langRes.json();
    const clonedLang = JSON.parse(langData.content);
    check("langs/zh-CN.json key migrated to new namespace", Object.keys(clonedLang)[0], "theme.grand-resort-copy.menu.rooms");
    check("langs/zh-CN.json translation preserved", clonedLang["theme.grand-resort-copy.menu.rooms"], "房型管理");

    // Test idempotency / leftover version conflict prevention:
    // Delete theme_installs row simulating an orphaned extension_versions record,
    // and attempt to copy again under the same name without UNIQUE constraint failure.
    sqlite.prepare("DELETE FROM theme_installs WHERE name='grand-resort-copy'").run();
    const reCopyRes = await callApi("extensions/themes/grand-resort-test/copy", "POST", {
      name: "grand-resort-copy",
      title: "Grand Azure Copy Again",
    });
    check("re-copy with leftover version is 201 (no UNIQUE constraint error)", reCopyRes.status, 201);

    // Clean up
    await callApi("extensions/themes/grand-resort-test", "DELETE");
    await callApi("extensions/themes/grand-resort-copy", "DELETE");
  }

  section("8. D1 Theme Storage without R2 & Configurable Binary Size Limits");
  {
    // Simulate environment without R2
    env.MEDIA = null;

    // 1. Build a test theme with an 800KB binary file (exceeding default 512KB limit)
    const largeBytes = new Uint8Array(800 * 1024);
    for (let i = 0; i < largeBytes.length; i++) largeBytes[i] = (i % 255);
    const themeJsonBytes = new TextEncoder().encode(JSON.stringify({
      name: "d1-test-theme",
      title: "D1 Test Theme",
      version: "1.0.0",
      templates: ["index"],
    }));
    const indexHtmlBytes = new TextEncoder().encode("<h1>D1 Stored Theme Index</h1>");
    const styleCssBytes = new TextEncoder().encode("body { background: #fafafa; }");

    const zipFiles = {
      "theme.json": themeJsonBytes,
      "templates/index.html": indexHtmlBytes,
      "assets/style.css": styleCssBytes,
      "assets/hero.png": largeBytes,
    };
    const zipData = zipSync(zipFiles);

    // Upload attempt should be refused because 800KB > 512KB limit
    const fd1 = new FormData();
    fd1.append("file", new File([zipData], "d1-test-theme.zip", { type: "application/zip" }));
    const res1 = await callApi("extensions/themes/upload", "POST", fd1);
    check("upload refused when binary exceeds default 512KB limit", res1.status, 400);
    const errData = await res1.json();
    checkTruthy("error message explains binary limit", errData.error && errData.error.includes("exceeds the configured limit"));

    // 2. Increase limit in platform_settings: theme.max_binary_size_kb = 1024
    sqlite.prepare(
      "INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('theme.max_binary_size_kb', '1024')"
    ).run();

    // Re-upload with the increased limit
    const fd2 = new FormData();
    fd2.append("file", new File([zipData], "d1-test-theme.zip", { type: "application/zip" }));
    const res2 = await callApi("extensions/themes/upload", "POST", fd2);
    check("upload succeeds when limit is configured to 1024KB", res2.status, 201);

    // 3. Verify D1 records
    const fileRows = sqlite.prepare("SELECT file_path, is_binary, size_bytes FROM theme_files WHERE theme_name='d1-test-theme' ORDER BY file_path").all();
    check("theme_files has 4 entries", fileRows.length, 4);
    const heroRow = fileRows.find((r) => r.file_path === "assets/hero.png");
    checkTruthy("hero.png is marked as binary", heroRow && heroRow.is_binary === 1);
    const indexRow = fileRows.find((r) => r.file_path === "templates/index.html");
    checkTruthy("index.html is marked as text", indexRow && indexRow.is_binary === 0);

    // 4. Read template from D1
    const readTpl = await callApi("extensions/themes/d1-test-theme/file?path=templates/index.html");
    check("reading template from D1 is 200", readTpl.status, 200);
    const readTplJson = await readTpl.json();
    check("read template content matches", readTplJson.content, "<h1>D1 Stored Theme Index</h1>");

    // 5. Update template in D1
    const writeTpl = await callApi("extensions/themes/d1-test-theme/file", "PUT", {
      path: "templates/index.html",
      content: "<h1>D1 Stored Theme Updated</h1>",
    });
    check("writing template to D1 is 200", writeTpl.status, 200);
    const verifyTpl = await callApi("extensions/themes/d1-test-theme/file?path=templates/index.html");
    const verifyJson = await verifyTpl.json();
    check("template update reflected in D1", verifyJson.content, "<h1>D1 Stored Theme Updated</h1>");

    // 6. Test front-end static asset serving from D1 (/themes/d1-test-theme/assets/style.css)
    const assetReq = new Request("http://127.0.0.1/themes/d1-test-theme/assets/style.css");
    const assetRes = await worker.default.fetch(assetReq, env, { waitUntil() {}, passThroughOnException() {} });
    check("serving text asset from D1 answers 200", assetRes.status, 200);
    const cssText = await assetRes.text();
    check("served CSS content matches", cssText, "body { background: #fafafa; }");

    // 7. Export D1 theme to ZIP and verify binary integrity
    const expRes = await callApi("extensions/themes/d1-test-theme/export");
    check("export D1 theme status is 200", expRes.status, 200);
    const expBuf = await expRes.arrayBuffer();
    const expUnzipped = unzipSync(new Uint8Array(expBuf));
    checkTruthy("exported zip contains hero.png", !!expUnzipped["assets/hero.png"]);
    check("exported hero.png has exact original size", expUnzipped["assets/hero.png"]?.byteLength, 800 * 1024);

    // 8. Uninstall D1 theme and verify complete cleanup
    const uninstD1 = await callApi("extensions/themes/d1-test-theme", "DELETE");
    check("uninstall D1 theme is 200", uninstD1.status, 200);
    const remainingD1Files = sqlite.prepare("SELECT COUNT(*) as cnt FROM theme_files WHERE theme_name='d1-test-theme'").get();
    check("all theme_files in D1 are deleted", remainingD1Files.cnt, 0);
  }

  cleanup();

  console.log("\n================================================================");
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  console.log(`\n${pass} passed, ${fail + 1} failed`);
  console.log("(aborted) harness threw: " + ((e && e.message) || e));
  process.exit(1);
});
