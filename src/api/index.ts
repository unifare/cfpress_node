import { Env, SessionUser } from "../shared/types";
import { requestSiteId, requireSiteAccess, siteParamMalformed } from "./core";
import { mediaList, mediaUpload, mediaRowForWrite, mediaUpdate, mediaDelete } from "./media";
import { pluginSettings, savePluginSetting, uninstallTheme, uploadExtension } from "./extensions";
import { dispatchContentAdminRoutes, dispatchTaxonomyAndTermRoutes } from "./content";
import {
  deletePost,
  fieldExists,
  findActivePostType,
  freeSlug,
  GROUP_SQL,
  groupOf,
  handleBatchContent,
  listPosts,
  savePost,
  translationGroup,
  writePostMeta,
} from "./content";
import { dispatchBackupAdminRoutes, dispatchExtensionAdminRoutes, dispatchThemeTableAdminRoutes } from "./extensions";
import { dispatchMediaAdminRoutes } from "./media";
import { dispatchI18nAdminRoutes, dispatchSettingsAdminRoutes } from "./settings";
import { dispatchAdminMenuCustomRoutes, dispatchNavAndWidgetRoutes } from "./widgets";
import { deleteMemberPost, frontAnswer, handleFrontApi, readFrontParams, routeFrontApi, safeRedirect, saveMemberPost } from "./front";
import { features, platformSettingsList, saveFeature, savePlatformSetting, saveSetting, settings } from "./settings";
import { bootstrapAdmin, changePassword, changeUsername, currentUser, getMenuPrefs, login, logout, requireAdmin, rescopeSessionCookie, setMenuPrefs, setUserUiLang } from "../platform/auth";
import { activity, getClientIp, jsonBody, now, ok, setCurrentIp } from "../shared/repo";
import { randomId, hashPassword, passwordIterations } from "../shared/crypto";
import { validMemberUsername } from "../platform/members";
import { VERSION } from "../shared/version";
import { CORE_BLOCKS } from "../rendering/blocks";
import { installedPlugins, installedThemes, seedBundledExtensions, capabilityList, bootPluginRuntime, applyFilters, doAction, resetPluginRuntime, pluginRuntimeStatus } from "../extensions/plugin/runtime";
import { unzipSync } from "fflate";
import { validateManifest } from "../extensions/contract/validation";
import { CAPABILITIES } from "../extensions/contract/capabilities";
import { PURGE_ON_SITE_DELETE } from "../extensions/contract/schema";
import { SETTING_DEFS, getSetting, setSetting, platformSetting, setPlatformSetting, isDeclaredSetting, settingDef, adminPath, resetAdminPathMemo } from "../platform/settings";
import { safeZipPath, sha256 } from "../extensions/security";
import { createRevision, autosave } from "../platform/revisions";
import { requirePermission, can, accessibleSiteIds, SITE_ROLES, SUPERADMIN_ROLE } from "../platform/permissions";
import { bumpContentCache } from "../shared/cache";
import { BUNDLED_THEMES } from "../shared/bundled";
import { featureSnapshot, inheritedValue, truthy, FEATURE_SETTINGS_KEY, FEATURE_SWITCHES, type FeatureSwitch } from "../shared/features";
import { DEMO_CONTENTS, DEMO_LOCALES, DEMO_MENUS, DEMO_SEED_STAMP, CTBLOG_MENUS } from "../shared/demo-content";
import { clearOwnerMenusAllSites, listAdminMenuGroups } from "../platform/admin-menus";
import { clearPluginMenus } from "../extensions/plugin/menus";
import { createSite, updateSite, deleteSite, listSites, DEFAULT_SITE_ID } from "../platform/sites";
// The front-end identity is a separate module with a separate table and a
// separate cookie on purpose (§2.1) — importing it here does not merge the two
// logins, it is what lets the front API read the member session without ever
// touching `admin_sessions`.
import { registerMember, loginMember, logoutMember, requireMember } from "../platform/members";
// The custom-field read ladder is defined once; the admin read has to agree
// with what the front end renders for the same post in the same language.
import { postMetaRows, resolveMetaByPost } from "../platform/post-meta";
import { defaultLocale } from "../platform/frontend";
import { resolvePostUrl, DEFAULT_PERMALINK_STRUCTURE } from "../platform/permalink";
import { exportSiteBackup, inspectBackup, restoreSiteBackup, createSnapshot, listSnapshots, getSnapshot, deleteSnapshot } from "../platform/backup";
// Media access policy — the same module the front-end `/media/<key>` read path
// uses, so the library a user can list is the library they can fetch.
import { readMediaPolicy, mediaOwnerClause } from "../platform/media-policy";
// Third-party image hosts: the upload half of the storage choice. This module
// only speaks vendor APIs (bytes in, URLs out); the tenant check, the row and
// the policy stay here, so no caller can upload without recording.
import { mediaProviderOf, isMediaStorageProvider, remoteObjectKey, readMediaStorage, readMediaKeys, uploadToImgbb, uploadToPostimages, deleteRemoteImage, type MediaStorageProvider } from "../platform/media-hosts";
import {applyThemeCapabilities, clearThemeCapabilities, listPostTypes, listTaxonomies, listRoutes, listThemeAdminMenus, listThemeBlocks, listFieldDefs, themeSettings, parseSettingOptions} from "../extensions/theme/capabilities";
import { activateThemeForSite } from "./extensions";
import { listThemeFiles, readThemeFile, writeThemeFile, deleteThemeFile, copyTheme, exportThemeZip } from "../extensions/theme/assets";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "../platform/api-keys";
import { generateOpenApiSchema } from "../platform/openapi";
import {
  getAdminComments,
  updateCommentStatus,
  deleteComment,
  batchCommentStatus,
  batchDeleteComments,
  replyComment,
} from "../platform/comments";
import {
  availableUiLocaleEntries,
  availableUiLocales,
  corePackLocaleEntries,
  corePackLocales,
  disableSiteLocale,
  enableSiteLocale,
  isLocaleCode,
  loadUiPacks,
  mergePacks,
  platformLocales,
  resolveContentLocale,
  resolveUiLocale,
  setSiteDefaultLocale,
  siteDefaultLocale,
  siteLocaleCodes,
  siteLocaleRows,
  siteLocales,
  TERMINAL_LOCALE,
  upsertPlatformLocale,
} from "../platform/i18n";
import { activeTheme } from "../extensions/theme/runtime-declarative";
import {
  listOwnerTableDefs,
  refreshThemeTableI18n,
} from "../extensions/theme/tables";
import { tableBySlug, tableDelete, tableList, tableSave, tableAggregate, deriveSlug, resolveTableForSite } from "../extensions/theme/table-facade";





