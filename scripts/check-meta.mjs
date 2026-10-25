/**
 * Metadata consistency — the version and the documented suite count.
 *
 * ## Why this exists
 *
 * Four files disagreed about the product version (`package.json` 0.7.0, the
 * health endpoint 0.7.0, the OpenAPI schema 0.8.0, backups 0.8.0), and the
 * README advertised "28 suites" while `npm test` ran 35. None of that is a
 * crash; all of it is a lie told to whoever picks the project up next — and
 * `docs/HANDOVER.md` is explicitly "start here", so a wrong baseline is how a
 * regression gets waved through.
 *
 * A number that is written twice drifts. The fix is not "be careful"; it is to
 * have exactly one written copy and one function that answers whether the
 * others agree.
 *
 * ## Shape
 *
 * `metaInventory()` is the only reader: it parses `package.json`, the README
 * badge and the README prose line. `metaProblems()` turns that into a list of
 * human-readable disagreements — an empty list means the metadata is coherent.
 *
 * `architecture.test.mjs` imports both and asserts the list is empty **and**
 * that the badge was actually found (a regex that stops matching must be a
 * failure, not a silent pass). This script is the fixer:
 *
 *     node scripts/check-meta.mjs          # report, exit 1 on drift
 *     node scripts/check-meta.mjs --fix    # rewrite the README numbers
 *
 * The fixer rewrites *documented* numbers only. It never touches the version:
 * that is `src/shared/version.ts`, and bumping it is a deliberate act.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION } from "../src/shared/version.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(ROOT, "README.md");
const PKG = join(ROOT, "package.json");

/** `[![Tests](https://img.shields.io/badge/tests-35%20suites-brightgreen.svg)]` */
const BADGE = /tests-(\d+)%20suites/;
/** The `tests/  35 suites — see below` line in the directory tree. */
const PROSE = /tests\/\s+(\d+)\s+suites/;

/**
 * How many *suites* `npm test` runs.
 *
 * Counted from the `test` chain rather than from the filesystem on purpose:
 * `tests/suites/` also holds files the chain deliberately omits (the suite list
 * is the contract; the directory is just where they live). `_schema-scope.mjs`
 * lives under `tests/tools/` and is part of the chain but is not a suite, so
 * the filter is "under tests/suites/ and named *.test.mjs".
 */
function suiteCount() {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  return String(pkg.scripts.test || "")
    .split("&&")
    .map((s) => s.trim())
    .filter((s) => s.includes("tests/suites/") && s.endsWith(".test.mjs")).length;
}

export function metaInventory() {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  const readme = readFileSync(README, "utf8");
  const badge = readme.match(BADGE);
  const prose = readme.match(PROSE);
  return {
    version: VERSION,
    packageVersion: String(pkg.version || ""),
    suites: suiteCount(),
    badgeFound: Boolean(badge),
    badgeCount: badge ? Number(badge[1]) : null,
    proseFound: Boolean(prose),
    proseCount: prose ? Number(prose[1]) : null,
  };
}

/**
 * Every disagreement, as a sentence a person can act on.
 *
 * "not found" is reported as a problem, not skipped: a README rewrite that
 * drops the badge must fail the guard rather than turn it into a no-op.
 */
export function metaProblems(inv = metaInventory()) {
  const problems = [];
  if (inv.version !== inv.packageVersion) {
    problems.push(`package.json version is ${inv.packageVersion}, src/shared/version.ts says ${inv.version}`);
  }
  if (!inv.badgeFound) problems.push("README test badge not found (pattern: tests-<n>%20suites)");
  else if (inv.badgeCount !== inv.suites) {
    problems.push(`README badge says ${inv.badgeCount} suites, npm test runs ${inv.suites}`);
  }
  if (!inv.proseFound) problems.push("README suite-count line not found (pattern: tests/ <n> suites)");
  else if (inv.proseCount !== inv.suites) {
    problems.push(`README tree says ${inv.proseCount} suites, npm test runs ${inv.suites}`);
  }
  return problems;
}

/** Rewrite the two documented numbers. Returns the problems left afterwards. */
export function fixMeta() {
  const inv = metaInventory();
  let readme = readFileSync(README, "utf8");
  readme = readme.replace(BADGE, `tests-${inv.suites}%20suites`);
  readme = readme.replace(PROSE, (m) => m.replace(/\d+/, String(inv.suites)));
  writeFileSync(README, readme);
  return metaProblems();
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const fix = process.argv.includes("--fix");
  const before = metaProblems();
  if (fix && before.length) {
    const left = fixMeta();
    console.log(left.length ? "still inconsistent after --fix:" : "README numbers rewritten.");
    for (const p of left) console.log(`  - ${p}`);
    process.exit(left.length ? 1 : 0);
  }
  if (!before.length) {
    console.log(`metadata consistent: version ${metaInventory().version}, ${metaInventory().suites} suites`);
    process.exit(0);
  }
  console.log("metadata drift:");
  for (const p of before) console.log(`  - ${p}`);
  console.log("run with --fix to rewrite the README numbers");
  process.exit(1);
}
