/**
 * The settings domain: the site's key/value settings, the feature switches
 * layered on top of them, and the platform-level settings (which own
 * `admin.path` — the one key that is also a route, and the reason saving one
 * has to re-issue the caller's session cookie).
 *
 * Extracted from `src/api.ts` (refactor plan §5).
 */
import { Env, SessionUser } from "../shared/types";
import { activity, jsonBody, ok } from "../shared/repo";
import { rescopeSessionCookie } from "../platform/auth";
import {
  SETTING_DEFS,
  adminPath,
  getSetting,
  isDeclaredSetting,
  platformSetting,
  resetAdminPathMemo,
  setPlatformSetting,
  setSetting,
  settingDef,
} from "../platform/settings";
import { randomId } from "../shared/crypto";
import { featureSnapshot, inheritedValue, truthy, FEATURE_SETTINGS_KEY, FEATURE_SWITCHES } from "../shared/features";
import { requestSiteId } from "./core";
import { requirePermission } from "../platform/permissions";
import { seedDemoContent } from "./seed";
import { setUserUiLang } from "../platform/auth";
import { corePackLocaleEntries, corePackLocales } from "../platform/i18n/core-pack";
import { disableSiteLocale, enableSiteLocale, isLocaleCode, platformLocales, setSiteDefaultLocale, siteDefaultLocale, siteLocaleCodes, siteLocaleRows, siteLocales, upsertPlatformLocale } from "../platform/i18n/locale-registry";
import { availableUiLocaleEntries, availableUiLocales, loadUiPacks, resolveUiLocale } from "../platform/i18n/packs";
import { mergePacks } from "../platform/i18n/translate";
import { bumpContentCache } from "../shared/cache";
import { refreshThemeTableI18n } from "../extensions/theme/tables";
import { now } from "../shared/repo";
import { GROUP_SQL, freeSlug, groupOf, translationGroup } from "./content";

export async function settings(env: Env, siteId: string) {
  const rows = await env.DB.prepare("SELECT key, value, autoload FROM settings WHERE site_id=? ORDER BY key").bind(siteId).all();
  // Sensitive values (today the two image-host API keys) are never echoed:
  // every site member passes the read gate, and a key in many hands is quota
  // abuse waiting to happen. The write path keeps a blank write (`setSetting`
  // preserves on empty), so a redacted value round-trips safely through any
  // form that saves what it displayed.
  const items = ((rows.results as any[]) ?? []).map((r) =>
    settingDef(String(r.key))?.sensitive ? { ...r, value: "" } : r);
  return ok({ items, site: siteId });
}

/**
 * Read the platform feature switches for a site.
 *
 * Returns every declared switch with its resolved value **and where that value
 * came from** (`site` / `var` / `default`). The admin needs the provenance: a
 * checkbox that reads "off" because nobody set anything looks identical to one
 * that reads "off" because the operator turned it off, and only one of those
 * is worth acting on.
 *
 * `_kvWrites`-style honesty applies here too — the screen shows the *effective*
 * value, and the effective value is exactly what the runtime consumes, because
 * both go through `featureSnapshot()` / `featureEnabled()`.
 */
export async function features(env: Env, siteId: string) {
  const snapshot = await featureSnapshot(env, siteId);
  const items = FEATURE_SWITCHES.map((s) => ({
    key: s.key,
    label: s.label,
    var: s.varName,
    default_on: s.defaultOn,
    enabled: snapshot[s.key].enabled,
    source: snapshot[s.key].source,
    // What the value would be if this site's row were removed — lets the admin
    // offer "reset to inherit" without a second round trip.
    inherited: inheritedValue(env, s),
  }));
  return ok({ items, site: siteId, settings_key: FEATURE_SETTINGS_KEY });
}

/**
 * Save one switch for a site.
 *
 * Stored as a single JSON object under one settings key rather than one row per
 * switch, so adding a switch is a code change with no migration and no chance
 * of a half-populated row. Unknown keys are rejected rather than ignored: a
 * typo that silently persists a key nothing reads is precisely the "declared
 * but never consumed" defect this repo keeps re-fixing.
 */
