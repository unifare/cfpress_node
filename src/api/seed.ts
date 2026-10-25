/**
 * Demo content: the six posts and one page a fresh install shows, and the
 * boot hook that decides whether they are still needed.
 *
 * Extracted from the router file so the dispatchers that answer the
 * seed-demo route can import it without a cycle back through the router.
 */
import { Env } from "../shared/types";
import { refreshThemeTableI18n } from "../extensions/theme/tables";
import { TERMINAL_LOCALE, enableSiteLocale, upsertPlatformLocale } from "../platform/i18n/locale-registry";
import { getSetting, setSetting } from "../platform/settings";
import { listSites } from "../platform/sites";
import { bumpContentCache } from "../shared/cache";
import { DEMO_CONTENTS, DEMO_LOCALES, DEMO_MENUS, DEMO_SEED_STAMP } from "../shared/demo-content";
import { truthy } from "../shared/features";
import { activity, now, ok } from "../shared/repo";
import { savePost } from "./content";

/**
 * Write the demo content (`shared/demo-content.ts` — the one definition) into
 * one site. Three callers, one implementation: the boot hook for a brand-new
 * install (`maybeSeedDemoContent`), the admin Settings screen's "Restore demo
 * content" button (`POST seed-demo`), and the terminal script, which now only
 * logs in and calls this endpoint.
 *
 * Both languages of a piece are written against **one row** via `savePost` —
 * the exact path an editor save takes — so caching, revisions, slug rules and
 * per-locale meta all behave as they do for real content. Idempotent: the
 * per-site id (`demo_<siteId>_<key>`) makes the second run update the same
 * rows, never duplicate them. `filter` scopes a run to one piece and/or one
 * locale (the admin button walks piece by piece to keep each request small on
 * the free plan's CPU budget); the default writes everything.
 */
