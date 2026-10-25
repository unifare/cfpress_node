const enc = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/**
 * PBKDF2 iteration count for **new** hashes.
 *
 * Sized against the Cloudflare Workers **free** plan's 10 ms CPU budget per
 * request, not against OWASP's 600k recommendation. A request that hashes a
 * password runs exactly one `deriveBits`, and 120k iterations measured ~22 ms
 * on a dev machine — over budget, so the runtime kills the worker before it
 * can write anything. The symptom is nasty because it is invisible in code:
 * `bootstrapAdmin` never finishes, so `site_users` stays empty, and the login
 * response is a platform error page rather than JSON, which the admin SPA
 * reports as "Request failed".
 *
 * 25k keeps one derivation near 3.5 ms, leaving room for the rest of the
 * request. A deployment on the paid plan (50 ms, adjustable up to 3000 ms) can
 * raise this. The count is embedded in every stored hash
 * (`pbkdf2$<iterations>$salt$hash`), so raising it later does **not**
 * invalidate existing passwords — `verifyPassword` derives using the count it
 * reads from the stored value.
 */
export const PBKDF2_ITERATIONS = 25000;

/**
 * The lowest iteration count a deployment is allowed to ask for.
 *
 * The default is sized for the free plan (see above); a paid deployment can
 * raise it, but nobody may lower it — "configure the work factor" is not the
 * same feature as "turn password hashing into a formality", and the two are one
 * typo apart in a config file.
 */
export const PBKDF2_MIN_ITERATIONS = 25000;

/**
 * The iteration count to use for **new** hashes in this deployment.
 *
 * Reads `CFP_PBKDF2_ITERATIONS` (a plain var, not a feature switch: it is not
 * per-site and there is nothing to toggle at runtime). Anything missing,
 * non-numeric or below the floor resolves to the default — a bad value must
 * degrade to the safe setting, never to the cheap one.
 *
 * Existing hashes are unaffected: `verifyPassword` derives with the count it
 * reads from the stored string, which is why raising this is safe.
 */
export function passwordIterations(env: unknown): number {
  const raw = Number((env as { CFP_PBKDF2_ITERATIONS?: string } | undefined)?.CFP_PBKDF2_ITERATIONS);
  return Number.isFinite(raw) && raw >= PBKDF2_MIN_ITERATIONS ? Math.floor(raw) : PBKDF2_ITERATIONS;
}

export async function randomId(bytes = 16): Promise<string> {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(data);
}

export async function hashPassword(
  password: string,
  opts: { iterations?: number; salt?: Uint8Array } = {}
) {
  // The count is clamped here as well as in `passwordIterations`: this function
  // is the one that writes the number into the hash, so it is the last place
  // that can refuse a cheap one.
  const requested = Number(opts.iterations ?? PBKDF2_ITERATIONS);
  const iterations = Number.isFinite(requested) && requested >= PBKDF2_MIN_ITERATIONS
    ? Math.floor(requested)
    : PBKDF2_ITERATIONS;
  const actualSalt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: actualSalt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256
  );
  // The literal must be the same number that was just used: a mismatch here
  // would make every hash unverifiable, since `verifyPassword` trusts this
  // field over any default.
  return `pbkdf2$${iterations}$${toBase64Url(actualSalt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    expected.byteLength * 8
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