export async function saveFeature(env: Env, userId: string, body: any, siteId: string) {
  const key = String(body.key ?? "");
  if (!key) return ok({ error: "key required" }, 400);
  // `featureSwitch()` throws on an unknown key; turn that into a 400 rather
  // than a 500, since it is caller input.
  if (!FEATURE_SWITCHES.some((s) => s.key === key)) {
    return ok({ error: `unknown feature switch: ${key}` }, 400);
  }

  const existing = await env.DB.prepare("SELECT id, value FROM settings WHERE site_id=? AND key=?")
    .bind(siteId, FEATURE_SETTINGS_KEY)
    .first<any>();
  let current: Record<string, unknown> = {};
  if (existing?.value != null) {
    try {
      const parsed = JSON.parse(String(existing.value));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
    } catch {
      /* a corrupt row is replaced rather than propagated */
    }
  }

  // `value: null` means "stop overriding on this site", so the row falls back
  // to the var / default. Deleting the key outright keeps the row honest about
  // which switches the operator actually chose.
  if (body.value === null || body.value === undefined) {
    delete current[key];
  } else {
    current[key] = truthy(body.value);
  }

  const next = JSON.stringify(current);
  if (existing) {
    await env.DB.prepare("UPDATE settings SET value=? WHERE site_id=? AND id=?").bind(next, siteId, existing.id).run();
  } else {
    await env.DB.prepare("INSERT INTO settings (id, site_id, key, value, autoload) VALUES (?, ?, ?, ?, 1)")
      .bind(await randomId(), siteId, FEATURE_SETTINGS_KEY, next).run();
  }
  await activity(env, userId, "update", "feature", key, { siteId, value: current[key] ?? null });
  const snapshot = await featureSnapshot(env, siteId);
  // ⚠️ Read the snapshot defensively, and *never* index it blindly.
  //
  // The guard above already rejects unknown keys, so in theory this cannot be
  // undefined. But "in theory" is what the reverse-validation tool disproved:
  // neutralizing the guard does not turn the route into a permissive one, it
  // turns it into a **500**. `featureSnapshot()` only emits keys from
  // `FEATURE_SWITCHES`, so an unvalidated key yields `undefined` here and the
  // spread below throws on `.enabled`.
  //
  // A 500 on caller input is the wrong contract twice over: it hides the real
  // problem from the caller, and it means the only observable difference between
  // "the guard is present" and "the guard was deleted" is an unhandled
  // exception. Reporting the resolved state through an optional read keeps the
  // response shape stable and makes the failure legible.
  const resolved = snapshot[key];
  if (!resolved) {
    // Unreachable while the guard above stands; kept as the honest answer if it
    // ever does not.
    return ok({ error: `switch not resolvable: ${key}` }, 400);
  }
  return ok({ ok: true, key, enabled: resolved.enabled, source: resolved.source });
}

export async function saveSetting(env: Env, userId: string, body: any, siteId: string) {
  const key = String(body.key ?? "");
  if (!key) return ok({ error: "key required" }, 400);
  if (!isDeclaredSetting(key)) return ok({ error: `undeclared setting key: ${key}` }, 400);
  if (settingDef(key)!.scope !== "site") {
    return ok({ error: `setting ${key} is not site-scoped (use the platform settings endpoint)` }, 400);
  }
  // `value: null` is the explicit "clear this key" signal (the SPA's per-key
  // Clear button), which `setSetting` implements as a row delete; a missing
  // `value` is a blank string, which keeps a sensitive value. Keeping the two
  // apart is what stops "I never saw the secret" from meaning "delete it".
  const value = body.value === null ? null : String(body.value ?? "");
  await setSetting(env, siteId, key, value);
  await activity(env, userId, "update", "setting", key, { siteId, cleared: value === null });
  return ok({ ok: true });
}

/**
 * Platform-scoped settings: one row for the whole install, readable and
 * writable only with `platform.manage`.
 *
 * These are the keys that mean the same thing for every site — where the admin
 * lives, whether registration is open — and they live in their own table
 * (`platform_settings`) rather than in `settings(site_id='*')`, because
 * `settings` is site-scoped and `deleteSite()` purges it per site.
 */
export async function platformSettingsList(env: Env) {
  const read = [];
  for (const d of SETTING_DEFS.filter((x) => x.scope === "platform")) {
    const value = await platformSetting(env, d.key);
    read.push({ key: d.key, value, default: d.default as string | null, type: d.type });
  }
  return ok({ items: read, install: "platform" });
}

