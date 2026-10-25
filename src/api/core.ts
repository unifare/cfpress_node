/**
 * The API router's shared floor: tenant resolution and the read-access gate.
 *
 * These are the pieces every dispatcher needs and none of them owns — the
 * router answers "which site" and "may this user read it" before any domain
 * code runs, so they cannot live inside a domain without inverting the
 * dependency. The router imports them from here.
 */
import { Env } from "../shared/types";
import { DEFAULT_SITE_ID } from "../platform/sites";
import { accessibleSiteIds, SUPERADMIN_ROLE } from "../platform/permissions";
/**
 * Which site does this admin request target? Explicit `?site=` wins; otherwise
 * the default site. The admin UI passes it so one install can manage many
 * sites from the same backend.
 */
export function requestSiteId(url: URL): string {
  const s = String(url.searchParams.get("site") ?? "").trim();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(s) ? s : DEFAULT_SITE_ID;
}

/**
 * Was an explicit `?site=` supplied but malformed? `requestSiteId()` falls
 * back to the default site for anything it cannot parse — so without this
 * check `?site=PROBE_A` (uppercase) silently serves the default tenant's
 * rows with 200 (MS-2.4: "站点悄悄落到默认值"). Malformed is caller input,
 * so it answers 400, never another site's data.
 */
export function siteParamMalformed(url: URL): boolean {
  if (!url.searchParams.has("site")) return false;
  const s = String(url.searchParams.get("site") ?? "").trim();
  return !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(s);
}

/**
 * May this user see this site at all? The switcher (`GET sites`) already
 * answers this with `accessibleSiteIds`; every other site-scoped read must
 * ask the same question — otherwise the switcher hides a site that `?site=`
 * still opens (MS-3.1: B 站的任何内容/设置端点对无成员者 403).
 *
 * This is deliberately weaker than `can()`: it asks "member of this site",
 * not "may do X here". Write paths keep their own `requirePermission` check
 * on top; reads need at least this.
 */
export async function requireSiteAccess(env: Env, user: { id: string; role: string; apiKeyId?: string; sites?: string[] }, siteId: string): Promise<boolean> {
  // Machine-to-machine API keys: if bound to specific sites, that limit applies even to superadmin keys
  if (user.apiKeyId && Array.isArray(user.sites) && !user.sites.includes("*") && !user.sites.includes(siteId)) {
    return false;
  }
  if (user.role === SUPERADMIN_ROLE) return true;
  const allowed = await accessibleSiteIds(env, user as any);
  return allowed !== null && allowed.includes(siteId);
}
