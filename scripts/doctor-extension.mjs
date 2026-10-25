#!/usr/bin/env node
/**
 * CLI Extension Doctor & Linter for CFPress.
 *
 * Inspects a theme or plugin directory or ZIP package against platform contracts,
 * Rule 11 namespace isolation, Rule 41 translatable tables, file integrity,
 * templates, and UI localization.
 *
 * Usage:
 *   node scripts/doctor-extension.mjs <path-or-zip> [--type theme|plugin] [--strict]
 */
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { unzipSync } from "fflate";
import { ROOT, CliError, isMain } from "./_scaffold.mjs";

const require = createRequire(pathToFileURL(join(ROOT, "package.json")));

let cachedDoctor = null;
export async function getDoctorEngine() {
  if (cachedDoctor) return cachedDoctor;
  const esbuild = require("esbuild");
  const entry = join(ROOT, "src", "extensions", "contract", "doctor.ts");
  const res = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    target: "node20",
    packages: "external",
  });
  const code = res.outputFiles[0].text;
  cachedDoctor = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return cachedDoctor;
}

function collectDirectoryFiles(dir, current = dir, map = new Map()) {
  const entries = readdirSync(current, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const full = join(current, ent.name);
    if (ent.isDirectory()) {
      collectDirectoryFiles(dir, full, map);
    } else if (ent.isFile()) {
      const rel = relative(dir, full).replace(/\\/g, "/");
      map.set(rel, readFileSync(full));
    }
  }
  return map;
}

export async function inspectPath(targetPath, options = {}) {
  const abs = resolve(process.cwd(), targetPath);
  if (!existsSync(abs)) {
    throw new CliError(`Target does not exist: "${targetPath}"`);
  }

  const stat = statSync(abs);
  const filesMap = new Map();

  if (stat.isDirectory()) {
    collectDirectoryFiles(abs, abs, filesMap);
  } else if (targetPath.endsWith(".zip") || stat.isFile()) {
    const buf = readFileSync(abs);
    const unzipped = unzipSync(new Uint8Array(buf));
    for (const [k, v] of Object.entries(unzipped)) {
      if (k.endsWith("/") || k.startsWith("__MACOSX/")) continue;
      filesMap.set(k.replace(/^\.\//, ""), v);
    }
  }

  let type = options.type;
  if (!type) {
    if (filesMap.has("theme.json")) type = "theme";
    else if (filesMap.has("plugin.json")) type = "plugin";
    else {
      throw new CliError(`Could not detect extension type. Missing theme.json or plugin.json in "${targetPath}". Specify --type theme|plugin.`);
    }
  }

  const manifestFile = type === "theme" ? "theme.json" : "plugin.json";
  const manifestRaw = filesMap.get(manifestFile);
  if (!manifestRaw) {
    throw new CliError(`Missing required manifest file: "${manifestFile}"`);
  }

  let manifest;
  try {
    const text = typeof manifestRaw === "string" ? manifestRaw : new TextDecoder().decode(manifestRaw);
    manifest = JSON.parse(text);
  } catch (err) {
    throw new CliError(`Failed to parse ${manifestFile} as valid JSON: ${err.message}`);
  }

  const { inspectExtension } = await getDoctorEngine();
  const report = inspectExtension(manifest, type, filesMap);
  return { report, manifest, type, fileCount: filesMap.size };
}

export async function main(argv, io = { stdout: console.log, stderr: console.error }) {
  const args = argv.slice(2);
  let targetPath = "";
  let type = "";
  let strict = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--type" && args[i + 1]) {
      type = args[++i];
    } else if (a.startsWith("--type=")) {
      type = a.split("=")[1];
    } else if (a === "--strict") {
      strict = true;
    } else if (a === "--json") {
      jsonOutput = true;
    } else if (a === "-h" || a === "--help") {
      io.stdout([
        "Usage: node scripts/doctor-extension.mjs <path-or-zip> [options]",
        "",
        "Options:",
        "  --type <theme|plugin>  Explicitly specify extension type",
        "  --strict               Treat warnings as failure (exit code 1)",
        "  --json                 Output machine-readable JSON report",
        "  -h, --help             Show this help message",
      ].join("\n"));
      return 0;
    } else if (!targetPath) {
      targetPath = a;
    }
  }

  if (!targetPath) {
    io.stderr("Error: Missing target path or ZIP file.\nRun with --help for usage.");
    return 1;
  }

  try {
    const { report, manifest, type: detectedType, fileCount } = await inspectPath(targetPath, { type });

    if (jsonOutput) {
      io.stdout(JSON.stringify(report, null, 2));
      return report.valid && (!strict || report.summary.warnings === 0) ? 0 : 1;
    }

    // Format human-friendly console report
    const header = [
      "==================================================================",
      ` CFPress Extension Doctor: ${manifest.name || "unnamed"} (${detectedType})`,
      "==================================================================",
      `Target:       ${targetPath}`,
      `Files:        ${fileCount} package files scanned`,
      `Version:      ${manifest.version || "0.0.0"}`,
      `Health Score: ${report.score}/100`,
      `Result:       ${report.valid ? "PASSED" : "FAILED"} (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} suggestions)`,
      "------------------------------------------------------------------",
    ].join("\n");

    io.stdout(header);

    if (report.diagnostics.length === 0) {
      io.stdout("\n✨ Perfect! No errors or warnings found. Package fully adheres to CFPress standards.");
    } else {
      for (const d of report.diagnostics) {
        const icon = d.level === "error" ? "❌ [ERROR]" : d.level === "warning" ? "⚠️  [WARN] " : "ℹ️  [INFO] ";
        let line = `${icon} [${d.code}] ${d.message}`;
        if (d.file) line += ` (${d.file})`;
        io.stdout(`\n${line}`);
        if (d.suggestion) {
          io.stdout(`   👉 Suggestion: ${d.suggestion}`);
        }
      }
    }

    io.stdout("\n==================================================================");

    const hasErrors = !report.valid || report.summary.errors > 0;
    const hasWarnings = strict && report.summary.warnings > 0;

    if (hasErrors || hasWarnings) {
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr(`\nDoctor Error: ${err.message}`);
    } else {
      io.stderr(`\nUnexpected error: ${err.stack || err.message}`);
    }
    return 1;
  }
}

if (isMain(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code));
}