export async function savePlatformSetting(env: Env, user: SessionUser, request: Request) {
  const body = await jsonBody(request);
  const key = String(body.key ?? "");
  if (!key) return ok({ error: "key required" }, 400);
  if (!isDeclaredSetting(key)) return ok({ error: `undeclared setting key: ${key}` }, 400);
  if (settingDef(key)!.scope !== "platform") {
    return ok({ error: `setting ${key} is not platform-scoped (use the site settings endpoint)` }, 400);
  }
  // `admin.path` is the one platform key that is also a *route*, so it has to
  // stay a shape the router and the SPA can both use: it must start with `/`,
  // must not end with one (the SPA appends its own segments), and must be
  // nothing but lowercase letters, digits, `-`, `_` and `/`. Rejecting here is
  // what stops an operator from typing themselves out of their own admin.
  if (key === "admin.path") {
    const value = String(body.value ?? "");
    if (!/^\/[a-z0-9/_-]*$/.test(value) || value.endsWith("/")) {
      return ok({ error: "admin.path must start with '/' and use only lowercase letters, digits, '-', '_' or '/'" }, 400);
    }
    if (value === "/") return ok({ error: "admin.path cannot be the site root" }, 400);
  }
  const value = body.value === null || body.value === undefined ? null : String(body.value);
  // Read the *old* prefix before the write, because the rename has two
  // consequences that are not "store a string":
  const previous = key === "admin.path" ? await adminPath(env) : null;
  await setPlatformSetting(env, key, value);
  await activity(env, user.id, "update", "platform-setting", key, { value });
  const res = ok({ ok: true, key, value });
  if (key === "admin.path") {
    // 1. Routing is live from the next request (`index.ts` drops the memo at
    //    the top of every fetch), but this request already read the *old*
    //    value into the memo — clear it so anything later in this same request
    //    sees where the admin actually is.
    resetAdminPathMemo(env);
    // 2. The caller's session cookie is scoped to the prefix they just left,
    //    so without this they are signed out by their own rename. Hand the
    //    same session back at the new address and expire the old cookie. This
    //    is what makes the change *live* rather than "reload and log in again".
    for (const cookie of rescopeSessionCookie(user.sessionId, previous ?? "/admin", String(value ?? ""))) {
      res.headers.append("Set-Cookie", cookie);
    }
  }
  return res;
}