/** Settings key holding the site-level admin menu customization blob. */

/** Locale keys inside a `label` override object. */
/** Upper bound of per-label languages (the admin offers far fewer today). */
/** Sidebar item keys: core ids, `cpt:<name>`, `menu:<menu_id>`. */
/** Group ids are the SPA's built-in group keys (kebab-case). */







export async function handleApi(env: Env, request: Request): Promise<Response> {
  const clientIp = getClientIp(request);
  setCurrentIp(clientIp);
  try {
    return await routeApi(env, request);
  } catch (e) {
    // Without this the exception escapes to the runtime, which answers with a
    // platform error page instead of JSON. `state.js` parses that as `{}` and
    // reports the opaque "Request failed", so the real cause is invisible from
    // the client and undiagnosable without live logs. Returning the message
    // keeps the failure legible; `console.error` keeps it in Workers Logs.
    const message = e instanceof Error ? e.message : String(e);
    console.error("api error:", message);
    return ok({ error: message }, 500);
  }
}



async function routeApi(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  // ⚠️ The *unprefixed* `/api/v1/front/…` path is answered here too, but with
  // the default site (the site is not known yet at this point). A site mounted
  // on a path prefix reaches its own front API through `index.ts`, which
  // resolves the site first and calls `handleFrontApi` with the stripped path
  // — see the call site. Reaching it here means "no site prefix in the URL",
  // i.e. the default site.
  if (url.pathname.startsWith("/api/v1/front/")) {
    await bootstrapAdmin(env);
    return handleFrontApi(env, request, DEFAULT_SITE_ID, url.pathname);
  }
  await bootstrapAdmin(env);
  const path = url.pathname.replace(/^\/api\/v1\/?/, "");
  const method = request.method;

  if (path === "health" && method === "GET") return ok({ ok: true, version: VERSION });
  if ((path === "openapi.json" || path === "openapi") && method === "GET") {
    return ok(generateOpenApiSchema(url.origin));
  }
  // ⚠️ 登录端点已迁至 `/{admin.path}/api/login`（见 index.ts）——这里是后台唯一
  // 未鉴权、可被爆破的端点，因此必须与后台前缀一起隐身。旧路径一律 404。
  if (path === "auth/logout" && method === "POST") return logout(env, request, await adminPath(env));

  let user: SessionUser | null = null;
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer cfp_")) {
    const apiKeyUser = await authenticateApiKey(env, authHeader.slice(7).trim());
    if (!apiKeyUser) return ok({ error: "Unauthorized" }, 401);
    user = apiKeyUser;
  } else {
    const adminUser = await currentUser(env, request);
    if (adminUser) user = adminUser;
  }

  if (path === "auth/me" && method === "GET") {
    return user ? ok({ user }) : ok({ user: null }, 401);
  }

  if (!user) {
    return ok({ error: "Unauthorized" }, 401);
  }
  const siteId = requestSiteId(url);
  // Malformed `?site=` never falls back to another tenant's data (MS-2.4).
  if (siteParamMalformed(url)) return ok({ error: "invalid site" }, 400);

  // Cross-cutting gates
  if ((path === "posts" || path === "pages" || /^posts\//.test(path) || /^pages\//.test(path) || path === "content" || /^content\//.test(path) || path === "terms" || /^terms\//.test(path) || /^taxonomies\//.test(path) || path === "comments" || /^comments\//.test(path) || path === "members" || /^members\//.test(path)) && method !== "GET") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
  }
  if (path === "media" && method === "POST" && !(await requirePermission(env, user, "media.write", siteId))) return ok({ error: "Forbidden" }, 403);

  if (method === "GET" && /^(comments|members|posts|pages|content\/|search|media|settings|features|dashboard|stats|taxonomies|terms|tables|widgets|menus|menu_items|redirects|rewrites|locales|theme\/|theme-tables|backup|i18n\/(locales|overrides|translations|messages|ui-locale))/.test(path)) {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
  }

  // Domain dispatchers
  const resAuth = await dispatchAuthAdminRoutes(env, request, user, path, method);
  if (resAuth) return resAuth;

  const resMenu = await dispatchAdminMenuCustomRoutes(env, request, user, siteId, path, method);
  if (resMenu) return resMenu;

  const resSite = await dispatchSiteAdminRoutes(env, request, user, siteId, path, method, url);
  if (resSite) return resSite;

  const resI18n = await dispatchI18nAdminRoutes(env, request, user, siteId, path, method, url);
  if (resI18n) return resI18n;

  const resThemeTable = await dispatchThemeTableAdminRoutes(env, request, user, siteId, path, method, url);
  if (resThemeTable) return resThemeTable;

  const resDash = await dispatchDashboardAndBlockRoutes(env, request, user, siteId, path, method, url);
  if (resDash) return resDash;

  const resContent = await dispatchContentAdminRoutes(env, request, user, siteId, path, method, url);
  if (resContent) return resContent;

  const resTax = await dispatchTaxonomyAndTermRoutes(env, request, user, siteId, path, method, url);
  if (resTax) return resTax;

  const resMedia = await dispatchMediaAdminRoutes(env, request, user, siteId, path, method, url);
  if (resMedia) return resMedia;

  const resSettings = await dispatchSettingsAdminRoutes(env, request, user, siteId, path, method, url);
  if (resSettings) return resSettings;

  const resBackup = await dispatchBackupAdminRoutes(env, request, user, siteId, path, method, url);
  if (resBackup) return resBackup;

  const resNav = await dispatchNavAndWidgetRoutes(env, request, user, siteId, path, method, url);
  if (resNav) return resNav;

  const resExt = await dispatchExtensionAdminRoutes(env, request, user, siteId, path, method, url);
  if (resExt) return resExt;

  const resComments = await dispatchCommentsAndMemberRoutes(env, request, user, siteId, path, method, url);
  if (resComments) return resComments;

  const resUsers = await dispatchUserAndActivityRoutes(env, request, user, siteId, path, method);
  if (resUsers) return resUsers;

  return ok({ error: "Not found" }, 404);
}

