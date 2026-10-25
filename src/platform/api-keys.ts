/**
 * API Key authentication and management for AI Agents and automation.
 *
 * Keys follow the format: `cfp_live_<24 base64url characters>`.
 * The database only stores `SHA-256(secret_token)` to prevent credential leakage.
 */
import { Env, SessionUser } from "../shared/types";
import { randomId } from "../shared/crypto";
import { getDb, apiKeys, eq, and, desc } from "../shared/db";

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string; // JSON array of string
  sites: string;  // JSON array of string
  status: "active" | "revoked";
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
}

export interface ApiKeyCreatedResult {
  id: string;
  name: string;
  token: string;
  keyPrefix: string;
  key_prefix?: string;
  scopes: string[];
  sites: string[];
  createdAt: number;
  created_at?: number;
}

/** Compute lowercase hex SHA-256 without byteOffset or pool slicing issues. */
async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a Bearer token and resolve the bound SessionUser.
 * Returns null if not a valid/active API Key.
 */
export async function authenticateApiKey(
  env: Env,
  token: string
): Promise<SessionUser | null> {
  const clean = String(token || "").trim();
  if (!clean.startsWith("cfp_live_")) return null;

  const hash = await hashToken(clean);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(`
    SELECT k.id AS key_id, k.user_id, k.scopes, k.sites, k.expires_at, k.status,
           u.id, u.username, u.email, u.role, u.status AS user_status
    FROM api_keys k
    JOIN site_users u ON u.id = k.user_id
    WHERE k.key_hash = ? AND k.status = 'active' AND u.status = 'active'
    LIMIT 1
  `).bind(hash).first<any>();

  if (!row) return null;

  // Check expiration
  if (row.expires_at && Number(row.expires_at) < now) {
    return null;
  }

  // Parse scopes and sites
  let scopes: string[] = ["*"];
  let sites: string[] = ["*"];
  try {
    const s = JSON.parse(row.scopes);
    if (Array.isArray(s)) scopes = s.map(String);
  } catch {}
  try {
    const st = JSON.parse(row.sites);
    if (Array.isArray(st)) sites = st.map(String);
  } catch {}

  // Update last_used_at asynchronously
  env.DB.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?")
    .bind(now, row.key_id)
    .run()
    .catch(() => {});

  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : null,
    role: String(row.role),
    status: String(row.user_status),
    sessionId: `apikey_${row.key_id}`,
    apiKeyId: String(row.key_id),
    scopes,
    sites,
  };
}

/**
 * Generate a new API key.
 * Only returns the cleartext token once upon creation.
 */
export async function createApiKey(
  env: Env,
  userId: string,
  name: string,
  scopes: string[] = ["*"],
  sites: string[] = ["*"],
  expiresInDays: number | null = null
): Promise<ApiKeyCreatedResult> {
  const cleanName = String(name || "").trim() || "AI Integration Key";
  const id = `ak_${await randomId(12)}`;
  const secretPart = await randomId(24);
  const token = `cfp_live_${secretPart}`;
  const keyPrefix = token.slice(0, 14); // e.g. "cfp_live_a1b2c"
  const keyHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = expiresInDays && expiresInDays > 0 ? now + expiresInDays * 86400 : null;

  const scopesJson = JSON.stringify(scopes.length ? scopes : ["*"]);
  const sitesJson = JSON.stringify(sites.length ? sites : ["*"]);

  await getDb(env).insert(apiKeys).values({
    id,
    user_id: userId,
    name: cleanName,
    key_prefix: keyPrefix,
    key_hash: keyHash,
    scopes: scopesJson,
    sites: sitesJson,
    status: "active",
    expires_at: expiresAt,
    last_used_at: null,
    created_at: now,
  });

  return {
    id,
    name: cleanName,
    token,
    keyPrefix,
    key_prefix: keyPrefix,
    scopes,
    sites,
    createdAt: now,
    created_at: now,
  };
}

/**
 * List API keys (without secret tokens) for the current user or superadmin.
 */
export async function listApiKeys(env: Env, userId?: string, status = "active"): Promise<Omit<ApiKeyRecord, "key_hash">[]> {
  const db = getDb(env);
  const cols = {
    id: apiKeys.id,
    user_id: apiKeys.user_id,
    name: apiKeys.name,
    key_prefix: apiKeys.key_prefix,
    scopes: apiKeys.scopes,
    sites: apiKeys.sites,
    status: apiKeys.status,
    expires_at: apiKeys.expires_at,
    last_used_at: apiKeys.last_used_at,
    created_at: apiKeys.created_at,
  };
  const whereCond = userId
    ? status
      ? and(eq(apiKeys.user_id, userId), eq(apiKeys.status, status))
      : eq(apiKeys.user_id, userId)
    : status
      ? eq(apiKeys.status, status)
      : undefined;

  const query = whereCond
    ? db.select(cols).from(apiKeys).where(whereCond).orderBy(desc(apiKeys.created_at))
    : db.select(cols).from(apiKeys).orderBy(desc(apiKeys.created_at));
  const rows = await query.all();
  return (rows as any[]) ?? [];
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(env: Env, keyId: string, userId?: string): Promise<boolean> {
  const db = getDb(env);
  const whereCond = userId
    ? and(eq(apiKeys.id, keyId), eq(apiKeys.user_id, userId))
    : eq(apiKeys.id, keyId);
  const row = await db
    .select({ id: apiKeys.id, status: apiKeys.status })
    .from(apiKeys)
    .where(whereCond)
    .limit(1)
    .get();
  if (!row) return false;

  await db.update(apiKeys).set({ status: "revoked" }).where(whereCond);
  return true;
}