export async function seedDemoContent(
  env: Env,
  siteId: string,
  userId: string,
  filter?: { key?: string; locale?: string }
): Promise<Response> {
  const pieces = filter?.key
    ? DEMO_CONTENTS.filter((p) => p.key === filter.key)
    : DEMO_CONTENTS;
  if (filter?.key && pieces.length === 0) return ok({ error: `unknown demo piece: ${filter.key}` }, 400);
  const locales = DEMO_LOCALES.filter((l) => !filter?.locale || l === filter.locale);
  if (filter?.locale && !locales.includes(filter.locale as (typeof DEMO_LOCALES)[number])) {
    return ok({ error: `unknown demo locale: ${filter.locale}` }, 400);
  }

  // A seed in N languages needs all N *served*: `siteLocales()` filters on
  // `enabled = 1`, so a disabled row means the theme is handed a shorter list
  // and renders no switcher for that language. The same calls the
  // `i18n/locales` endpoint makes; `is_default: false` leaves whatever the
  // site already chose as its default alone. Display names come from
  // `Intl.DisplayNames`, not a hand-written table.
  for (const code of locales) {
    if (!pieces.some((p) => p.versions[code])) continue;
    let name: string = code, native: string = code;
    try { name = new Intl.DisplayNames([TERMINAL_LOCALE], { type: "language" }).of(code) || code; } catch { /* unknown tag */ }
    try { native = new Intl.DisplayNames([code], { type: "language" }).of(code) || name; } catch { /* falls back to English */ }
    await upsertPlatformLocale(env, { code, name, native_name: native, direction: "ltr", enabled: 1 });
    await enableSiteLocale(env, siteId, code, { isDefault: false });
    // A second language is exactly the event that makes theme `_i18n` tables
    // exist (§2.5.3). Nothing else has to remember to do this.
    await refreshThemeTableI18n(env, siteId);
  }

  let written = 0;
  const failed: string[] = [];
  for (const piece of pieces) {
    for (const code of locales) {
      const v = piece.versions[code];
      if (!v) continue;
      // Per-site id: `posts.id` is a global primary key, so a fixed literal
      // would make seeding a second site collide with the first — and
      // `savePost` answers 404 for a cross-site id (the MS-1.1 oracle).
      const id = `demo_${siteId}_${piece.key}`;
      const res = await savePost(env, userId, id, {
        locale: code,
        // The slug must be sent explicitly: omitting it makes savePost fall
        // back to the post id, which silently breaks every permalink.
        slug: v.slug,
        title: v.title,
        excerpt: v.excerpt,
        content: v.content,
        status: "published",
        ...(v.meta ? { meta: v.meta } : {}),
      }, piece.kind, siteId);
      if (res.status < 400) written++;
      else failed.push(`${piece.key}/${code}:${res.status}`);
    }
  }
  for (const m of DEMO_MENUS) {
    const existing = await env.DB.prepare("SELECT id FROM menus WHERE site_id=? AND (id=? OR location=?) LIMIT 1").bind(siteId, m.id, m.location).first<any>();
    const menuId = existing?.id || m.id;
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO menus (id, site_id, name, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(menuId, siteId, m.name, m.location, now(), now()).run();
    }
    const itemCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM menu_items WHERE site_id=? AND menu_id=?").bind(siteId, menuId).first<any>();
    if (Number(itemCount?.c ?? 0) === 0) {
      let order = 0;
      for (const it of m.items) {
        const itemId = `demo_${siteId}_${menuId}_${order}`;
        await env.DB.prepare(
          "INSERT OR REPLACE INTO menu_items (id, site_id, menu_id, parent_id, title, url, target, sort_order, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(itemId, siteId, menuId, null, it.title, it.url, it.target ?? null, order++, it.locale ?? null, now(), now()).run();
      }
    }
  }
  if (written > 0) {
    await bumpContentCache(env, siteId);
    await activity(env, userId, "seed", "demo-content", "demo", { site: siteId, written, failed });
  }
  return ok({ ok: failed.length === 0, written, failed, site: siteId });
}

/**
 * Boot-chain hook: give a brand-new install something to look at.
 *
 * The predicate decides **once per install**, keyed by a settings stamp
 * (`demo.seeded`), because "the posts table is empty" is a fact that changes:
 * an operator who deletes their content must not find the demo resurrected on
 * the next isolate boot. Three states:
 *
 *   - stamped → do nothing (the normal case after the first boot; the admin
 *     button re-runs the writer explicitly and is never gated on this);
 *   - not stamped, site already has posts (a member draft, an import, a site
 *     upgraded from an older version) → never seed, and record the decision;
 *   - not stamped, no posts at all → seed, then stamp.
 *
 * The author is the install owner: `bootstrapAdmin` runs before this in the
 * boot chain, and demo content is staff content — authoring it as a blank id
 * would blur rule 84a's member/staff id spaces.
 *
 * `siteId` is a test seam (and a future multi-site escape hatch): the boot
 * chain calls it with none, which resolves the install's default site. The
 * contract suite passes a fixture site because the shared local D1's default
 * site belongs to the operator.
 */
export async function maybeSeedDemoContent(env: Env, siteId?: string): Promise<void> {
  const sites = await listSites(env);
  const site = siteId
    ? sites.find((s) => s.id === siteId)
    : (sites.find((s) => Number(s.is_default) === 1) ?? sites[0]);
  if (!site) return;
  // ⚠️ `getSetting` answers the *declared default* for an unwritten row, and
  // that default is the string `"0"` — truthy in JavaScript. A bare `if
  // (await getSetting(...))` would therefore read "never seeded" as "already
  // seeded" and the boot hook would never seed anything. Every boolean
  // setting read goes through `truthy()`; this one is no exception.
  if (truthy(await getSetting(env, site.id, DEMO_SEED_STAMP))) return;
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM posts WHERE site_id=?").bind(site.id).first<any>();
  if (Number(count?.c ?? 0) > 0) {
    await setSetting(env, site.id, DEMO_SEED_STAMP, "1");
    return;
  }
  const admin = await env.DB.prepare("SELECT id FROM site_users WHERE role='superadmin' ORDER BY created_at LIMIT 1").first<any>();
  if (!admin?.id) return;
  // No stamp until the seed answered without failures: a broken or partial
  // seed is retried on the next boot rather than silently never happening.
  // The boot chain's own try/catch keeps a throw from failing the request.
  const res = await seedDemoContent(env, site.id, String(admin.id));
  if (res.status < 400) await setSetting(env, site.id, DEMO_SEED_STAMP, "1");
}
