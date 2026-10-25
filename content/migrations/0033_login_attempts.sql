-- 0033: a shared brute-force gate for the admin login endpoint.
--
-- The login endpoint is the one thing a scanner can hit without a session, and
-- its throttle used to live in a module-level Map — which is **per isolate**.
-- An attacker splitting requests across isolates multiplies the limit, and the
-- symptom is invisible: each isolate sees its own well-behaved request rate.
--
-- The gate key is `${ip}|${username}` (unchanged), so one row per pairing:
--   count         failures inside the current window
--   first_at      when the window opened (ms epoch)
--   blocked_until when the gate opens again (ms epoch, 0 = not blocked)
--
-- Platform-global by construction: a brute-force attempt is not a tenant fact,
-- and the gate must be shared even across sites. Rows are ephemeral — created
-- on failure, deleted on success — and never hold anything worth keeping, so
-- nothing prunes them.
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
