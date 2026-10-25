/**
 * The product version — **written once**.
 *
 * Before this file there were four answers to "what version is this?": the
 * health endpoint said `0.7.0`, `package.json` said `0.7.0`, the OpenAPI schema
 * said `0.8.0`, and backups stamped `0.8.0`. Two of them were stale, and the
 * only symptom was a client comparing a health response against a backup file
 * and getting a mismatch that looked like a corrupt export.
 *
 * A version is metadata, not configuration: nothing may branch on it at
 * runtime, and no module may carry its own copy. `scripts/check-meta.mjs`
 * compares this constant against `package.json` and the README badge, and
 * `architecture.test.mjs` asserts no other file in `src/` mentions the literal.
 *
 * Bumping: change this line, run the fixer, commit both.
 */
export const VERSION = "0.8.0";
