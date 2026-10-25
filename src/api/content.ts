/**
 * The content domain: posts and pages — list, save, delete, batch actions —
 * plus the translation-group helpers the editor's language bar is built on.
 *
 * Extracted from `src/api.ts` (refactor plan §5).
 */
import { Env } from "../shared/types";
import { activity, now, ok } from "../shared/repo";
import { randomId } from "../shared/crypto";
import { bumpContentCache } from "../shared/cache";
import { getSetting } from "../platform/settings";
import { listSites } from "../platform/sites";
import { createRevision } from "../platform/revisions";
import { DEFAULT_PERMALINK_STRUCTURE, resolvePostUrl } from "../platform/permalink";
import { defaultLocale } from "../platform/frontend";
import { siteDefaultLocale, siteLocaleCodes } from "../platform/i18n/locale-registry";
import { applyFilters, bootPluginRuntime, doAction } from "../extensions/plugin/runtime";
import { resolveContentLocale } from "../platform/i18n/locale-registry";
import { requirePermission } from "../platform/permissions";
import { postMetaRows, resolveMetaByPost } from "../platform/post-meta";
import { autosave } from "../platform/revisions";
import { jsonBody } from "../shared/repo";
import { SessionUser } from "../shared/types";
import { requireSiteAccess } from "./core";

/**
 * How a post identifies its translation group.
 *
 * A row's group is its `lang_group` when that is set, and otherwise its own id —
 * that is how content created before it had any translations names itself.
 *
 * The SQL mirror of `groupOf()` is `GROUP_SQL`, and the two must stay in step.
 * Matching `p.lang_group = ?` on the SQL side instead *excludes* the very row
 * whose id named the group (its `lang_group` is NULL), so that row vanished from
 * its own translation group: the editor reported the language as missing and
 * offered to create a duplicate of a version that already existed.
 */
export const GROUP_SQL = "COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id)";
export function groupOf(row: any): string {
  const g = String(row?.lang_group ?? "").trim();
  return g || String(row?.id ?? "");
}

/**
 * Every language version of one piece of content, keyed by `lang_group`.
 *
 * Returns one entry per *enabled site locale*, not per existing row, because
 * the editor's language bar has to show the versions that do **not** exist yet
 * (that is what the `＋` button is for).
 */
