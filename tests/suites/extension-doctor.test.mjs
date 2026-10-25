/**
 * Extension Doctor & Pre-flight Inspection Engine Test Suite
 *
 * Verifies:
 * - Contract diagnostics (Rule 11 label_key namespace, Rule 41 table prose translatable)
 * - Physical package checks (missing entry template, missing declared templates/parts)
 * - Custom view existence check for adminMenus
 * - Language dictionary key coverage
 * - Light template syntax pre-flight (unclosed double braces)
 * - Health score calculation and valid flag
 * - API integration: POST extensions/inspect & upload rejection with report
 *
 * Usage: node tests/suites/extension-doctor.test.mjs
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
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

async function loadDoctor() {
  const esbuild = require("esbuild");
  const out = await esbuild.build({
    entryPoints: [join(root, "src/extensions/contract/doctor.ts")],
    bundle: true, format: "esm", target: "es2022", write: false,
    platform: "neutral", logLevel: "silent",
  });
  const tmp = join(root, "dist", ".test-bundles", "doctor-standalone-bundle.mjs");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href + "?t=" + Date.now());
}

async function compileWorker() {
  const esbuild = require("esbuild");
  const out = await esbuild.build({
    entryPoints: [join(root, "src/index.ts")],
    bundle: true, format: "esm", target: "es2022", write: false,
    platform: "neutral", logLevel: "silent",
  });
  const tmp = join(root, "dist", ".test-bundles", "doctor-test-bundle.mjs");
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
    async delete(key) { store.delete(key); },
    async list() { return { objects: [], truncated: false }; },
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
  const { inspectExtension } = await loadDoctor();

  section("1. Static Contract Diagnostics (Rule 11 & Rule 41)");
  {
    // A. Rule 11 namespace violation
    const badManifest = {
      name: "hotel-demo",
      title: "Hotel Demo",
      version: "1.0.0",
      adminMenus: [
        { id: "rooms", label: "Rooms", label_key: "theme.other-hotel.menu.rooms" },
      ],
      tables: [
        {
          name: "rooms",
          fields: [
            { key: "title", type: "text" }, // Missing translatable!
            { key: "price", type: "number" },
          ],
          translatable: ["price"], // Neutral field marked translatable!
        },
      ],
    };

    const rep = inspectExtension(badManifest, "theme");
    check("report valid is false", rep.valid, false);
    checkTruthy("detected label_key namespace error", rep.diagnostics.some((d) => d.code === "CHK_MENU_LABEL_KEY_NAMESPACE"));
    checkTruthy("detected prose not in translatable", rep.diagnostics.some((d) => d.code === "CHK_TABLE_PROSE_NOT_TRANSLATABLE"));
    checkTruthy("detected neutral in translatable", rep.diagnostics.some((d) => d.code === "CHK_TABLE_NEUTRAL_TRANSLATABLE"));
    checkTruthy("score reflects errors (score <= 50)", rep.score <= 50);
  }

  section("2. Package Physical File Verification");
  {
    // B. Package missing templates/index.html & missing custom view & unbalanced braces
    const themeManifest = {
      name: "azure-spa",
      title: "Azure Spa",
      version: "1.0.0",
      templates: ["room-detail"],
      adminMenus: [
        {
          id: "spa-custom",
          label: "Spa",
          label_key: "theme.azure-spa.spa",
          screen: "custom",
          args: { view: "templates/custom.html" },
        },
      ],
      locales: ["zh-CN"],
    };

    const files = {
      "theme.json": JSON.stringify(themeManifest),
      // Missing templates/index.html
      // Missing templates/room-detail.html
      // Missing templates/custom.html (custom view)
      "templates/broken.html": "<div><h1>{{title}</h1></div>", // Unclosed double braces
      "langs/zh-CN.json": JSON.stringify({ "theme.azure-spa.other": "Other" }), // Missing label_key
    };

    const rep = inspectExtension(themeManifest, "theme", files);
    check("report valid is false", rep.valid, false);
    checkTruthy("flagged missing entry template", rep.diagnostics.some((d) => d.code === "CHK_MISSING_ENTRY_TEMPLATE"));
    checkTruthy("flagged missing custom view", rep.diagnostics.some((d) => d.code === "CHK_MENU_CUSTOM_VIEW_NOT_FOUND"));
    checkTruthy("warned missing declared template", rep.diagnostics.some((d) => d.code === "CHK_TEMPLATE_FILE_MISSING"));
    checkTruthy("warned missing menu translation", rep.diagnostics.some((d) => d.code === "CHK_MENU_TRANSLATION_MISSING"));
    checkTruthy("warned unclosed double braces", rep.diagnostics.some((d) => d.code === "CHK_TPL_UNCLOSED_BRACES"));
    checkTruthy("notified missing 404 fallback", rep.diagnostics.some((d) => d.code === "CHK_MISSING_404"));
    checkTruthy("notified missing screenshot", rep.diagnostics.some((d) => d.code === "CHK_MISSING_SCREENSHOT"));
  }

  section("3. Fully Compliant Package Verification");
  {
    const compliantManifest = {
      name: "grand-azure",
      title: "Grand Azure",
      version: "1.0.0",
      templates: ["home"],
      adminMenus: [
        {
          id: "rooms",
          label: "Rooms",
          label_key: "theme.grand-azure.rooms",
          screen: "custom",
          args: { view: "templates/rooms.html" },
        },
      ],
      locales: ["zh-CN"],
    };

    const goodFiles = {
      "theme.json": JSON.stringify(compliantManifest),
      "templates/index.html": "<main>Fallback</main>",
      "templates/home.html": "<main>Home</main>",
      "templates/rooms.html": "<section>Rooms</section>",
      "templates/404.html": "<h1>404</h1>",
      "screenshot.png": "bytes",
      "langs/zh-CN.json": JSON.stringify({ "theme.grand-azure.rooms": "客房列表" }),
    };

    const rep = inspectExtension(compliantManifest, "theme", goodFiles);
    check("compliant report valid is true", rep.valid, true);
    check("zero critical errors", rep.summary.errors, 0);
    check("zero warnings", rep.summary.warnings, 0);
    check("score is 100", rep.score, 100);
  }

  section("4. Worker API Pre-flight & Upload Integration");
  {
    const sqlite = new DatabaseSync(":memory:");
    const migDir = join(root, "content", "migrations");
    const migFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of migFiles) {
      const sql = readFileSync(join(migDir, f), "utf8");
      sqlite.exec(sql);
    }

    sqlite.prepare("INSERT INTO site_users (id, username, email, password_hash, role, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)").run("u1", "admin", "a@a.com", "h", "superadmin", "active", 1, 1);
    sqlite.prepare("INSERT INTO admin_sessions (id, user_id, expires_at, created_at) VALUES(?,?,?,?)").run("token1", "u1", Math.floor(Date.now() / 1000) + 86400, 1);

    const env = {
      DB: makeD1(sqlite),
      MEDIA: makeR2(),
      CACHE: makeKV(),
      ASSETS: assetsStub(),
    };

    const worker = await compileWorker();

    const callApi = async (path, method = "GET", body = null) => {
      const headers = {
        Cookie: "cfpress_admin=token1",
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
      return worker.default.fetch(req, env, { waitUntil: () => {} });
    };

    // 4.1 Test POST extensions/inspect with JSON body
    const inspectRes = await callApi("extensions/inspect", "POST", {
      type: "theme",
      manifest: {
        name: "test-preview",
        title: "Test Preview",
        version: "1.0.0",
        adminMenus: [
          { id: "m1", label_key: "theme.wrong-name.m1" },
        ],
      },
    });
    check("inspect JSON status is 200", inspectRes.status, 200);
    const inspectData = await inspectRes.json();
    check("inspect returned report", typeof inspectData.report, "object");
    check("report valid is false for wrong namespace", inspectData.report.valid, false);

    // 4.2 Test Upload rejection with structured report
    const badFiles = {
      "theme.json": new TextEncoder().encode(JSON.stringify({
        name: "fail-theme",
        title: "Fail Theme",
        version: "1.0.0",
        adminMenus: [{ id: "bad-menu", label_key: "theme.other.bad" }],
      })),
      "templates/index.html": new TextEncoder().encode("<p>hi</p>"),
    };
    const badZip = zipSync(badFiles);
    const badForm = new FormData();
    badForm.append("file", new Blob([badZip], { type: "application/zip" }), "fail-theme.zip");
    const badUp = await callApi("extensions/themes/upload", "POST", badForm);
    check("bad upload rejected with 400", badUp.status, 400);
    const badUpData = await badUp.json();
    checkTruthy("bad upload response contains report", !!badUpData.report);
    check("report.valid is false", badUpData.report.valid, false);

    // 4.3 Test Compliant Upload with attached report
    const goodFiles = {
      "theme.json": new TextEncoder().encode(JSON.stringify({
        name: "good-theme",
        title: "Good Theme",
        version: "1.0.0",
      })),
      "templates/index.html": new TextEncoder().encode("<p>hi</p>"),
      "templates/404.html": new TextEncoder().encode("<p>404</p>"),
    };
    const goodZip = zipSync(goodFiles);
    const goodForm = new FormData();
    goodForm.append("file", new Blob([goodZip], { type: "application/zip" }), "good-theme.zip");
    const goodUp = await callApi("extensions/themes/upload", "POST", goodForm);
    check("good upload status is 201", goodUp.status, 201);
    const goodUpData = await goodUp.json();
    checkTruthy("good upload response contains report", !!goodUpData.report);
    check("good report.valid is true", goodUpData.report.valid, true);
  }

  section("Summary");
  console.log(`\n================================================================`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error(`Failures: ${JSON.stringify(failures)}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  console.log(`\n${pass} passed, ${fail + 1} failed`);
  console.log("(aborted) harness threw: " + ((e && e.message) || e));
  process.exit(1);
});