// ---------------------------------------------------------------------------
// Domain Route Dispatchers
// ---------------------------------------------------------------------------

async function dispatchAuthAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  path: string,
  method: string
): Promise<Response | null> {
  // -- self-service credentials (any signed-in role) -----------------------
  if (path === "auth/password" && method === "POST") {
    const b = await jsonBody(request);
    const result = await changePassword(env, user.id, String(b.current_password ?? ""), String(b.new_password ?? ""));
    if (result === "weak") return ok({ error: "weak" }, 400);
    if (result === "wrong_current") return ok({ error: "wrong_current" }, 403);
    await activity(env, user.id, "update", "user_password", user.id, {});
    return ok({ ok: true });
  }
  if (path === "auth/username" && method === "POST") {
    const b = await jsonBody(request);
    const wanted = String(b.username ?? "").trim();
    const result = await changeUsername(env, user.id, String(b.current_password ?? ""), wanted);
    if (result === "invalid") return ok({ error: "invalid" }, 400);
    if (result === "taken") return ok({ error: "taken" }, 409);
    if (result === "wrong_current") return ok({ error: "wrong_current" }, 403);
    await activity(env, user.id, "update", "user_username", user.id, { username: wanted });
    return ok({ ok: true, username: wanted });
  }

  // -- per-user sidebar menu configuration ---------------------------------
  if (path === "admin-menus/prefs" && method === "GET") {
    return ok({ hidden: await getMenuPrefs(env, user.id) });
  }
  if (path === "admin-menus/prefs" && method === "PUT") {
    const b = await jsonBody(request);
    if (!Array.isArray(b.hidden)) return ok({ error: "hidden must be an array of nav keys" }, 400);
    const hidden = [...new Set((b.hidden as unknown[]).map((v: unknown) => String(v)).filter((s: string) => s && s.length <= 120))].slice(0, 200);
    await setMenuPrefs(env, user.id, hidden);
    await activity(env, user.id, "update", "menu_prefs", user.id, { count: hidden.length });
    return ok({ ok: true, hidden });
  }

  // -- machine-to-machine API keys (for AI Agents and automation) ----------
  if (path === "auth/api-keys" && method === "GET") {
    const keys = await listApiKeys(env, user.role === SUPERADMIN_ROLE ? undefined : user.id);
    return ok({ items: keys, keys });
  }
  if (path === "auth/api-keys" && method === "POST") {
    const b = await jsonBody(request);
    const name = String(b.name || "").trim();
    if (!name) return ok({ error: "Name is required" }, 400);
    const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : ["*"];
    const sites = Array.isArray(b.sites) ? b.sites.map(String) : ["*"];
    const expiresInDays = b.expires_in_days ? Number(b.expires_in_days) : null;
    const created = await createApiKey(env, user.id, name, scopes, sites, expiresInDays);
    await activity(env, user.id, "create", "api_key", created.id, { name, scopes, sites });
    return ok({ key: created, ...created }, 201);
  }
  const matchRevokeKey = path.match(/^auth\/api-keys\/([^/]+)$/);
  if (matchRevokeKey && method === "DELETE") {
    const keyId = decodeURIComponent(matchRevokeKey[1]);
    const success = await revokeApiKey(env, keyId, user.role === SUPERADMIN_ROLE ? undefined : user.id);
    if (!success) return ok({ error: "API key not found" }, 404);
    await activity(env, user.id, "revoke", "api_key", keyId, {});
    return ok({ ok: true });
  }

  return null;
}