export async function translationGroup(env: Env, siteId: string, postId: string) {
  const source = await env.DB.prepare(
    "SELECT id, type, lang_group, site_id FROM posts WHERE id=? AND site_id=? LIMIT 1"
  )
    .bind(postId, siteId)
    .first<any>();
  if (!source) return null;
  const group = groupOf(source);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.slug, p.status, p.updated_at, t.locale, t.title
       FROM posts p LEFT JOIN post_translations t ON t.post_id = p.id
      WHERE p.site_id = ? AND ${GROUP_SQL} = ?
      ORDER BY t.locale`
  )
    .bind(siteId, group)
    .all();
  const existing = ((rows.results as any[]) ?? []);
  const codes = await siteLocaleCodes(env, siteId);
  const byLocale = new Map<string, any>();
  for (const r of existing) {
    if (r.locale) byLocale.set(String(r.locale), r);
  }
  const versions = codes.map((code) => {
    const hit = byLocale.get(code);
    return {
      locale: code,
      exists: !!hit,
      post_id: hit?.id ?? null,
      slug: hit?.slug ?? null,
      title: hit?.title ?? null,
      status: hit?.status ?? null,
    };
  });
  // A translation in a locale the site no longer serves still exists in the
  // database. Surface it rather than hiding it — the content is real.
  for (const r of existing) {
    const code = String(r.locale ?? "");
    if (!code || codes.includes(code)) continue;
    versions.push({
      locale: code,
      exists: true,
      post_id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
    });
  }
  return { group, type: String(source.type), source_id: String(source.id), versions };
}

/** A slug that is free for this site+type, derived from `base`. */
export async function freeSlug(env: Env, siteId: string, type: string, base: string): Promise<string> {
  const clean = String(base || "untitled").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "untitled";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? clean : `${clean}-${i + 1}`;
    const hit = await env.DB.prepare(
      "SELECT id FROM posts WHERE site_id=? AND type=? AND slug=? LIMIT 1"
    )
      .bind(siteId, type, candidate)
      .first<any>();
    if (!hit) return candidate;
  }
  return `${clean}-${await randomId()}`;
}

export async function listPosts(env: Env, url: URL, kind: string, siteId: string) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));
  const offset = (page - 1) * limit;
  const q = url.searchParams.get("q") ?? "";
  const locale = String(url.searchParams.get("locale") ?? "").trim();
  const category = String(url.searchParams.get("category") ?? "").trim();
  // A post has one row per locale, so joining translations without pinning a
  // locale would return the same post several times — the list pins one row
  // per post. Which row is the question: this used to be `MIN(locale)`, i.e.
  // *lexicographic* order, which answered "which translation sorts first" —
  // `en` on a bilingual site by coincidence of the alphabet, not because the
  // site considers English primary. The list is the operator's table of
  // contents; it must open on the language the site opens on, and `?locale=`
  // (the content list's language filter) overrides it.
  const dflt = await defaultLocale(env, siteId);
  const pinned = locale || dflt;

  // Resolve category and its hierarchical descendants
  let categoryTermIds: string[] = [];
  if (category) {
    const termRows = await env.DB.prepare(
      "SELECT id, slug, parent_id FROM terms WHERE site_id=? AND (taxonomy='category' OR taxonomy='categories')"
    ).bind(siteId).all<any>().catch(() => ({ results: [] }));
    const allTerms = (termRows.results as any[]) ?? [];
    const root = allTerms.find((t) => t.id === category || t.slug === category);
    if (root) {
      const queue = [root.id];
      categoryTermIds.push(root.id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const t of allTerms) {
          if (t.parent_id === cur && !categoryTermIds.includes(t.id)) {
            categoryTermIds.push(t.id);
            queue.push(t.id);
          }
        }
      }
    } else {
      categoryTermIds.push(category);
    }
  }

  let rows: any;
  if (categoryTermIds.length > 0) {
    const catPh = categoryTermIds.map(() => "?").join(",");
    rows = await env.DB.prepare(`
      WITH ranked AS (
        SELECT p.id, p.site_id, p.slug, p.status, p.type, p.template, p.author_id, p.created_at, p.updated_at,
               COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id) AS grp,
               t.locale, t.title, t.excerpt, t.content, COALESCE(t.slug, p.slug) AS slug_own,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id)
                 ORDER BY CASE WHEN t.locale IS NOT NULL THEN 0 ELSE 1 END, p.created_at ASC
               ) AS rn
        FROM posts p LEFT JOIN post_translations t ON t.post_id = p.id AND t.locale = ?
        WHERE p.site_id = ? AND p.type = ? AND (? = '' OR t.title LIKE ? OR p.slug LIKE ?)
          AND EXISTS (SELECT 1 FROM term_relationships r JOIN terms tm ON tm.id = r.term_id WHERE r.post_id = p.id AND tm.site_id = ? AND r.term_id IN (${catPh}))
      )
      SELECT id, site_id, slug, status, type, template, author_id, created_at, updated_at,
             locale, COALESCE(title, '') AS title, excerpt, content, slug_own, grp
      FROM ranked
      WHERE rn = 1
      ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).bind(pinned, siteId, kind, q, `%${q}%`, `%${q}%`, siteId, ...categoryTermIds, limit, offset).all();
  } else {
    rows = await env.DB.prepare(`
      WITH ranked AS (
        SELECT p.id, p.site_id, p.slug, p.status, p.type, p.template, p.author_id, p.created_at, p.updated_at,
               COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id) AS grp,
               t.locale, t.title, t.excerpt, t.content, COALESCE(t.slug, p.slug) AS slug_own,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id)
                 ORDER BY CASE WHEN t.locale IS NOT NULL THEN 0 ELSE 1 END, p.created_at ASC
               ) AS rn
        FROM posts p LEFT JOIN post_translations t ON t.post_id = p.id AND t.locale = ?
        WHERE p.site_id = ? AND p.type = ? AND (? = '' OR t.title LIKE ? OR p.slug LIKE ?)
      )
      SELECT id, site_id, slug, status, type, template, author_id, created_at, updated_at,
             locale, COALESCE(title, '') AS title, excerpt, content, slug_own, grp
      FROM ranked
      WHERE rn = 1
      ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).bind(pinned, siteId, kind, q, `%${q}%`, `%${q}%`, limit, offset).all();
  }

  const items = ((rows.results as any[]) ?? []).map((i) => ({
    ...i,
    slug: i.slug_own || i.slug,
    locales: [i.locale].filter(Boolean) as string[],
    categories: [] as any[],
    tags: [] as any[],
    url: "",
  }));
  // Which languages and terms each item actually has — the list shows version badges
  // and category tags from this.
  const ids = items.map((i) => i.id);
  const grps = items.map((i) => (i as any).grp || i.id);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const grpPh = grps.map(() => "?").join(",");
    const [vr, tr] = await Promise.all([
      env.DB.prepare(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id) AS grp, t.locale
         FROM posts p
         JOIN post_translations t ON t.post_id = p.id
         WHERE p.site_id = ? AND COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id) IN (${grpPh})
         ORDER BY t.locale`
      ).bind(siteId, ...grps).all().catch(() => ({ results: [] as any[] })),
      env.DB.prepare(
        `SELECT r.post_id, t.id, t.taxonomy, t.slug, t.name
         FROM term_relationships r
         JOIN terms t ON t.id = r.term_id
         WHERE r.post_id IN (${ph}) AND t.site_id = ?`
      ).bind(...ids, siteId).all().catch(() => ({ results: [] as any[] })),
    ]);
    const have = new Map<string, string[]>();
    for (const r of (vr.results as any[]) ?? []) {
      const list = have.get(r.grp) ?? [];
      list.push(String(r.locale));
      have.set(r.grp, list);
    }
    const postCats = new Map<string, any[]>();
    const postTags = new Map<string, any[]>();
    for (const r of (tr.results as any[]) ?? []) {
      if (r.taxonomy === "category" || r.taxonomy === "categories") {
        const list = postCats.get(r.post_id) ?? [];
        list.push({ id: r.id, slug: r.slug, name: r.name });
        postCats.set(r.post_id, list);
      } else if (r.taxonomy === "tag" || r.taxonomy === "post_tag") {
        const list = postTags.get(r.post_id) ?? [];
        list.push({ id: r.id, slug: r.slug, name: r.name });
        postTags.set(r.post_id, list);
      }
    }
    for (const i of items) {
      i.locales = have.get((i as any).grp) ?? i.locales;
      i.categories = postCats.get(i.id) ?? [];
      i.tags = postTags.get(i.id) ?? [];
    }
  }

  const permalinkPattern = (await getSetting(env, siteId, "permalink.structure")) || DEFAULT_PERMALINK_STRUCTURE;
  const sites = await listSites(env).catch(() => []);
  const curSite = sites.find((s) => s.id === siteId);
  const rawPrefix = curSite?.path_prefix ? String(curSite.path_prefix).trim().replace(/\/+$/, "") : "";
  const sitePrefix = rawPrefix ? (rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`) : "";
  const activePt = (kind !== "post" && kind !== "page") ? await findActivePostType(env, kind, siteId) : null;

  for (const i of items) {
    if (kind === "page") {
      const pageSlug = String(i.slug || "").trim();
      let pagePath = pageSlug ? (pageSlug.startsWith("/") ? pageSlug : `/${pageSlug}`) : "/";
      if (i.locale && i.locale !== dflt) {
        pagePath = `/${i.locale}${pagePath.startsWith("/") ? pagePath : "/" + pagePath}`;
      }
      i.url = sitePrefix ? `${sitePrefix}${pagePath}` : pagePath;
    } else if (kind === "post") {
      const primaryCat = i.categories?.[0]?.slug || "uncategorized";
      const postPath = resolvePostUrl(permalinkPattern, {
        ...i,
        category: primaryCat,
      }, {
        locale: i.locale,
        isDefaultLocale: !i.locale || i.locale === dflt,
      });
      i.url = sitePrefix ? `${sitePrefix}${postPath.startsWith("/") ? postPath : "/" + postPath}` : postPath;
    } else {
      const ptBase = String(activePt?.rewrite_slug || activePt?.name || kind).replace(/^\/+/, "");
      let cptPath = `/${ptBase}/${i.slug || ""}`;
      if (i.locale && i.locale !== dflt) {
        cptPath = `/${i.locale}${cptPath}`;
      }
      i.url = sitePrefix ? `${sitePrefix}${cptPath}` : cptPath;
    }
  }

  return ok({ items, page, limit, site: siteId });
}

export async function savePost(
  env: Env,
  userId: string,
  id: string | null,
  body: any,
  kind: "post" | "page" | string,
  siteId: string
) {
  await bootPluginRuntime(env);
  // Give plugins a chance to normalise the payload before anything is written.
  // A plugin may return a replacement body; a throw or a non-object result
  // leaves the original payload intact.
  try {
    const filtered = await applyFilters("beforeSavePost", { env, siteId }, body);
    if (filtered && typeof filtered === "object" && !Array.isArray(filtered)) body = filtered;
  } catch {
    /* plugin failure must not block a content save */
  }
  const entityId = id ?? `${kind}_${await randomId()}`;
  // The locale to write. Falling back to a literal `"en"` was wrong for the
  // same reason `siteId = "default"` was: on a site whose default language is
  // `zh-CN`, a client that omits `locale` would silently author an English
  // translation. The fallback belongs to the site, so it is looked up.
  const defaultLocale = await siteDefaultLocale(env, siteId);
  const locale = String(body.locale ?? "").trim() || defaultLocale;
  const isDefaultLocale = locale === defaultLocale;
  // The slug a client sends is the URL segment *for the locale being saved*.
  // `posts.slug` keeps its meaning as the default-language slug (repo i18n
  // invariant: the main table holds default-language values), so only a
  // default-locale save may change it. Per-locale values live in
  // `post_translations.slug`; NULL there means "follow the main table".
  // `undefined` (field absent) leaves the translation's slug untouched; an
  // empty string clears the override so the URL follows the main table.
  const slugGiven = body.slug !== undefined;
  const tSlug = String(body.slug ?? "").trim();
  const status = String(body.status ?? "draft");
  const publishAt = body.publish_at ? Number(body.publish_at) : null;
  const title = String(body.title ?? "");
  const excerpt = String(body.excerpt ?? "");
  const content = typeof body.content === "string" ? body.content : JSON.stringify(body.content ?? []);
  // A `PUT` names an id; a `POST` does not. Naming an id must not become a
  // silent no-op when no such row exists: SQLite's `UPDATE` affects zero rows
  // without raising, so the translation insert below would create a row
  // pointing at a post that does not exist — a 200 that leaves the site with
  // orphan translations and no post. So existence is checked first and a `PUT`
  // for an unknown id *creates* it, which is the idempotence a client supplying
  // a stable id (the seed script, an import, a sync) is relying on.
  const existingPost = id
    ? await env.DB.prepare("SELECT id, site_id, lang_group FROM posts WHERE id=? LIMIT 1").bind(entityId).first<any>()
    : null;
  if (existingPost && existingPost.site_id !== siteId) {
    // The id exists but belongs to another site. Creating it here would collide
    // with the primary key; updating it would edit a neighbour's content.
    // Answered 404 (not 409): 409 confirms "this id exists on another site",
    // which is the existence oracle MS-1.1 forbids (cross-site known-id → 404).
    return ok({ error: "not found" }, 404);
  }
  // `let`, not `const`: a lost INSERT race (below) turns the create into an
  // update of the row the other writer won.
  let isCreate = !existingPost;
  const langGroup = String(body.lang_group ?? (existingPost?.lang_group || "")).trim() || entityId;
  // An explicitly sent slug must be free *in this language*: two translations
  // of different posts may not share a URL, while different posts never see
  // each other's per-locale rows. The main-table check on top covers the
  // default language, whose slug is also the post's identity.
  // Translations of the SAME piece of content (sharing `lang_group`) are
  // legitimately allowed to share the same slug across different languages.
  if (tSlug) {
    const clash = await env.DB.prepare(
      `SELECT p.id FROM posts p JOIN post_translations t ON t.post_id=p.id
        WHERE p.site_id=? AND p.type=? AND t.locale=? AND COALESCE(t.slug,p.slug)=?
          AND p.id<>? AND COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id)<>? LIMIT 1`
    ).bind(siteId, kind, locale, tSlug, entityId, langGroup).first<any>();
    if (clash) return ok({ error: "slug already used in this language" }, 409);
    if (isDefaultLocale) {
      const clashMain = await env.DB.prepare(
        `SELECT id FROM posts WHERE site_id=? AND type=? AND slug=? AND id<>?
          AND COALESCE(NULLIF(TRIM(lang_group), ''), id)<>? LIMIT 1`
      ).bind(siteId, kind, tSlug, entityId, langGroup).first<any>();
      if (clashMain) return ok({ error: "slug already used in this language" }, 409);
    }
  }
  if (isCreate) {
    // `lang_group` ties the language versions of one piece of content together.
    // A new post starts as its own group of one; a translation added later
    // adopts the existing group (see the i18n/translations endpoint).
    const initialTemplate = body.template !== undefined ? String(body.template ?? "").trim() : (kind === "page" ? "none" : null);
    try {
      await env.DB.prepare("INSERT INTO posts (id, site_id, author_id, type, slug, status, lang_group, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(entityId, siteId, userId, kind, tSlug || entityId, status, langGroup, initialTemplate || (kind === "page" ? "none" : null), now(), now()).run();
    } catch (e: any) {
      // Serial callers can never see this: the existence check above read no
      // row. Concurrent ones can — two demo seeds racing (the boot hook and a
      // restore button landing together) both pass the check and both INSERT.
      // Losing the race to the *same site's* row is just "the serial second
      // call": fall through to the update path below. Losing it to *another
      // site's* row stays a hard error — swallowing it would write across
      // tenants, the exact thing MS-1.1 forbids.
      if (!/UNIQUE constraint failed: posts\.id/.test(String(e?.message ?? e))) throw e;
      const racy = await env.DB.prepare("SELECT site_id FROM posts WHERE id=? LIMIT 1").bind(entityId).first<any>();
      if (!racy || racy.site_id !== siteId) throw e;
      isCreate = false;
    }
  }
  if (!isCreate) {
    const old = await env.DB.prepare("SELECT * FROM post_translations WHERE post_id=? AND locale=? LIMIT 1").bind(entityId,locale).first<any>();
    if(old) await createRevision(env,entityId,userId,locale,String(old.title||""),String(old.excerpt||""),String(old.content||""));
    // Who owns the main-table slug? Two storage shapes exist and both are
    // legitimate: a language version may be its own `posts` row (the
    // translations endpoint creates siblings that share a `lang_group`), or
    // one row may carry several translation rows. In the sibling shape the
    // saved locale's URL IS this row's `p.slug` and the save must be allowed
    // to rename it; in the shared shape renaming `p.slug` would move the
    // *other* languages' URLs (their COALESCE falls through to it). So the
    // main slug follows the save only when the locale is the site default or
    // no other locale's translation lives on this row.
    const others = await env.DB.prepare("SELECT COUNT(*) AS c FROM post_translations WHERE post_id=? AND locale<>?").bind(entityId, locale).first<any>();
    const ownsMainSlug = isDefaultLocale || Number(others?.c ?? 0) === 0;
    // ⚠️ The `tSlug || entityId` fallback is CREATE-only. On an update, a save
    // that omits the slug (a status-only publish, an editor saving just the
    // body) must not touch the URL at all — rewriting it to the entity id
    // silently renamed every existing permalink.
    const updTemplate = body.template !== undefined ? (String(body.template ?? "").trim() || (kind === "page" ? "none" : null)) : undefined;
    if (ownsMainSlug && tSlug) {
      if (updTemplate !== undefined) {
        await env.DB.prepare("UPDATE posts SET slug = ?, status = ?, template = ?, updated_at = ? WHERE id = ? AND site_id = ?")
          .bind(tSlug, status, updTemplate, now(), entityId, siteId).run();
      } else {
        await env.DB.prepare("UPDATE posts SET slug = ?, status = ?, updated_at = ? WHERE id = ? AND site_id = ?")
          .bind(tSlug, status, now(), entityId, siteId).run();
      }
    } else {
      if (updTemplate !== undefined) {
        await env.DB.prepare("UPDATE posts SET status = ?, template = ?, updated_at = ? WHERE id = ? AND site_id = ?")
          .bind(status, updTemplate, now(), entityId, siteId).run();
      } else {
        await env.DB.prepare("UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND site_id = ?")
          .bind(status, now(), entityId, siteId).run();
      }
    }
  }
  const existing = await env.DB.prepare("SELECT id, slug FROM post_translations WHERE post_id = ? AND locale = ? LIMIT 1").bind(entityId, locale).first<any>();
  if (existing) {
    // `slugGiven` absent → leave the override alone; empty → clear it (NULL
    // makes the URL follow the main table again).
    const nextSlug = slugGiven ? (tSlug || null) : (existing.slug ?? null);
    await env.DB.prepare("UPDATE post_translations SET title=?, excerpt=?, content=?, slug=?, updated_at=? WHERE id=?").bind(title, excerpt, content, nextSlug, now(), existing.id).run();
  } else {
    await env.DB.prepare("INSERT INTO post_translations (id, post_id, locale, title, excerpt, content, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(await randomId(), entityId, locale, title, excerpt, content, tSlug || null, now(), now()).run();
  }
  if(publishAt && status === "scheduled") {
    await env.DB.prepare("INSERT INTO scheduled_posts(post_id,publish_at,processed_at) VALUES(?,?,NULL) ON CONFLICT(post_id) DO UPDATE SET publish_at=excluded.publish_at,processed_at=NULL").bind(entityId,publishAt).run();
  } else {
    await env.DB.prepare("DELETE FROM scheduled_posts WHERE post_id=?").bind(entityId).run();
  }
  // Custom fields: persist any theme-declared meta sent alongside the post.
  // The value is written against THIS save's locale (migration 0019): a
  // category name is prose, and the language that saved it owns what it says.
  // Reading is the ladder in `platform/post-meta.ts` — never here.
  await writePostMeta(env, siteId, entityId, locale, body.meta);
  if (Array.isArray(body.terms) || Array.isArray(body.tags) || Array.isArray(body.categories)) {
    // Preserve existing tags or categories if only one of them is updated in this save
    let existingTerms: any[] = [];
    if (!Array.isArray(body.terms) && (!Array.isArray(body.tags) || !Array.isArray(body.categories))) {
      const exRes = await env.DB.prepare(
        "SELECT t.id, t.taxonomy FROM terms t JOIN term_relationships r ON r.term_id=t.id WHERE r.post_id=? AND t.site_id=?"
      ).bind(entityId, siteId).all<any>().catch(() => ({ results: [] }));
      existingTerms = (exRes.results as any[]) ?? [];
    }

    const combinedTerms = [...(Array.isArray(body.terms) ? body.terms : [])];

    // Handle categories
    if (Array.isArray(body.categories)) {
      for (const cItem of body.categories) {
        const cStr = typeof cItem === "object" && cItem !== null ? String(cItem.id || cItem.name || "").trim() : String(cItem ?? "").trim();
        if (!cStr) continue;
        let termRow = await env.DB.prepare(
          "SELECT id FROM terms WHERE site_id=? AND (taxonomy='category' OR taxonomy='categories') AND (id=? OR slug=? OR name=?) LIMIT 1"
        ).bind(siteId, cStr, cStr.toLowerCase(), cStr).first<any>().catch(() => null);
        if (termRow?.id) {
          combinedTerms.push(termRow.id);
        } else {
          const newId = "term_" + await randomId();
          const catSlug = cStr.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || newId;
          const ts = now();
          await env.DB.prepare(
            "INSERT INTO terms(id, site_id, taxonomy, slug, name, description, parent_id, count, locale, lang_group, created_at, updated_at) VALUES(?,?,?,?,?,NULL,NULL,0,?,?,?,?)"
          ).bind(newId, siteId, "category", catSlug, cStr, locale, newId, ts, ts).run().catch(() => {});
          combinedTerms.push(newId);
        }
      }
    } else if (!Array.isArray(body.terms)) {
      // Keep existing categories if body.categories wasn't explicitly provided
      for (const et of existingTerms) {
        if (et.taxonomy === "category" || et.taxonomy === "categories") combinedTerms.push(et.id);
      }
    }

    // Handle tags
    if (Array.isArray(body.tags)) {
      for (const tItem of body.tags) {
        const tStr = String(tItem ?? "").trim();
        if (!tStr) continue;
        let termRow = await env.DB.prepare(
          "SELECT id FROM terms WHERE site_id=? AND (taxonomy='tag' OR taxonomy='post_tag') AND (id=? OR slug=? OR name=?) AND (locale='' OR locale=?) LIMIT 1"
        ).bind(siteId, tStr, tStr.toLowerCase(), tStr, locale).first<any>().catch(() => null);
        if (!termRow?.id) {
          const newId = "term_" + await randomId();
          const tagSlug = tStr.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || newId;
          const ts = now();
          await env.DB.prepare(
            "INSERT INTO terms(id, site_id, taxonomy, slug, name, description, parent_id, count, locale, lang_group, created_at, updated_at) VALUES(?,?,?,?,?,NULL,NULL,0,?,?,?,?)"
          ).bind(newId, siteId, "tag", tagSlug, tStr, locale, newId, ts, ts).run().catch(() => {});
          combinedTerms.push(newId);
        } else {
          combinedTerms.push(termRow.id);
        }
      }
    } else if (!Array.isArray(body.terms)) {
      // Keep existing tags if body.tags wasn't explicitly provided
      for (const et of existingTerms) {
        if (et.taxonomy === "tag" || et.taxonomy === "post_tag") combinedTerms.push(et.id);
      }
    }

    await env.DB.prepare("DELETE FROM term_relationships WHERE post_id=?").bind(entityId).run().catch(() => {});
    for (const termItem of combinedTerms) {
      const tid = String(termItem ?? "").trim();
      if (tid) {
        const termRow = await env.DB.prepare("SELECT id FROM terms WHERE site_id=? AND (id=? OR slug=?) LIMIT 1")
          .bind(siteId, tid, tid).first<any>().catch(() => null);
        const resolvedId = termRow?.id ? String(termRow.id) : tid;
        await env.DB.prepare("INSERT OR IGNORE INTO term_relationships(term_id, post_id) VALUES(?,?)")
          .bind(resolvedId, entityId).run().catch(() => {});
      }
    }
    // Re-aggregate count for active terms in this site
    await env.DB.prepare(`
      UPDATE terms SET count = (
        SELECT COUNT(DISTINCT r.post_id) FROM term_relationships r
        JOIN posts p ON p.id = r.post_id
        WHERE r.term_id = terms.id AND p.status = 'published' AND p.site_id = ?
      ) WHERE site_id = ?
    `).bind(siteId, siteId).run().catch(() => {});
  }
  await bumpContentCache(env, siteId);
  await activity(env, userId, isCreate ? "create" : "update", kind, entityId, { locale, title, status, siteId });
  // The URL segment this save left the locale with: the override just written,
  // else the translation's standing override, else the main-table identity.
  const effectiveSlug = tSlug || existing?.slug || entityId;
  // Notify plugins after the write has landed so they can index/notify.
  try {
    await doAction("afterSavePost", { env, siteId }, { id: entityId, type: kind, slug: effectiveSlug, locale, title, status, siteId, created: isCreate });
  } catch {
    /* never surface a plugin failure to the editor */
  }
  return ok({ id: entityId, site: siteId });
}

/** Is this meta key declared by the active theme for this site? */
export async function fieldExists(env: Env, key: string, siteId: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM field_defs WHERE site_id=? AND meta_key=? LIMIT 1"
    )
      .bind(siteId, key)
      .first<any>();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Write a save's theme-declared custom fields, against **that save's locale**
 * (migration 0019): a category name is prose, and the language that saved it
 * owns what it says. This is the **only** writer of `post_meta`; reading is
 * the ladder in `platform/post-meta.ts`, never here (rule 70).
 */
export async function writePostMeta(
  env: Env, siteId: string, entityId: string, locale: string, meta: unknown
): Promise<void> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return;
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    const key = String(k);
    if (!/^[a-z0-9_][a-z0-9_-]{0,63}$/i.test(key)) continue;
    if (!(await fieldExists(env, key, siteId))) continue;
    await env.DB.prepare(
      "INSERT INTO post_meta(post_id,meta_key,locale,meta_value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(post_id,meta_key,locale) DO UPDATE SET meta_value=excluded.meta_value,updated_at=excluded.updated_at"
    )
      .bind(entityId, key, locale, v === null || v === undefined ? null : String(v), now())
      .run()
      .catch(() => {});
  }
}

/** Look up a theme-declared post type that is currently active for a site. */
export async function findActivePostType(env: Env, name: string, siteId: string) {
  try {
    return await env.DB.prepare(
      "SELECT * FROM post_types WHERE site_id=? AND name=? AND active=1 LIMIT 1"
    )
      .bind(siteId, name)
      .first<any>();
  } catch {
    return null;
  }
}



export async function deletePost(env: Env, userId: string, id: string, siteId: string, allLocales: boolean = true) {
  await bootPluginRuntime(env);
  // Establish ownership and find the post on this site
  const owned = await env.DB.prepare(
    "SELECT p.id, p.type, p.slug, p.lang_group FROM posts p WHERE p.id=? AND p.site_id=? LIMIT 1"
  ).bind(id, siteId).first<any>();
  if (!owned) return ok({ error: "not found" }, 404);

  let toDelete: any[] = [owned];
  if (allLocales) {
    const group = groupOf(owned);
    const siblingRows = await env.DB.prepare(
      `SELECT p.id, p.type, p.slug FROM posts p WHERE p.site_id = ? AND (${GROUP_SQL} = ? OR p.id = ?)`
    ).bind(siteId, group, id).all<any>();
    toDelete = (siblingRows.results as any[]) ?? [owned];
  }

  for (const post of toDelete) {
    const pid = String(post.id);
    // Let plugins purge their own derived data (indexes, caches) first.
    try {
      await doAction("beforeDeletePost", { env, siteId }, { id: pid, siteId });
    } catch {
      /* a plugin failure must not prevent the delete */
    }
    await env.DB.prepare("DELETE FROM post_translations WHERE post_id = ?").bind(pid).run();
    await env.DB.prepare("DELETE FROM post_meta WHERE post_id = ?").bind(pid).run().catch(() => {});
    await env.DB.prepare("DELETE FROM term_relationships WHERE post_id = ?").bind(pid).run().catch(() => {});
    await env.DB.prepare("DELETE FROM scheduled_posts WHERE post_id = ?").bind(pid).run().catch(() => {});
    await env.DB.prepare("DELETE FROM posts WHERE id = ? AND site_id = ?").bind(pid, siteId).run();
    await activity(env, userId, "delete", post.type || "post", pid, { siteId });
  }

  // Re-aggregate count for active terms in this site
  await env.DB.prepare(`
    UPDATE terms SET count = (
      SELECT COUNT(DISTINCT r.post_id) FROM term_relationships r
      JOIN posts p ON p.id = r.post_id
      WHERE r.term_id = terms.id AND p.status = 'published' AND p.site_id = ?
    ) WHERE site_id = ?
  `).bind(siteId, siteId).run().catch(() => {});

  await bumpContentCache(env, siteId);
  return ok({ ok: true });
}

export async function handleBatchContent(
  env: Env,
  userId: string,
  siteId: string,
  kind: string,
  body: any
): Promise<Response> {
  const action = String(body?.action || "").trim();
  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = Array.from(new Set(rawIds.map((x: any) => String(x || "").trim()).filter(Boolean))).slice(0, 100);
  const allLocales = body?.all_locales !== false;

  if (ids.length === 0) {
    return ok({ error: "no ids provided" }, 400);
  }

  // Verify ownership and existence on this site
  const ph = ids.map(() => "?").join(",");
  const ownedRows = await env.DB.prepare(
    `SELECT p.id, p.type, p.slug, p.status, p.lang_group FROM posts p WHERE p.id IN (${ph}) AND p.site_id = ? AND p.type = ?`
  ).bind(...ids, siteId, kind).all<any>();
  const owned = (ownedRows.results as any[]) ?? [];

  if (owned.length === 0) {
    return ok({ ok: true, count: 0 });
  }

  // Find all sibling posts across all languages belonging to the translation groups of the selected posts
  let allOwned = owned;
  if (allLocales) {
    const groups = Array.from(new Set(owned.map((r) => groupOf(r)).filter(Boolean)));
    const gph = groups.map(() => "?").join(",");
    const siblingRows = await env.DB.prepare(
      `SELECT p.id, p.type, p.slug, p.status, p.lang_group FROM posts p WHERE p.site_id = ? AND p.type = ? AND (${GROUP_SQL} IN (${gph}) OR p.id IN (${ph}))`
    ).bind(siteId, kind, ...groups, ...ids).all<any>();
    allOwned = (siblingRows.results as any[]) ?? owned;
  }
  const validIds = Array.from(new Set(allOwned.map((r) => r.id)));

  if (validIds.length === 0) {
    return ok({ ok: true, count: 0 });
  }

  await bootPluginRuntime(env);

  if (action === "delete") {
    for (const post of allOwned) {
      const pid = String(post.id);
      try {
        await doAction("beforeDeletePost", { env, siteId }, { id: pid, siteId });
      } catch {
        /* a plugin failure must not prevent the delete */
      }
      await env.DB.prepare("DELETE FROM post_translations WHERE post_id = ?").bind(pid).run();
      await env.DB.prepare("DELETE FROM post_meta WHERE post_id = ?").bind(pid).run().catch(() => {});
      await env.DB.prepare("DELETE FROM term_relationships WHERE post_id = ?").bind(pid).run().catch(() => {});
      await env.DB.prepare("DELETE FROM scheduled_posts WHERE post_id = ?").bind(pid).run().catch(() => {});
      await env.DB.prepare("DELETE FROM posts WHERE id = ? AND site_id = ?").bind(pid, siteId).run();
      await activity(env, userId, "delete", kind, pid, { siteId, batch: true });
    }

    // Re-aggregate count for active terms in this site
    await env.DB.prepare(`
      UPDATE terms SET count = (
        SELECT COUNT(DISTINCT r.post_id) FROM term_relationships r
        JOIN posts p ON p.id = r.post_id
        WHERE r.term_id = terms.id AND p.status = 'published' AND p.site_id = ?
      ) WHERE site_id = ?
    `).bind(siteId, siteId).run().catch(() => {});

    await bumpContentCache(env, siteId);
    return ok({ ok: true, count: validIds.length });
  }

  if (action === "status") {
    const status = String(body?.status || "").trim();
    const validStatuses = new Set(["published", "draft", "scheduled", "private"]);
    if (!validStatuses.has(status)) {
      return ok({ error: "invalid status" }, 400);
    }

    const vph = validIds.map(() => "?").join(",");
    const ts = now();
    await env.DB.prepare(
      `UPDATE posts SET status = ?, updated_at = ? WHERE id IN (${vph}) AND site_id = ?`
    ).bind(status, ts, ...validIds, siteId).run();

    for (const row of allOwned) {
      await activity(env, userId, "update", kind, row.id, { siteId, status, batch: true });
      if (status === "published") {
        try {
          await doAction("afterSavePost", { env, siteId }, {
            id: row.id,
            type: kind,
            slug: row.slug || row.id,
            status,
            siteId,
            created: false,
          });
        } catch {
          /* plugin failure ignored */
        }
      }
    }

    // Re-aggregate count for active terms in this site since published status changed
    await env.DB.prepare(`
      UPDATE terms SET count = (
        SELECT COUNT(DISTINCT r.post_id) FROM term_relationships r
        JOIN posts p ON p.id = r.post_id
        WHERE r.term_id = terms.id AND p.status = 'published' AND p.site_id = ?
      ) WHERE site_id = ?
    `).bind(siteId, siteId).run().catch(() => {});

    await bumpContentCache(env, siteId);
    return ok({ ok: true, count: validIds.length });
  }

  if (action === "category") {
    const catId = String(body?.category_id || "").trim();
    if (!catId) return ok({ error: "category_id required" }, 400);

    const termRow = await env.DB.prepare(
      "SELECT id, locale, lang_group FROM terms WHERE site_id = ? AND (taxonomy = 'category' OR taxonomy = 'categories') AND (id = ? OR slug = ?) LIMIT 1"
    ).bind(siteId, catId, catId).first<any>();
    if (!termRow?.id) return ok({ error: "category not found" }, 404);

    const termGroup = String(termRow.lang_group || termRow.id);
    const siblingTerms = await env.DB.prepare(
      "SELECT id, locale FROM terms WHERE site_id = ? AND (taxonomy = 'category' OR taxonomy = 'categories') AND (lang_group = ? OR id = ?)"
    ).bind(siteId, termGroup, termGroup).all<any>().catch(() => ({ results: [] }));
    const termByLocale = new Map<string, string>();
    for (const t of (siblingTerms.results as any[]) ?? []) {
      if (t.locale) termByLocale.set(String(t.locale), String(t.id));
    }

    const vph = validIds.map(() => "?").join(",");
    const ptLocales = await env.DB.prepare(
      `SELECT post_id, locale FROM post_translations WHERE post_id IN (${vph})`
    ).bind(...validIds).all<any>().catch(() => ({ results: [] }));
    const postLocaleMap = new Map<string, string>();
    for (const pl of (ptLocales.results as any[]) ?? []) {
      if (pl.locale) postLocaleMap.set(String(pl.post_id), String(pl.locale));
    }

    const defaultTermId = String(termRow.id);
    for (const id of validIds) {
      const pLocale = postLocaleMap.get(id) || "";
      const resolvedTermId = (pLocale && termByLocale.get(pLocale)) || defaultTermId;

      const oldCats = await env.DB.prepare(
        "SELECT t.id FROM terms t JOIN term_relationships r ON r.term_id = t.id WHERE r.post_id = ? AND t.site_id = ? AND (t.taxonomy = 'category' OR t.taxonomy = 'categories')"
      ).bind(id, siteId).all<any>().catch(() => ({ results: [] }));
      for (const oc of (oldCats.results as any[]) ?? []) {
        await env.DB.prepare("DELETE FROM term_relationships WHERE term_id = ? AND post_id = ?").bind(oc.id, id).run().catch(() => {});
      }
      await env.DB.prepare("INSERT OR IGNORE INTO term_relationships (term_id, post_id) VALUES (?, ?)").bind(resolvedTermId, id).run().catch(() => {});
      await activity(env, userId, "update", kind, id, { siteId, category_id: resolvedTermId, batch: true });
    }

    // Re-aggregate count for active terms in this site
    await env.DB.prepare(`
      UPDATE terms SET count = (
        SELECT COUNT(DISTINCT r.post_id) FROM term_relationships r
        JOIN posts p ON p.id = r.post_id
        WHERE r.term_id = terms.id AND p.status = 'published' AND p.site_id = ?
      ) WHERE site_id = ?
    `).bind(siteId, siteId).run().catch(() => {});

    await bumpContentCache(env, siteId);
    return ok({ ok: true, count: validIds.length });
  }

  return ok({ error: "unknown action" }, 400);
}

export async function dispatchContentAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // Batch content operations (posts, pages, custom post types)
  const batchMatch = path.match(/^(posts|pages|content\/([a-z][a-z0-9_-]{0,63}))\/batch$/);
  if (batchMatch && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const kind = batchMatch[1] === "posts" ? "post" : batchMatch[1] === "pages" ? "page" : batchMatch[2];
    if (kind !== "post" && kind !== "page") {
      const pt = await findActivePostType(env, kind, siteId);
      if (!pt) return ok({ error: "unknown post type" }, 404);
    }
    const b = await jsonBody(request);
    return handleBatchContent(env, user.id, siteId, kind, b);
  }

  if (path === "posts" && method === "GET") return listPosts(env, url, "post", siteId);
  if (path === "pages" && method === "GET") return listPosts(env, url, "page", siteId);
  if (path === "posts" && method === "POST") return savePost(env, user.id, null, await jsonBody(request), "post", siteId);
  if (path === "pages" && method === "POST") return savePost(env, user.id, null, await jsonBody(request), "page", siteId);

  const contentMatch = path.match(/^content\/([a-z][a-z0-9_-]{0,63})$/);
  if (contentMatch && method === "GET") {
    const type = contentMatch[1];
    const pt = await findActivePostType(env, type, siteId);
    if (!pt) return ok({ error: "unknown post type" }, 404);
    return listPosts(env, url, type, siteId);
  }
  if (contentMatch && method === "POST") {
    if(!(await requirePermission(env,user,"content.write",siteId))) return ok({error:"Forbidden"},403);
    const type = contentMatch[1];
    const pt = await findActivePostType(env, type, siteId);
    if (!pt) return ok({ error: "unknown post type" }, 404);
    return savePost(env, user.id, null, await jsonBody(request), type, siteId);
  }
  const contentIdMatch = path.match(/^content\/([a-z][a-z0-9_-]{0,63})\/([^/]+)$/);
  if (contentIdMatch) {
    const type = contentIdMatch[1];
    const id = contentIdMatch[2];
    const pt = await findActivePostType(env, type, siteId);
    if (!pt) return ok({ error: "unknown post type" }, 404);
    if (method === "DELETE") {
      if(!(await requirePermission(env,user,"content.write",siteId))) return ok({error:"Forbidden"},403);
      const allLocales = url.searchParams.get("all_locales") !== "0" && url.searchParams.get("all_locales") !== "false";
      return deletePost(env, user.id, id, siteId, allLocales);
    }
    if (method === "PUT") {
      if(!(await requirePermission(env,user,"content.write",siteId))) return ok({error:"Forbidden"},403);
      return savePost(env, user.id, id, await jsonBody(request), type, siteId);
    }
    if (method === "GET") {
      if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
      const dflt = await defaultLocale(env, siteId);
      const [row, termRows] = await Promise.all([
        env.DB.prepare(`
          SELECT p.*, t.locale, t.title, t.excerpt, t.content, t.slug AS slug_own
          FROM posts p LEFT JOIN post_translations t ON t.post_id=p.id
          WHERE p.id=? AND p.site_id=? ORDER BY CASE WHEN t.locale = ? THEN 0 ELSE 1 END, t.locale
        `).bind(id, siteId, dflt).all(),
        env.DB.prepare(
          "SELECT t.id, t.taxonomy, t.slug, t.name FROM terms t JOIN term_relationships r ON r.term_id=t.id WHERE r.post_id=? AND t.site_id=?"
        ).bind(id, siteId).all<any>().catch(() => ({ results: [] })),
      ]);
      const items = (row.results as any[]) ?? [];
      const metaRows = await postMetaRows(env, id);
      const terms = (termRows.results as any[]) ?? [];
      const categories = terms.filter((t: any) => t.taxonomy === "category" || t.taxonomy === "categories");
      const tags = terms.filter((t: any) => t.taxonomy === "tag" || t.taxonomy === "post_tag");
      const mapped = items.map((i) => ({ ...i, meta: resolveMetaByPost(metaRows, String(i.locale ?? ""), dflt).get(id) ?? {}, terms, categories, tags }));
      return ok({ items: mapped, item: mapped[0] ?? null, terms, categories, tags });
    }
  }

  const postMatch = path.match(/^(posts|pages)\/([^/]+)$/);
  if (postMatch) {
    const kind = postMatch[1] === "posts" ? "post" : "page";
    const id = postMatch[2];
    if (method === "DELETE") {
      const allLocales = url.searchParams.get("all_locales") !== "0" && url.searchParams.get("all_locales") !== "false";
      return deletePost(env, user.id, id, siteId, allLocales);
    }
    if (method === "PUT") return savePost(env, user.id, id, await jsonBody(request), kind, siteId);
    if (method === "GET") {
      if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
      const dflt = await defaultLocale(env, siteId);
      const [row, termRows] = await Promise.all([
        env.DB.prepare(`
          SELECT p.*, t.locale, t.title, t.excerpt, t.content, t.slug AS slug_own
          FROM posts p LEFT JOIN post_translations t ON t.post_id=p.id
          WHERE p.id=? AND p.site_id=? ORDER BY CASE WHEN t.locale = ? THEN 0 ELSE 1 END, t.locale
        `).bind(id, siteId, dflt).all(),
        env.DB.prepare(
          "SELECT t.id, t.taxonomy, t.slug, t.name FROM terms t JOIN term_relationships r ON r.term_id=t.id WHERE r.post_id=? AND t.site_id=?"
        ).bind(id, siteId).all<any>().catch(() => ({ results: [] })),
      ]);
      const items = (row.results as any[]) ?? [];
      const metaRows = await postMetaRows(env, id);
      const terms = (termRows.results as any[]) ?? [];
      const categories = terms.filter((t: any) => t.taxonomy === "category" || t.taxonomy === "categories");
      const tags = terms.filter((t: any) => t.taxonomy === "tag" || t.taxonomy === "post_tag");
      const mapped = items.map((i) => ({ ...i, meta: resolveMetaByPost(metaRows, String(i.locale ?? ""), dflt).get(id) ?? {}, terms, categories, tags }));
      return ok({ items: mapped, item: mapped[0] ?? null, terms, categories, tags });
    }
  }

  const revm = path.match(/^(posts|pages)\/([^/]+)\/revisions$/);
  if (revm && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const r = await env.DB.prepare("SELECT r.* FROM post_revisions r JOIN posts p ON p.id=r.post_id WHERE r.post_id=? AND p.site_id=? ORDER BY r.locale,r.version DESC LIMIT 200").bind(revm[2],siteId).all();
    return ok({ items: r.results });
  }
  if (revm && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const owned = await env.DB.prepare("SELECT id FROM posts WHERE id=? AND site_id=? LIMIT 1").bind(revm[2], siteId).first<any>();
    if (!owned) return ok({ error: "not found" }, 404);
    const b = await jsonBody(request);
    const v = await createRevision(env, revm[2], user.id, await resolveContentLocale(env, siteId, b.locale), String(b.title || ""), String(b.excerpt || ""), typeof b.content === "string" ? b.content : JSON.stringify(b.content || []));
    return ok({ version: v }, 201);
  }

  const am = path.match(/^(posts|pages)\/([^/]+)\/autosave$/);
  if (am && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const locale = await resolveContentLocale(env, siteId, url.searchParams.get("locale"));
    const r = await env.DB.prepare("SELECT a.* FROM post_autosaves a JOIN posts p ON p.id=a.post_id WHERE a.post_id=? AND p.site_id=? AND a.user_id=? AND a.locale=?").bind(am[2], siteId, user.id, locale).first();
    return ok({ item: r || null });
  }
  if (am && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const owned = await env.DB.prepare("SELECT id FROM posts WHERE id=? AND site_id=? LIMIT 1").bind(am[2], siteId).first<any>();
    if (!owned) return ok({ error: "not found" }, 404);
    const b = await jsonBody(request);
    await autosave(env, am[2], user.id, await resolveContentLocale(env, siteId, b.locale), b);
    return ok({ ok: true, updated_at: now() });
  }

  const restore = path.match(/^(posts|pages)\/([^/]+)\/revisions\/([^/]+)\/restore$/);
  if (restore && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const r = await env.DB.prepare("SELECT r.* FROM post_revisions r JOIN posts p ON p.id=r.post_id WHERE r.id=? AND r.post_id=? AND p.site_id=?").bind(restore[3], restore[2], siteId).first<any>();
    if (!r) return ok({ error: "revision not found" }, 404);
    return savePost(env, user.id, restore[2], { locale: r.locale, title: r.title, excerpt: r.excerpt, content: r.content }, restore[1] === "posts" ? "post" : "page", siteId);
  }

  if (path === "search" && method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim();
    const locale = await resolveContentLocale(env, siteId, url.searchParams.get("locale"));
    if (!q) return ok({ items: [] });
    const r = await env.DB.prepare(`SELECT p.id,p.type,COALESCE(t.slug,p.slug) AS slug,p.status,t.locale,t.title,t.excerpt FROM posts p JOIN post_translations t ON t.post_id=p.id WHERE p.site_id=? AND p.status='published' AND t.locale=? AND (t.title LIKE ? OR t.excerpt LIKE ? OR t.content LIKE ?) ORDER BY p.updated_at DESC LIMIT 50`).bind(siteId, locale, `%${q}%`, `%${q}%`, `%${q}%`).all();
    return ok({ items: r.results });
  }

  return null;
}

export async function dispatchTaxonomyAndTermRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // 1. Taxonomies list
  if (path === "taxonomies" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const r = await env.DB.prepare("SELECT * FROM taxonomies WHERE site_id=? AND active=1 ORDER BY name").bind(siteId).all<any>();
    let items = (r.results as any[]) ?? [];
    if (items.length === 0) {
      items = [
        { name: "category", site_id: siteId, label: "Categories", post_types: "[\"post\"]", hierarchical: 1, active: 1 },
        { name: "post_tag", site_id: siteId, label: "Tags", post_types: "[\"post\"]", hierarchical: 0, active: 1 },
      ];
    }
    return ok({ site: siteId, items });
  }

  // 2. Terms list: GET taxonomies/:tax/terms, GET terms, or GET tags
  const taxTermsMatch = path.match(/^taxonomies\/([a-z0-9_-]+)\/terms$/);
  if ((taxTermsMatch || path === "terms" || path === "tags") && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const taxonomy = taxTermsMatch ? taxTermsMatch[1] : (path === "tags" ? "tag" : (url.searchParams.get("taxonomy") || "category"));
    const isTagTax = taxonomy === "tag" || taxonomy === "post_tag";
    let query = isTagTax
      ? "SELECT id, site_id, taxonomy, slug, name, description, parent_id, count, locale, lang_group, declared_by_theme, created_at, updated_at FROM terms WHERE site_id=? AND (taxonomy='tag' OR taxonomy='post_tag')"
      : "SELECT id, site_id, taxonomy, slug, name, description, parent_id, count, locale, lang_group, declared_by_theme, created_at, updated_at FROM terms WHERE site_id=? AND taxonomy=?";
    const params: any[] = isTagTax ? [siteId] : [siteId, taxonomy];
    const reqLocale = (url.searchParams.get("locale") || "").trim();
    if (reqLocale) {
      query += " AND (locale='' OR locale=?)";
      params.push(reqLocale);
    }
    query += " ORDER BY name";
    const r = await env.DB.prepare(query).bind(...params).all<any>();
    return ok({ site: siteId, taxonomy, items: r.results ?? [] });
  }

  // 3. Create term: POST taxonomies/:tax/terms, POST terms, or POST tags
  if ((taxTermsMatch || path === "terms" || path === "tags") && method === "POST") {
    if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const taxonomy = taxTermsMatch ? taxTermsMatch[1] : (path === "tags" ? "tag" : String(b.taxonomy || "category"));
    const name = String(b.name || "").trim();
    if (!name) return ok({ error: "name is required" }, 400);
    const id = "term_" + await randomId();
    const rawSlug = String(b.slug || name).toLowerCase().trim();
    const slug = rawSlug.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || id;
    const desc = b.description ? String(b.description) : null;
    const parentId = b.parent_id ? String(b.parent_id) : null;
    const termLocale = String(b.locale ?? "").trim();
    const langGroup = String(b.lang_group || b.translation_of || "").trim() || id;
    const ts = now();
    try {
      await env.DB.prepare(
        "INSERT INTO terms(id, site_id, taxonomy, slug, name, description, parent_id, count, locale, lang_group, created_at, updated_at) VALUES(?,?,?,?,?,?,?,0,?,?,?,?)"
      ).bind(id, siteId, taxonomy, slug, name, desc, parentId, termLocale, langGroup, ts, ts).run();
      await bumpContentCache(env, siteId);
      await activity(env, user.id, "create", "term", id, { taxonomy, name, slug, siteId, locale: termLocale });
      return ok({ ok: true, item: { id, site_id: siteId, taxonomy, slug, name, description: desc, parent_id: parentId, count: 0, locale: termLocale, lang_group: langGroup } }, 201);
    } catch (e: any) {
      return ok({ error: e?.message || "term already exists" }, 400);
    }
  }

  // 4. Single term: GET/PUT/DELETE taxonomies/:tax/terms/:id, terms/:id, or tags/:id
  const termItemMatch = path.match(/^(?:taxonomies\/[a-z0-9_-]+\/terms|terms|tags)\/([^/]+)$/);
  if (termItemMatch) {
    const termId = decodeURIComponent(termItemMatch[1]);
    if (method === "GET") {
      if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
      const row = await env.DB.prepare("SELECT * FROM terms WHERE site_id=? AND (id=? OR slug=?) LIMIT 1")
        .bind(siteId, termId, termId).first<any>();
      if (!row) return ok({ error: "term not found" }, 404);
      return ok({ item: row });
    }
    if (method === "PUT" || method === "PATCH") {
      if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
      const b = await jsonBody(request);
      const row = await env.DB.prepare("SELECT * FROM terms WHERE site_id=? AND (id=? OR slug=?) LIMIT 1")
        .bind(siteId, termId, termId).first<any>();
      if (!row) return ok({ error: "term not found" }, 404);
      const newName = b.name !== undefined ? String(b.name).trim() : row.name;
      const newSlug = b.slug !== undefined ? String(b.slug).trim() : row.slug;
      const newDesc = b.description !== undefined ? String(b.description) : row.description;
      const newParent = b.parent_id !== undefined ? (b.parent_id ? String(b.parent_id) : null) : row.parent_id;
      const newLocale = b.locale !== undefined ? String(b.locale).trim() : (row.locale ?? "");
      const newLangGroup = b.lang_group !== undefined ? String(b.lang_group).trim() : (row.lang_group ?? row.id);
      const ts = now();
      await env.DB.prepare(
        "UPDATE terms SET name=?, slug=?, description=?, parent_id=?, locale=?, lang_group=?, updated_at=? WHERE id=? AND site_id=?"
      ).bind(newName, newSlug, newDesc, newParent, newLocale, newLangGroup, ts, row.id, siteId).run();
      await bumpContentCache(env, siteId);
      await activity(env, user.id, "update", "term", row.id, { name: newName, slug: newSlug });
      return ok({ ok: true, item: { ...row, name: newName, slug: newSlug, description: newDesc, parent_id: newParent, locale: newLocale, lang_group: newLangGroup, updated_at: ts } });
    }
    if (method === "DELETE") {
      if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
      const row = await env.DB.prepare("SELECT id FROM terms WHERE site_id=? AND (id=? OR slug=?) LIMIT 1")
        .bind(siteId, termId, termId).first<any>();
      if (!row) return ok({ error: "term not found" }, 404);
      await env.DB.prepare("DELETE FROM term_relationships WHERE term_id=?").bind(row.id).run().catch(() => {});
      await env.DB.prepare("DELETE FROM terms WHERE id=? AND site_id=?").bind(row.id, siteId).run();
      await bumpContentCache(env, siteId);
      await activity(env, user.id, "delete", "term", row.id);
      return ok({ ok: true });
    }
  }

  return null;
}
