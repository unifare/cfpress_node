/**
 * The admin SPA's type-error ratchet.
 *
 * `public/admin` is 11k lines of hand-written JavaScript with no build step and
 * no static checking at all: the root tsconfig covers `src/` and nothing else.
 * A typo like `el.value` on an `Element`, or a screen that imports a helper it
 * never uses, is therefore invisible until the one code path that reaches it
 * runs in a browser. The repository has already paid for this once — §12's
 * fifteenth false green is exactly a missing `attr` import that every test
 * passed over.
 *
 * `tsconfig.admin.json` turns `checkJs` on. The baseline is not zero, and
 * fixing 340 diagnostics in one commit would be unreviewable, so this script
 * holds a **budget**: the exact set of diagnostics that exist today.
 *
 * ## Why a set, not a count
 *
 * A count is gameable by accident: fix one, introduce another, and the number
 * is unchanged while a new defect walks in. The budget therefore stores
 * `file|code|message` keys. An error that is not in the budget is a failure
 * **even when the total went down**.
 *
 * ## Usage
 *
 *     node scripts/check-admin-types.mjs            # ratchet check
 *     node scripts/check-admin-types.mjs --update   # rewrite the budget
 *
 * `--update` is how a fix is locked in: fix errors, run it, commit the smaller
 * budget. It must never be used to accept a *new* error — the diff on the
 * budget file is what a reviewer reads.
 *
 * **The budget is currently gone, and that is the finished state**: the count
 * reached zero, the file was deleted, and from here every diagnostic fails the
 * check. Re-creating it with `--update` is a deliberate step backwards, taken
 * only when a large new surface lands and the errors are real work items.
 *
 * ⚠️ Runs the compiler in-process (`typescript`'s API) rather than spawning
 * `tsc`. The reverse-validation tooling in this repository already learned that
 * a child process can fail for reasons that look like "the check passed"; an
 * in-process program either produces diagnostics or throws.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, "tsconfig.admin.json");
const BUDGET = join(ROOT, "tests", "fixtures", "admin-type-budget.json");

/** `file|code|message`, with line numbers deliberately excluded (they churn). */
function keyOf(d) {
  const file = d.file ? relative(ROOT, d.file.fileName).split(sep).join("/") : "<global>";
  return `${file}|TS${d.code}|${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
}

export function adminTypeDiagnostics() {
  const read = ts.readConfigFile(CONFIG, ts.sys.readFile);
  if (read.error) {
    throw new Error(`cannot read tsconfig.admin.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  if (parsed.errors.length) {
    throw new Error(`tsconfig.admin.json is invalid: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, " ")}`);
  }
  // Non-vacuity: a config that silently stopped matching files would report
  // "zero errors" and look like a clean tree.
  if (!parsed.fileNames.length) throw new Error("tsconfig.admin.json matched no files");

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
  return {
    files: parsed.fileNames.length,
    diagnostics: diagnostics.map((d) => ({
      key: keyOf(d),
      file: d.file ? relative(ROOT, d.file.fileName).split(sep).join("/") : "<global>",
      line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    })),
  };
}

function loadBudget() {
  if (!existsSync(BUDGET)) return null;
  const raw = JSON.parse(readFileSync(BUDGET, "utf8"));
  if (!Array.isArray(raw.errors)) throw new Error("admin-type-budget.json has no `errors` array");
  return raw;
}

function counts(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

function main() {
  const { files, diagnostics } = adminTypeDiagnostics();
  const current = counts(diagnostics.map((d) => d.key));
  const update = process.argv.includes("--update");

  if (update) {
    const errors = [...current.entries()].flatMap(([k, n]) => Array.from({ length: n }, () => k)).sort();
    writeFileSync(
      BUDGET,
      JSON.stringify(
        {
          note: "Admin SPA type-error budget. Set only by `node scripts/check-admin-types.mjs --update` after fixing errors. A key that is not here is a failure even if the total count fell.",
          errors,
        },
        null,
        2
      ) + "\n"
    );
    console.log(`budget updated: ${errors.length} diagnostic(s) across ${files} file(s)`);
    process.exit(0);
  }

  const budget = loadBudget();
  // ⚠️ No budget file means **the baseline is zero** — the state this ratchet
  // was built to reach. It is not "the check is unconfigured": every diagnostic
  // is then a failure. `--update` still exists, but from here on writing a
  // budget back is a deliberate, reviewed decision (a new screen landing with
  // known work), not the default way to make the check pass.
  const allowed = budget ? counts(budget.errors) : new Map();

  const added = [];
  for (const [k, n] of current) {
    const have = allowed.get(k) || 0;
    if (n > have) added.push(k);
  }
  const fixed = [];
  for (const [k, n] of allowed) {
    const have = current.get(k) || 0;
    if (have < n) fixed.push(k);
  }

  if (added.length) {
    console.error(`✗ ${added.length} type error(s)${budget ? " not in the budget" : ""} (${diagnostics.length} total across ${files} files):`);
    for (const k of added.slice(0, 20)) console.error(`  + ${k}`);
    if (added.length > 20) console.error(`  … and ${added.length - 20} more`);
    console.error("\nFix them. Do not run --update to accept a new error.");
    process.exit(1);
  }

  if (!budget) {
    console.log(`ok: 0 type error(s) across ${files} files (no budget file: the baseline is zero)`);
    process.exit(0);
  }

  if (fixed.length) {
    console.log(`ok: ${diagnostics.length} type error(s), ${fixed.length} fewer than the budget`);
    console.log("   run with --update to lock the improvement in (the budget only goes down)");
    process.exit(0);
  }

  console.log(`ok: ${diagnostics.length} type error(s), exactly the recorded budget (${files} files)`);
  process.exit(0);
}

main();