async function dispatchSiteAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // Sites registry (multi-site)
  if (path === "sites" && method === "GET") {
    const allowed = await accessibleSiteIds(env, user);
    const items = (await listSites(env)).filter(
      (s: any) => allowed === null || allowed.includes(String(s.id))
    );
    if (url.searchParams.get("withCounts") === "1") {
      const themeRows = await env.DB.prepare("SELECT site_id, value FROM settings WHERE key='theme.active'").all().catch(() => ({ results: [] }));
      const themes = Object.fromEntries(((themeRows.results as any[]) ?? []).map((r) => [String(r.site_id), String(r.value ?? "")]));
      const [posts, pages] = await Promise.all([
        env.DB.prepare("SELECT site_id, COUNT(*) AS count FROM posts WHERE type='post' GROUP BY site_id").all(),
        env.DB.prepare("SELECT site_id, COUNT(*) AS count FROM posts WHERE type='page' GROUP BY site_id").all(),
      ]);
      const mediaCounts: Record<string, number> = {};
      for (const s of items as any[]) {
        const sid = String((s as any).id);
        try {
          const pol = await readMediaPolicy(env, sid);
          const oc = mediaOwnerClause(pol, user.id);
          const c = await env.DB.prepare(`SELECT COUNT(*) AS count FROM media_files WHERE site_id=?${oc.sql}`).bind(sid, ...oc.binds).first<any>();
          mediaCounts[sid] = Number(c?.count ?? 0) || 0;
        } catch {
          mediaCounts[sid] = 0;
        }
      }
      const bySite = (r: any) => Object.fromEntries(((r.results as any[]) ?? []).map((x) => [String(x.site_id), Number(x.count) || 0]));
      const postCounts = bySite(posts);
      const pageCounts = bySite(pages);
      return ok({
        items: items.map((s) => ({
          ...s,
          counts: {
            posts: postCounts[s.id] ?? 0,
            pages: pageCounts[s.id] ?? 0,
            media: mediaCounts[s.id] ?? 0,
          },
          theme: themes[s.id] ?? "",
        })),
      });
    }
    return ok({ items });
  }
  if (path === "sites" && method === "POST") {
    if(!(await requirePermission(env,user,"platform.manage",siteId))) return ok({error:"Forbidden"},403);
    const b = await jsonBody(request);
    const themeToActivate = typeof b.theme === "string" && b.theme.trim() ? b.theme.trim() : null;
    if (themeToActivate) {
      const themeRow = await env.DB.prepare("SELECT name FROM theme_installs WHERE name=? LIMIT 1").bind(themeToActivate).first<any>();
      if (!themeRow) return ok({ error: "theme not found" }, 400);
    }
    const r = await createSite(env, { id: b.id, name: String(b.name ?? ""), host: b.host ?? null, pathPrefix: b.path_prefix !== undefined ? b.path_prefix : (b.pathPrefix ?? null) });
    if ("error" in r) return ok({ error: r.error }, 400);
    if (themeToActivate) {
      try {
        await activateThemeForSite(env, themeToActivate, r.id, user.id);
      } catch (err: any) {
        return ok({ error: err.message }, 400);
      }
    }
    await activity(env, user.id, "create", "site", r.id, { name: b.name, theme: themeToActivate });
    return ok({ id: r.id }, 201);
  }
  const siteMatch = path.match(/^sites\/([^/]+)$/);
  if (siteMatch) {
    if (method === "GET") {
      const allowed = await accessibleSiteIds(env, user);
      if (allowed !== null && !allowed.includes(siteMatch[1])) return ok({ error: "Forbidden" }, 403);
      const site = (await listSites(env)).find((s: any) => String(s.id) === siteMatch[1]);
      if (!site) return ok({ error: "site not found" }, 404);
      const activeT = await activeTheme(env, siteMatch[1]).catch(() => null);
      const defLocale = await siteDefaultLocale(env, siteMatch[1]);
      const locs = await siteLocaleCodes(env, siteMatch[1]);
      return ok({ site: { ...site, active_theme: activeT?.name ?? null, default_locale: defLocale, enabled_locales: locs } });
    }
    if (method === "PUT" || method === "PATCH") {
      if(!(await requirePermission(env,user,"platform.manage",siteId))) return ok({error:"Forbidden"},403);
      const b = await jsonBody(request);
      const r = await updateSite(env, siteMatch[1], { name: b.name, host: b.host, pathPrefix: b.path_prefix !== undefined ? b.path_prefix : b.pathPrefix, status: b.status });
      if ("error" in r) return ok({ error: r.error }, 404);
      const themeToActivate = typeof b.theme === "string" && b.theme.trim() ? b.theme.trim() : null;
      if (themeToActivate) {
        try {
          await activateThemeForSite(env, themeToActivate, siteMatch[1], user.id);
        } catch (err: any) {
          return ok({ error: err.message }, 400);
        }
      }
      await activity(env, user.id, "update", "site", siteMatch[1], { theme: themeToActivate });
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      if(!(await requirePermission(env,user,"platform.manage",siteId))) return ok({error:"Forbidden"},403);
      let generatedTables: string[] = [];
      let generatedSidecars: string[] = [];
      try {
        const defs = await env.DB.prepare(
          "SELECT table_name, i18n_table FROM theme_table_defs WHERE site_id=?"
        ).bind(siteMatch[1]).all();
        const mains = new Set<string>();
        const sides = new Set<string>();
        for (const d of ((defs.results as any[]) ?? [])) {
          if (typeof d.table_name === "string" && /^[a-z][a-z0-9_]*$/.test(d.table_name)) mains.add(d.table_name);
          if (typeof d.i18n_table === "string" && /^[a-z][a-z0-9_]*$/.test(d.i18n_table)) sides.add(d.i18n_table);
        }
        generatedTables = [...mains];
        generatedSidecars = [...sides];
      } catch { generatedTables = []; generatedSidecars = []; }
      const r = await deleteSite(env, siteMatch[1], PURGE_ON_SITE_DELETE);
      if ("error" in r) return ok({ error: r.error }, 400);
      for (const t of generatedTables) {
        try { await env.DB.prepare(`DELETE FROM ${t} WHERE site_id=?`).bind(siteMatch[1]).run(); }
        catch { /* a dropped/missing physical table is already gone */ }
      }
      for (const s of generatedSidecars) {
        const parent = s.replace(/_i18n$/, "");
        if (!generatedTables.includes(parent)) continue;
        try { await env.DB.prepare(`DELETE FROM ${s} WHERE row_id NOT IN (SELECT id FROM ${parent})`).run(); }
        catch { /* sidecar already gone */ }
      }
      await activity(env, user.id, "delete", "site", siteMatch[1]);
      return ok({ ok: true });
    }
  }
  const siteLocMatch = path.match(/^sites\/([^/]+)\/locales$/);
  if (siteLocMatch && method === "GET") {
    const sid = siteLocMatch[1];
    const allowed = await accessibleSiteIds(env, user);
    if (allowed !== null && !allowed.includes(sid)) return ok({ error: "Forbidden" }, 403);
    return ok({
      site: sid,
      default: await siteDefaultLocale(env, sid),
      enabled: await siteLocaleCodes(env, sid),
      items: await siteLocaleRows(env, sid),
    });
  }

  return null;
}



async function dispatchDashboardAndBlockRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if ((path === "dashboard" || path === "stats") && method === "GET") {
    const mediaPolicy = await readMediaPolicy(env, siteId);
    const mediaOwner = mediaOwnerClause(mediaPolicy, user.id);
    const [posts, pages, media, drafts, published, recent] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM posts WHERE site_id=? AND type='post'").bind(siteId).first<any>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM posts WHERE site_id=? AND type='page'").bind(siteId).first<any>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM media_files WHERE site_id=?${mediaOwner.sql}`).bind(siteId, ...mediaOwner.binds).first<any>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM posts WHERE site_id=? AND status='draft'").bind(siteId).first<any>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM posts WHERE site_id=? AND status='published'").bind(siteId).first<any>(),
      env.DB.prepare(
        `SELECT p.id, p.type, p.status, p.updated_at, t.locale, t.title
           FROM posts p LEFT JOIN post_translations t ON t.post_id = p.id
          WHERE p.site_id = ?
          ORDER BY p.updated_at DESC LIMIT 5`
      ).bind(siteId).all()
    ]);
    return ok({
      counts: {
        posts: Number(posts?.count ?? 0),
        pages: Number(pages?.count ?? 0),
        media: Number(media?.count ?? 0),
        drafts: Number(drafts?.count ?? 0),
        published: Number(published?.count ?? 0),
      },
      cards: await (async () => {
        const uiLocale = await resolveUiLocale(env, siteId, {
          userLang: (user as any).ui_lang ?? null,
          defaultLocale: await siteDefaultLocale(env, siteId),
        });
        const dict = mergePacks(await loadUiPacks(env, siteId, uiLocale));
        const label = (k: string, fb: string) => {
          const v = dict[`core.dashboard.${k}`];
          return typeof v === "string" && v ? v : fb;
        };
        const cards = [
          { key: "posts", label: label("posts", "Posts"), value: posts?.count ?? 0, note: `${published?.count ?? 0} ${label("published", "published")}` },
          { key: "pages", label: label("pages", "Pages"), value: pages?.count ?? 0 },
          { key: "media", label: label("media", "Media"), value: media?.count ?? 0 },
          { key: "drafts", label: label("drafts", "Drafts"), value: drafts?.count ?? 0, note: label("awaiting", "awaiting review") },
        ];
        try {
          const filtered = await applyFilters("dashboardCards", { env, siteId }, cards);
          return Array.isArray(filtered) ? filtered : cards;
        } catch {
          return cards;
        }
      })(),
      recent: recent?.results ?? [],
      site: siteId,
    });
  }

  if (path === "blocks" && method === "GET") {
    const available = await availableUiLocales(env, siteId);
    const wanted = String(url.searchParams.get("locale") ?? "").trim();
    const uiLocale = wanted && available.includes(wanted)
      ? wanted
      : await resolveUiLocale(env, siteId, {
          userLang: (user as any).ui_lang ?? null,
          defaultLocale: await siteDefaultLocale(env, siteId),
        });
    const dict = mergePacks(await loadUiPacks(env, siteId, uiLocale));
    const t = (key: string, fallback: string) => {
      const v = dict[key];
      return typeof v === "string" && v ? v : fallback;
    };
    const items = CORE_BLOCKS.map((b) => ({
      type: b.name,
      label: t(`core.block.${b.name.slice("core/".length)}`, b.title),
      category: b.category,
      children: b.children === true,
      attrs: b.attrs.map((a) => ({
        key: a.key,
        type: a.type,
        label: t(a.labelKey, a.fallback),
        required: a.required === true,
        ...(a.itemKeys ? { itemKeys: a.itemKeys } : {}),
      })),
    }));
    return ok({ items, site: siteId });
  }

  return null;
}

async function dispatchCommentsAndMemberRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // Comments API
  if (path === "comments" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const status = url.searchParams.get("status") || "all";
    const post_id = url.searchParams.get("post_id") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const page = Number(url.searchParams.get("page") || 1);
    const limit = Number(url.searchParams.get("limit") || 20);
    const data = await getAdminComments(env, siteId, { status, post_id, q, page, limit });
    return ok(data);
  }

  if (path === "comments" && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const parentId = String(b.parent_id || "").trim();
    const content = String(b.content || "").trim();
    if (!parentId || !content) return ok({ error: "parent_id and content required" }, 400);
    const res = await replyComment(env, siteId, parentId, content, user);
    return ok(res, res.status);
  }

  const commentItem = path.match(/^comments\/([^/]+)$/);
  if (commentItem && method === "PATCH") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const id = commentItem[1];
    const b = await jsonBody(request);
    const status = String(b.status || "");
    const res = await updateCommentStatus(env, siteId, id, status as any);
    return ok(res, res.status);
  }

  if (commentItem && method === "DELETE") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const id = commentItem[1];
    const res = await deleteComment(env, siteId, id);
    return ok(res, res.status);
  }

  if (path === "comments/batch" && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const action = String(b.action || "");
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length) return ok({ error: "ids required" }, 400);
    if (action === "delete") {
      const res = await batchDeleteComments(env, siteId, ids);
      return ok(res);
    }
    const res = await batchCommentStatus(env, siteId, ids, action as any);
    return ok(res);
  }

  // Members API (Front-end members management)
  if (path === "members" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const q = url.searchParams.get("q") || "";
    const status = url.searchParams.get("status") || "";
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 20)));
    const offset = (page - 1) * limit;

    const conditions = ["m.site_id = ?"];
    const params: any[] = [siteId];

    if (status && status !== "all") {
      conditions.push("m.status = ?");
      params.push(status);
    }
    if (q) {
      conditions.push("(m.username LIKE ? OR m.email LIKE ? OR m.display_name LIKE ?)");
      const pattern = `%${q}%`;
      params.push(pattern, pattern, pattern);
    }

    const whereClause = conditions.join(" AND ");
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM members m WHERE ${whereClause}`)
      .bind(...params)
      .first<{ total: number }>();
    const total = Number(totalRow?.total || 0);

    const rows = await env.DB.prepare(
      `SELECT m.id, m.site_id, m.username, m.email, m.display_name, m.role, m.status, m.created_at, m.updated_at,
              (SELECT COUNT(*) FROM comments c WHERE c.site_id = m.site_id AND c.author_member_id = m.id) AS comments_count,
              (SELECT COUNT(*) FROM posts p WHERE p.site_id = m.site_id AND p.author_member_id = m.id) AS posts_count
       FROM members m
       WHERE ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...params, limit, offset)
      .all<any>();

    return ok({
      items: (rows.results as any[]) || [],
      total,
      page,
      limit,
      site: siteId,
    });
  }

  if (path === "members" && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    const email = b.email ? String(b.email).trim() : null;
    const displayName = b.display_name ? String(b.display_name).trim() : null;
    const status = b.status && ["active", "banned", "suspended"].includes(b.status) ? b.status : "active";

    if (!validMemberUsername(username)) {
      return ok({ error: "Username must be 3-32 characters (letters, numbers, ._-)" }, 400);
    }
    if (password.length < 8) {
      return ok({ error: "Password must be at least 8 characters" }, 400);
    }

    const clash = await env.DB.prepare("SELECT id FROM members WHERE site_id = ? AND username = ? LIMIT 1")
      .bind(siteId, username)
      .first<any>();
    if (clash) {
      return ok({ error: "Username is already taken on this site" }, 409);
    }

    const id = "member_" + (await randomId());
    const passHash = await hashPassword(password, { iterations: passwordIterations(env) });
    const ts = now();
    await env.DB.prepare(
      "INSERT INTO members (id, site_id, username, email, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id, siteId, username, email, displayName, passHash, "member", status, ts, ts)
      .run();

    return ok({ ok: true, id }, 201);
  }

  const memberItem = path.match(/^members\/([^/]+)$/);
  if (memberItem && method === "PATCH") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const id = memberItem[1];
    const b = await jsonBody(request);
    const allowed = ["active", "banned", "suspended"];
    if (b.status && !allowed.includes(b.status)) return ok({ error: "invalid status" }, 400);

    const updates: string[] = ["updated_at = ?"];
    const params: any[] = [now()];

    if (b.status) {
      updates.push("status = ?");
      params.push(b.status);
    }
    if (b.display_name !== undefined) {
      updates.push("display_name = ?");
      params.push(b.display_name ? String(b.display_name).trim() : null);
    }
    if (b.email !== undefined) {
      updates.push("email = ?");
      params.push(b.email ? String(b.email).trim() : null);
    }
    if (b.password) {
      const pass = String(b.password);
      if (pass.length < 8) return ok({ error: "Password must be at least 8 characters" }, 400);
      const passHash = await hashPassword(pass, { iterations: passwordIterations(env) });
      updates.push("password_hash = ?");
      params.push(passHash);
    }

    params.push(id, siteId);
    const res = await env.DB.prepare(`UPDATE members SET ${updates.join(", ")} WHERE id = ? AND site_id = ?`)
      .bind(...params)
      .run();

    if (res.meta.changes === 0) return ok({ error: "Member not found" }, 404);
    return ok({ ok: true });
  }

  if (memberItem && method === "DELETE") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const id = memberItem[1];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM members WHERE id = ? AND site_id = ?").bind(id, siteId),
      env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ? AND site_id = ?").bind(id, siteId),
    ]);
    return ok({ ok: true });
  }

  return null;
}

async function dispatchUserAndActivityRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "users" && method === "GET") {
    if (!(await requirePermission(env, user, "users.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const isSuper = user.role === SUPERADMIN_ROLE;
    const r = await env.DB.prepare("SELECT id,username,email,role,status,created_at,updated_at FROM site_users ORDER BY username").all();
    const rows = ((r.results as any[]) ?? []);
    const memberships = await env.DB.prepare("SELECT user_id, site_id, role FROM site_users_sites").all<any>();
    const byUser: Record<string, Record<string, string>> = {};
    for (const m of (memberships.results as any[]) ?? []) {
      (byUser[String(m.user_id)] ??= {})[String(m.site_id)] = String(m.role);
    }
    // Tenant Scoping Guard: If not superadmin, only show members of this site and mask other sites
    const visibleRows = isSuper
      ? rows
      : rows.filter((u) => byUser[String(u.id)]?.[siteId] || u.role === SUPERADMIN_ROLE);

    return ok({
      items: visibleRows.map((u) => ({
        ...u,
        sites: isSuper ? (byUser[String(u.id)] ?? {}) : { [siteId]: byUser[String(u.id)]?.[siteId] || u.role },
        role_here: byUser[String(u.id)]?.[siteId] ?? null,
      })),
      site: siteId,
    });
  }
  if (path === "users" && method === "POST") {
    if (!(await requirePermission(env, user, "users.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const role = String(b.role || "author");
    if (!SITE_ROLES.includes(role as any)) return ok({ error: "invalid role" }, 400);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    if (!username || password.length < 8) return ok({ error: "username and password(min 8) required" }, 400);
    const { hashPassword, passwordIterations } = await import("../shared/crypto");
    const id = "user_" + await randomId();
    const stmts = [
      env.DB.prepare("INSERT INTO site_users(id,username,email,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, username, b.email || null, await hashPassword(password, { iterations: passwordIterations(env) }), role, "active", now(), now()),
      env.DB.prepare("INSERT INTO site_users_sites(user_id,site_id,role,created_at) VALUES(?,?,?,?)")
        .bind(id, siteId, role, now()),
    ];
    await env.DB.batch(stmts);
    await activity(env, user.id, "create", "user", id, { username, role, site: siteId });
    return ok({ id }, 201);
  }
  const userSite = path.match(/^users\/([^/]+)\/sites\/([^/]+)$/);
  if (userSite && (method === "PUT" || method === "PATCH")) {
    if (!(await requirePermission(env, user, "users.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const targetUser = userSite[1];
    const targetSite = decodeURIComponent(userSite[2]);
    const b = await jsonBody(request);
    const role = b.role === null || b.role === "" ? null : String(b.role);
    if (role !== null && !SITE_ROLES.includes(role as any)) return ok({ error: "invalid role" }, 400);
    const exists = await env.DB.prepare("SELECT id FROM site_users WHERE id=?").bind(targetUser).first<any>();
    if (!exists) return ok({ error: "user not found" }, 404);
    if (role === null) {
      await env.DB.prepare("DELETE FROM site_users_sites WHERE user_id=? AND site_id=?").bind(targetUser, targetSite).run();
      await activity(env, user.id, "revoke", "user_site", targetUser, { site: targetSite });
      return ok({ ok: true, role: null });
    }
    await env.DB.prepare(
      "INSERT INTO site_users_sites(user_id,site_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,site_id) DO UPDATE SET role=excluded.role"
    ).bind(targetUser, targetSite, role, now()).run();
    await activity(env, user.id, "grant", "user_site", targetUser, { site: targetSite, role });
    return ok({ ok: true, role });
  }

  if (path === "activity" && method === "GET") {
    if (!(await requirePermission(env, user, "platform.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM admin_activity ORDER BY created_at DESC LIMIT 100").all();
    const items = ((rows.results as any[]) ?? []).map((r) => {
      let ip = r.ip || null;
      if (!ip && r.meta) {
        try {
          const parsed = JSON.parse(r.meta);
          if (parsed && typeof parsed === "object" && parsed.ip) ip = String(parsed.ip);
        } catch {}
      }
      return { ...r, ip: ip || "—" };
    });
    return ok({ items });
  }

  return null;
}