export async function dispatchSettingsAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "settings" && method === "GET") return settings(env, siteId);
  if (path === "settings" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return saveSetting(env, user.id, await jsonBody(request), siteId);
  }
  if (path === "seed-demo" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    return seedDemoContent(env, siteId, user.id, { key: b?.key ? String(b.key) : undefined, locale: b?.locale ? String(b.locale) : undefined });
  }
  if (path === "platform-settings" && method === "GET") {
    if (!(await requirePermission(env, user, "platform.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return platformSettingsList(env);
  }
  if (path === "platform-settings" && method === "POST") {
    if (!(await requirePermission(env, user, "platform.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return savePlatformSetting(env, user, request);
  }

  if (path === "features" && method === "GET") return features(env, siteId);
  if (path === "features" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return saveFeature(env, user.id, await jsonBody(request), siteId);
  }

  return null;
}

export async function dispatchI18nAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "i18n/locales" && method === "GET") {
    const [rows, enabled, dictionary, uiLocales] = await Promise.all([
      siteLocaleRows(env, siteId),
      siteLocales(env, siteId),
      platformLocales(env),
      availableUiLocales(env, siteId),
    ]);
    return ok({
      site: siteId,
      items: rows,
      enabled: enabled.map((l) => l.code),
      default: await siteDefaultLocale(env, siteId),
      multilingual: enabled.length >= 2,
      dictionary,
      ui_locales: uiLocales,
      core_locales: corePackLocales(),
      core_entries: corePackLocaleEntries(),
    });
  }
  if (path === "i18n/locales" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const code = String(b.code ?? "").trim();
    if (!isLocaleCode(code)) return ok({ error: `invalid locale code: ${code}` }, 400);
    if (b.name) {
      await upsertPlatformLocale(env, {
        code,
        name: String(b.name),
        native_name: b.native_name ? String(b.native_name) : String(b.name),
        direction: b.direction === "rtl" ? "rtl" : "ltr",
        enabled: 1,
      });
    }
    await enableSiteLocale(env, siteId, code, { isDefault: b.is_default === true });
    const created = await refreshThemeTableI18n(env, siteId);
    await activity(env, user.id, "enable", "locale", code, { site: siteId, i18nTables: created });
    return ok({ ok: true, code, created_i18n_tables: created }, 201);
  }
  const localeMatch = path.match(/^i18n\/locales\/([A-Za-z0-9-]{2,10})$/);
  if (localeMatch) {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const code = localeMatch[1];
    if (method === "PATCH" || method === "PUT") {
      const b = await jsonBody(request);
      if (b.is_default === true) {
        try {
          await setSiteDefaultLocale(env, siteId, code);
        } catch (e: any) {
          return ok({ error: e?.message || "cannot set default locale" }, 400);
        }
      }
      await activity(env, user.id, "update", "locale", code, { site: siteId });
      return ok({ ok: true, default: await siteDefaultLocale(env, siteId) });
    }
    if (method === "DELETE") {
      try {
        await disableSiteLocale(env, siteId, code);
      } catch (e: any) {
        return ok({ error: e?.message || "cannot disable locale" }, 400);
      }
      await activity(env, user.id, "disable", "locale", code, { site: siteId });
      return ok({ ok: true, enabled: await siteLocaleCodes(env, siteId) });
    }
  }
  if (path === "i18n/dictionary" && method === "GET") {
    return ok({ items: await platformLocales(env), core: corePackLocales() });
  }
  if (path === "i18n/dictionary" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const code = String(b.code ?? "").trim();
    if (!isLocaleCode(code)) return ok({ error: `invalid locale code: ${code}` }, 400);
    await upsertPlatformLocale(env, {
      code,
      name: String(b.name ?? code),
      native_name: b.native_name ? String(b.native_name) : null,
      direction: b.direction === "rtl" ? "rtl" : "ltr",
      enabled: b.enabled === false ? 0 : 1,
      sort_order: Number(b.sort_order ?? 0),
    });
    return ok({ ok: true, code }, 201);
  }
  if (path === "i18n/ui-locale") {
    if (method === "GET") {
      const ui = await resolveUiLocale(env, siteId, {
        userLang: (user as any).ui_lang ?? null,
        defaultLocale: await siteDefaultLocale(env, siteId),
      });
      return ok({
        locale: ui,
        user_preference: (user as any).ui_lang ?? null,
        available: await availableUiLocales(env, siteId),
      });
    }
    if (method === "POST") {
      const b = await jsonBody(request);
      const wanted = String(b.locale ?? "").trim();
      if (!wanted) {
        await setUserUiLang(env, user.id, null);
        return ok({ ok: true, locale: null });
      }
      const available = await availableUiLocales(env, siteId);
      if (!available.includes(wanted)) {
        return ok({ error: `no interface pack for "${wanted}"`, available }, 400);
      }
      await setUserUiLang(env, user.id, wanted);
      return ok({ ok: true, locale: wanted });
    }
  }
  if (path === "i18n/messages" && method === "GET") {
    const available = await availableUiLocales(env, siteId);
    const wanted = String(url.searchParams.get("locale") ?? "").trim();
    const locale = wanted && available.includes(wanted)
      ? wanted
      : await resolveUiLocale(env, siteId, {
          userLang: (user as any).ui_lang ?? null,
          defaultLocale: await siteDefaultLocale(env, siteId),
        });
    const packs = await loadUiPacks(env, siteId, locale);
    return ok({ locale, available, ui_locales: await availableUiLocaleEntries(env, siteId), layers: packs.length, messages: mergePacks(packs) });
  }
  if (path === "i18n/overrides") {
    if (method === "GET") {
      const locale = String(url.searchParams.get("locale") ?? "").trim();
      try {
        const r = locale
          ? await env.DB.prepare("SELECT key,value FROM i18n_overrides WHERE site_id=? AND locale=? ORDER BY key").bind(siteId, locale).all()
          : await env.DB.prepare("SELECT locale,key,value FROM i18n_overrides WHERE site_id=? ORDER BY locale,key").bind(siteId).all();
        return ok({ items: (r.results as any[]) ?? [] });
      } catch {
        return ok({ items: [] });
      }
    }
    if (method === "POST") {
      if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
      const b = await jsonBody(request);
      const locale = String(b.locale ?? "").trim();
      const key = String(b.key ?? "").trim();
      if (!isLocaleCode(locale)) return ok({ error: "valid locale required" }, 400);
      if (!/^(core|theme|plugin)\.[a-z0-9_.-]+$/i.test(key)) {
        return ok({ error: "key must be namespaced core.* / theme.* / plugin.*" }, 400);
      }
      if (b.value === null || b.value === "") {
        await env.DB.prepare("DELETE FROM i18n_overrides WHERE site_id=? AND locale=? AND key=?")
          .bind(siteId, locale, key)
          .run();
        return ok({ ok: true, removed: true });
      }
      await env.DB.prepare(
        `INSERT INTO i18n_overrides(site_id,locale,key,value,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(site_id,locale,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
      )
        .bind(siteId, locale, key, String(b.value), now())
        .run();
      return ok({ ok: true }, 201);
    }
  }
  if (path === "i18n/translations" && method === "GET") {
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return ok({ error: "id required" }, 400);
    const group = await translationGroup(env, siteId, id);
    if (!group) return ok({ error: "not found" }, 404);
    return ok({ ...group, site: siteId });
  }
  if (path === "i18n/translations" && method === "POST") {
    const b = await jsonBody(request);
    if (typeof b.site === "string" && b.site.trim() && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(b.site.trim())) {
      siteId = b.site.trim();
    }
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const id = String(b.id ?? "").trim();
    const locale = String(b.locale ?? "").trim();
    const mode = String(b.mode ?? "blank") === "copy" ? "copy" : "blank";
    if (!id) return ok({ error: "id required" }, 400);
    if (!isLocaleCode(locale)) return ok({ error: "valid locale required" }, 400);
    if (!(await siteLocaleCodes(env, siteId)).includes(locale)) {
      return ok({ error: `locale "${locale}" is not enabled for this site` }, 400);
    }
    const source = await env.DB.prepare(
      "SELECT id, type, slug, status, lang_group FROM posts WHERE id=? AND site_id=? LIMIT 1"
    )
      .bind(id, siteId)
      .first<any>();
    if (!source) return ok({ error: "source post not found" }, 404);
    const group = groupOf(source);
    const already = await env.DB.prepare(
      `SELECT p.id FROM posts p JOIN post_translations t ON t.post_id=p.id
        WHERE p.site_id=? AND ${GROUP_SQL}=? AND t.locale=? LIMIT 1`
    )
      .bind(siteId, group, locale)
      .first<any>();
    if (already) return ok({ error: `a ${locale} version already exists`, post_id: already.id }, 409);

    const newId = `${source.type}_${await randomId()}`;
    const desired = String(b.slug ?? "").trim() || String(source.slug);
    const slugTaken = await env.DB.prepare(
      `SELECT p.id FROM posts p JOIN post_translations t ON t.post_id=p.id
        WHERE p.site_id=? AND p.type=? AND t.locale=? AND COALESCE(t.slug,p.slug)=? LIMIT 1`
    ).bind(siteId, String(source.type), locale, desired).first<any>();
    const slug = slugTaken ? await freeSlug(env, siteId, String(source.type), desired) : desired;
    const ts = now();
    await env.DB.prepare(
      "INSERT INTO posts(id,site_id,author_id,type,slug,status,lang_group,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    )
      .bind(newId, siteId, user.id, String(source.type), slug, "draft", group, ts, ts)
      .run();
    let title = "";
    let excerpt = "";
    let content = "";
    if (mode === "copy") {
      const src = await env.DB.prepare(
        "SELECT title,excerpt,content FROM post_translations WHERE post_id=? LIMIT 1"
      )
        .bind(id)
        .first<any>();
      title = String(src?.title ?? "");
      excerpt = String(src?.excerpt ?? "");
      content = String(src?.content ?? "");
    }
    await env.DB.prepare(
      "INSERT INTO post_translations(id,post_id,locale,title,excerpt,content,slug,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    )
      .bind(await randomId(), newId, locale, title, excerpt, content, slug, ts, ts)
      .run();
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "translate", String(source.type), newId, { from: id, locale, mode, site: siteId });
    return ok({ id: newId, locale, slug, mode, group }, 201);
  }

  return null;
}
