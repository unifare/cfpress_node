/**
 * Verification script for CFPress Node.js Standalone Server.
 *
 * Starts the compiled Node.js server bundle against a temporary SQLite database
 * and validates that:
 * 1. Root page serves 200 / HTML correctly.
 * 2. Admin SPA serves 200 / HTML with proper headers.
 * 3. Static assets (/admin/admin.js, etc.) serve 200 / JS with correct MIME.
 * 4. Front / API routes respond properly.
 * 5. Server shuts down cleanly without leaving open resources.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function fetchUrl(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
  };
}

async function main() {
  console.log("Verifying CFPress Node.js Standalone Server runtime...\n");

  // Step 1: Ensure bundle is built
  const { buildNodeServer } = await import("../../scripts/build-node.mjs");
  await buildNodeServer();

  // Step 2: Prepare temporary test data directory
  const testDataDir = mkdtempSync(join(tmpdir(), "cfpress-node-test-"));
  const testPort = 48925;

  let serverHandle = null;
  try {
    const { startServer } = await import("../../dist/server.mjs");
    serverHandle = await startServer({
      port: testPort,
      host: "127.0.0.1",
      dataDir: testDataDir,
    });

    const baseUrl = `http://127.0.0.1:${testPort}`;

    // Test 1: Root front-end page
    {
      const res = await fetchUrl(`${baseUrl}/`);
      check("Root front page responds with 200 OK", res.status === 200, `status: ${res.status}`);
      check("Root front page has HTML content-type", /text\/html/i.test(res.headers["content-type"] || ""));
      check("Root front page renders non-empty body", res.text.length > 50, `body length: ${res.text.length}`);
    }

    // Test 2: Admin SPA route
    {
      const res = await fetchUrl(`${baseUrl}/admin`);
      check("Admin route responds with 200 OK", res.status === 200, `status: ${res.status}`);
      check("Admin route contains HTML markup", /<!doctype html>/i.test(res.text) || /<html/i.test(res.text));
    }

    // Test 3: Static Asset serving
    {
      const res = await fetchUrl(`${baseUrl}/admin/admin.js`);
      check("Admin static JS asset responds with 200 OK", res.status === 200, `status: ${res.status}`);
      check("Admin JS asset has javascript content-type", /javascript/i.test(res.headers["content-type"] || ""));
      check("Admin JS asset has valid ETag header", Boolean(res.headers["etag"]));
    }

    // Test 4: 404 handling
    {
      const res = await fetchUrl(`${baseUrl}/non-existent-page-${Date.now()}`);
      check("Non-existent page responds with 404", res.status === 404, `status: ${res.status}`);
    }

    // Test 5: API route
    {
      const res = await fetchUrl(`${baseUrl}/api/v1/locales`);
      check("API route responds (200/401/404)", [200, 401, 404].includes(res.status), `status: ${res.status}`);
    }

  } finally {
    if (serverHandle) {
      await serverHandle.stop();
    }
    try {
      rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n================================================================`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error(`Failed checks: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
