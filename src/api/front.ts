/**
 * The front-end API: `/api/v1/front/…` and the member-authored content
 * behind it.
 *
 * Extracted from `src/api.ts` (refactor plan §5). The isolation contract
 * lives in `handleFrontApi`'s doc comment and is enforced by construction:
 * this surface must never consult the admin session.
 */
import { Env } from "../shared/types";
import { activity, now, ok } from "../shared/repo";
import { randomId } from "../shared/crypto";
import { bumpContentCache } from "../shared/cache";
import { currentMember, loginMember, logoutMember, registerMember, requireMember, MEMBER_COOKIE } from "../platform/members";
import { writePostMeta } from "./content";
import { defaultLocale } from "../platform/frontend";
import { doAction } from "../extensions/plugin/runtime";
import { processPublicFormSubmission } from "../extensions/plugin/forms";
import { createComment, getPostCommentsTree } from "../platform/comments";

/**
 * The front-end API: `/api/v1/front/…`.
 *
 * Deliberately dispatched **before** `routeApi`'s `bootstrapAdmin` and
 * `requireAdmin`, because this surface must not consult the admin session at
 * all. That is the isolation: a request carrying an admin cookie is not
 * "an admin browsing the front end", it is an anonymous visitor — the front
 * end reads `cfpress_member` and nothing else. Handing a *staff* credential to
 * a front-end endpoint and being recognised is exactly the conflation §2.1
 * forbids, so it is enforced by construction rather than by a check that could
 * be reordered later.
 *
 * ## Why the site comes in as a parameter
 *
 * `index.ts` calls this **after** `resolveSite`, with the already-resolved
 * `siteId` and the already-stripped `path`. That ordering is the point: the
 * generic `/api/` branch runs before the site is known, so resolving the site
 * here again would always land on the default one — and a member on a
 * path-prefixed site (`/shop/api/v1/front/auth/login`) would find no API at
 * all. The visitor does not get to name their tenant either: there is no
 * `?site=` on this surface, and the resolved site is the only input.
 */
export async function handleFrontApi(env: Env, request: Request, siteId: string, resolvedPath: string): Promise<Response> {
  try {
    return await routeFrontApi(env, request, siteId, resolvedPath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("front api error:", message);
    // A browser that submitted a form must not be shown a JSON body — not even
    // on a crash. The content type is still readable here (only the *body* is
    // consumed), so the shape of the answer is still the caller's.
    if (isFormRequest(request)) {
      return new Response(null, { status: 303, headers: { Location: "/?error=server_error" } });
    }
    return ok({ error: message }, 500);
  }
}

/**
 * Did this request come from a plain HTML form rather than a JSON caller?
 *
 * **Positive identification, not "anything that is not JSON".** A browser form
 * always sends one of these two types, so anything else — including a request
 * with no `Content-Type` at all — keeps the JSON path it had before, and no
 * existing caller changes shape. (`logout` is the one that would have: it takes
 * no body, so a script posts it with no content type.)
 */
function isFormRequest(request: Request): boolean {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
}

/**
 * Read a front-end request's parameters, whichever shape the caller sent.
 *
 * The theme renders its member surface as plain HTML forms — the templates say
 * "no JavaScript", and they mean it — so the API has to accept what a browser
 * actually sends: `application/x-www-form-urlencoded`. It keeps accepting JSON
 * too, because the tests and any script drive the same endpoints that way.
 *
 * **One reader for the whole surface.** A per-endpoint `request.json()` is how
 * the two shapes drift apart, and the drift is silent: the form path answers
 * `invalid_username` to a username the caller *did* send, because the JSON
 * parse failed and the `.catch` turned it into `{}`. That is exactly what the
 * login and register forms did before this existed.
 *
 * A form body is flat, so a custom field is spelled `meta_<key>`; the JSON path
 * sends `meta` whole, and is passed through untouched.
 */
export async function readFrontParams(request: Request): Promise<{ body: Record<string, any>; form: boolean }> {
  if (!isFormRequest(request)) {
    const j = await request.json().catch(() => ({}));
    return { body: j && typeof j === "object" ? (j as Record<string, any>) : {}, form: false };
  }
  const fd = await request.formData().catch(() => null);
  const body: Record<string, any> = {};
  const meta: Record<string, string> = {};
  if (fd) {
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("meta_")) meta[k.slice(5)] = v;
      else body[k] = v;
    }
  }
  if (Object.keys(meta).length) body.meta = meta;
  return { body, form: true };
}

/**
 * Where a form submission is allowed to be sent after it finishes.
 *
 * **Same-site absolute paths only.** The `redirect` field is caller-supplied in
 * the strongest sense — anyone can build a link to our form with any value in
 * it — so echoing it into `Location:` is an open redirect: a phishing page that
 * reads as ours. `//host` is protocol-relative (a *different* origin), and
 * `/\host` is a path to some browsers and an authority to others, so both are
 * refused along with anything absolute. A refused value falls back.
 */
export function safeRedirect(value: unknown, fallback: string): string {
  const s = String(value ?? "").replace(/[\r\n]/g, "");
  if (/^\/(?!\/)/.test(s) && !s.startsWith("/\\")) return s;
  return fallback;
}

/**
 * Answer a front-end request in the shape the caller used.
 *
 * A JSON caller is untouched: same body, same status — that is the contract the
 * tests pin. A **form** caller gets `303 See Other` back to its own `redirect`
 * field, because a browser cannot read a JSON body: without this, "no
 * JavaScript" sign-in ends on a page showing the reader `{"ok":true}`. The
 * cookie the endpoint set rides on both. A failure redirects too, with
 * `?error=<code>` — the alternative is showing a reader a JSON error page for a
 * typo in their password.
 */
export async function frontAnswer(form: boolean, res: Response, opts: { redirect?: unknown; fallback: string }): Promise<Response> {
  if (!form) return res;
  let to = safeRedirect(opts.redirect, opts.fallback);
  if (res.status >= 400) {
    const body: any = await res.json().catch(() => ({}));
    const code = typeof body?.error === "string" ? body.error : "failed";
    to += (to.includes("?") ? "&" : "?") + "error=" + encodeURIComponent(code);
  }
  const headers: Record<string, string> = { Location: to };
  const cookie = res.headers.get("set-cookie");
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 303, headers });
}

/**
 * Front-end publishing: a member writing their **own** posts.
 *
 * ## Why this is not `savePost` with a different caller
 *
 * `savePost` answers to a **staff** session: it takes its author from the admin
 * cookie, writes it into `posts.author_id`, and trusts the caller's `status`
 * (an editor is allowed to publish). A member is a different identity (rule 77),
 * and the three differences are the reason this is a separate function:
 *
 *   1. **The author is the session, not the body.** `author_member_id` comes
 *      from `requireMember`'s result. `body.author_member_id` is not read at
 *      all — reading it would let one member author posts *as* another, which
 *      is the same defect shape as a client-supplied `site_id`. `author_id`
 *      stays `''` (migration 0024: never invent a fake staff user, because
 *      `author_id` is a staff id space and every reader of it assumes so).
 *   2. **The status is the server's decision.** A member submission is a
 *      *submission*: it lands as `draft`, and publishing stays a staff act.
 *      `body.status` is ignored outright, so a crafted request cannot put
 *      itself on the front page. An **edit** does not touch the status at all
 *      either — a member must not be able to publish, nor to knock a
 *      staff-published post back to draft.
 *   3. **Ownership is a filter, and a miss is 404.** Every statement carries
 *      `site_id` AND `author_member_id`; a post owned by another member,
 *      another site, or nobody answers 404 — never 403, which would confirm
 *      that the id exists (the existence oracle MS-1.1 forbids, and the reason
 *      `savePost` answers 404 for a cross-site id too).
 *
 * What it *shares* with `savePost` is everything that is about **content**
 * rather than identity: the per-language slug with its clash check (rule 58),
 * the per-language `post_meta` write (rule 70 — written here, read only through
 * `resolveMetaByPost`), and `bumpContentCache`.
 *
 * ## What is deliberately absent
 *
 * No `activity()` call. `admin_activity.user_id` holds a **staff** id, and
 * writing a member id into it would be the "one column, two meanings" defect
 * migration 0024 refused for `author_id`. Member actions are recorded by the
 * row they touch (`posts.author_member_id`), not in the staff log.
 *
 * No `scheduled_posts` row either: scheduling is publishing, and publishing is
 * a staff act.
 */
export async function saveMemberPost(
  env: Env,
  siteId: string,
  memberId: string,
  id: string | null,
  body: any
): Promise<Response> {
  const defaultLoc = await defaultLocale(env, siteId);
  const locale = String(body.locale ?? "").trim() || defaultLoc;
  const isDefaultLocale = locale === defaultLoc;
  const title = String(body.title ?? "");
  const excerpt = String(body.excerpt ?? "");
  const content = typeof body.content === "string" ? body.content : JSON.stringify(body.content ?? []);
  // `undefined` (field absent) leaves the translation's slug override alone; an
  // empty string clears it so the URL follows the main table again. Same
  // three-state contract as `savePost`.
  const slugGiven = body.slug !== undefined;
  const tSlug = String(body.slug ?? "").trim();

  const entityId = id ?? `post_${await randomId()}`;

  // Ownership is established before anything is written, on the **site and the
  // member together** — in the SQL, not by comparing a fetched column in JS. A
  // predicate the database applies cannot be forgotten by a later edit to the
  // branch that reads it, and it is the same shape the DELETE uses. A `PUT`
  // naming an id this member does not own is 404 for every reason it could be:
  // wrong site, wrong member, no such row. One answer, so the response cannot
  // be used to enumerate ids.
  const owned = await env.DB.prepare(
    "SELECT id, lang_group FROM posts WHERE id=? AND site_id=? AND author_member_id=? AND type='post' LIMIT 1"
  ).bind(entityId, siteId, memberId).first<any>();
  if (id && !owned) {
    return ok({ error: "not found" }, 404);
  }
  const isCreate = !owned;
  const langGroup = String(body.lang_group ?? (owned?.lang_group || "")).trim() || entityId;

  // An explicitly sent slug must be free *in this language* (rule 58). Two
  // translations of different posts may not share a URL; the main-table check
  // on top covers the default language, whose slug is also the identity.
  if (tSlug) {
    const clash = await env.DB.prepare(
      `SELECT p.id FROM posts p JOIN post_translations t ON t.post_id=p.id
        WHERE p.site_id=? AND p.type='post' AND t.locale=? AND COALESCE(t.slug,p.slug)=?
          AND p.id<>? AND COALESCE(NULLIF(TRIM(p.lang_group), ''), p.id)<>? LIMIT 1`
    ).bind(siteId, locale, tSlug, entityId, langGroup).first<any>();
    if (clash) return ok({ error: "slug already used in this language" }, 409);
    if (isDefaultLocale) {
      const clashMain = await env.DB.prepare(
        `SELECT id FROM posts WHERE site_id=? AND type='post' AND slug=? AND id<>?
          AND COALESCE(NULLIF(TRIM(lang_group), ''), id)<>? LIMIT 1`
      ).bind(siteId, tSlug, entityId, langGroup).first<any>();
      if (clashMain) return ok({ error: "slug already used in this language" }, 409);
    }
  }

  if (isCreate) {
    await env.DB.prepare(
      `INSERT INTO posts (id, site_id, author_id, author_member_id, type, slug, status, lang_group, created_at, updated_at)
       VALUES (?, ?, '', ?, 'post', ?, 'draft', ?, ?, ?)`
    ).bind(entityId, siteId, memberId, tSlug || entityId, entityId, now(), now()).run();
  } else {
    // `status` is deliberately **not** in this UPDATE (see the note above).
    // The main-table slug follows the save only when this locale owns it —
    // otherwise renaming would move the *other* languages' URLs, whose
    // COALESCE falls through to it.
    const others = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM post_translations WHERE post_id=? AND locale<>?"
    ).bind(entityId, locale).first<any>();
    const ownsMainSlug = isDefaultLocale || Number(others?.c ?? 0) === 0;
    if (ownsMainSlug && tSlug) {
      await env.DB.prepare("UPDATE posts SET slug=?, updated_at=? WHERE id=? AND site_id=?")
        .bind(tSlug, now(), entityId, siteId).run();
    } else {
      await env.DB.prepare("UPDATE posts SET updated_at=? WHERE id=? AND site_id=?")
        .bind(now(), entityId, siteId).run();
    }
  }

  const existing = await env.DB.prepare(
    "SELECT id, slug FROM post_translations WHERE post_id=? AND locale=? LIMIT 1"
  ).bind(entityId, locale).first<any>();
  if (existing) {
    const nextSlug = slugGiven ? (tSlug || null) : (existing.slug ?? null);
    await env.DB.prepare(
      "UPDATE post_translations SET title=?, excerpt=?, content=?, slug=?, updated_at=? WHERE id=?"
    ).bind(title, excerpt, content, nextSlug, now(), existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO post_translations (id, post_id, locale, title, excerpt, content, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(await randomId(), entityId, locale, title, excerpt, content, tSlug || null, now(), now()).run();
  }

  // Custom fields: written against **this save's locale**, and only for keys
  // the active theme declares for this site. Reading is the ladder in
  // `platform/post-meta.ts` — never here (rule 70).
  await writePostMeta(env, siteId, entityId, locale, body.meta);

  await bumpContentCache(env, siteId);
  // Read the row back rather than reporting what was *asked for*: an update
  // does not touch the status, so echoing a literal `"draft"` would tell a
  // member their published post is a draft.
  const after = await env.DB.prepare(
    `SELECT p.status, COALESCE(t.slug, p.slug) AS slug
       FROM posts p JOIN post_translations t ON t.post_id=p.id AND t.locale=?
      WHERE p.id=? AND p.site_id=? LIMIT 1`
  ).bind(locale, entityId, siteId).first<any>();
  const slug = after?.slug ?? (tSlug || entityId);
  return ok(
    { id: entityId, post: { id: entityId, locale, slug, status: after?.status ?? "draft", url: `/${locale}/blog/${slug}` } },
    isCreate ? 201 : 200
  );
}

/** A member deleting their **own** post. Same ownership filter, same 404. */
export async function deleteMemberPost(env: Env, siteId: string, memberId: string, id: string): Promise<Response> {
  const owned = await env.DB.prepare(
    "SELECT id FROM posts WHERE id=? AND site_id=? AND author_member_id=? AND type='post' LIMIT 1"
  ).bind(id, siteId, memberId).first<any>();
  if (!owned) return ok({ error: "not found" }, 404);
  // Plugins purge their derived data first, exactly as the staff path does.
  try {
    await doAction("beforeDeletePost", { env, siteId }, { id, siteId });
  } catch {
    /* a plugin failure must not prevent the delete */
  }
  await env.DB.prepare("DELETE FROM post_translations WHERE post_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM post_meta WHERE post_id = ?").bind(id).run().catch(() => {});
  await env.DB.prepare("DELETE FROM term_relationships WHERE post_id = ?").bind(id).run().catch(() => {});
  // `site_id` stays in the predicate even though `owned` proved it: the check
  // and the write must agree on what "this post" means, and a later edit to one
  // of them should not be able to silently widen the other.
  await env.DB.prepare("DELETE FROM posts WHERE id = ? AND site_id = ?").bind(id, siteId).run();
  await bumpContentCache(env, siteId);
  return ok({ ok: true });
}

export async function routeFrontApi(env: Env, request: Request, siteId: string, resolvedPath: string): Promise<Response> {
  // `resolvedPath` is the path *after* the site prefix was stripped, so the
  // match is on `/api/v1/front/…` regardless of how the site is mounted.
  const path = resolvedPath.replace(/^\/api\/v1\/front\/?/, "");
  const method = request.method;

  if (path === "auth/register" && method === "POST") {
    const { body, form } = await readFrontParams(request);
    const r = await registerMember(env, siteId, String(body.username ?? ""), String(body.password ?? ""), body.email ? String(body.email) : null);
    // `closed` is a policy refusal (403); the rest are input errors (400).
    // The codes are stable so the theme can translate them.
    const res =
      "error" in r
        ? ok({ error: r.error }, r.error === "closed" ? 403 : 400)
        : new Response(JSON.stringify({ ok: true, member: r.member }), {
            status: 201,
            headers: { "Content-Type": "application/json", "Set-Cookie": r.cookie },
          });
    return frontAnswer(form, res, { redirect: body.redirect, fallback: "/" });
  }

  if (path === "auth/login" && method === "POST") {
    const { body, form } = await readFrontParams(request);
    const r = await loginMember(env, siteId, String(body.username ?? ""), String(body.password ?? ""));
    const res =
      "error" in r
        ? ok({ error: r.error }, 401)
        : new Response(JSON.stringify({ ok: true, member: r.member }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Set-Cookie": r.cookie },
          });
    return frontAnswer(form, res, { redirect: body.redirect, fallback: "/" });
  }

  if (path === "auth/logout" && method === "POST") {
    const { body, form } = await readFrontParams(request);
    const r = await logoutMember(env, request);
    const res = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": r.cookie },
    });
    return frontAnswer(form, res, { redirect: body.redirect, fallback: "/" });
  }

  if (path === "me" && method === "GET") {
    // `requireMember` answers 401 with JSON; `me` returning `{ member: null }`
    // with 200 would make "not signed in" and "signed in" the same shape, and
    // the theme's header would have to guess which it got.
    const m = await requireMember(env, request, siteId);
    if (m instanceof Response) return m;
    return ok({ member: m });
  }

  // -- the member's own posts (rule 84) ------------------------------------
  // Identity comes from `requireMember` and **only** from there; nothing in the
  // body or the path can name an author. A signed-out caller gets the 401
  // `requireMember` produces, which is the same answer every other front
  // endpoint gives — the surface has one gate, not one per endpoint.
  //
  // There is deliberately **no** `GET /posts` list here. The read path for "my
  // posts" is the account page's `my_posts` scope (rule 82), defined once in
  // `buildScope`; a second reader with its own SQL would be a second definition
  // of "mine", and the two would be free to disagree.
  // A form cannot send `PUT` or `DELETE`, so each write has a POST twin. They
  // are **routes**, not second implementations: every one calls the same
  // `saveMemberPost` / `deleteMemberPost`, so the ownership filter, the author
  // and the status rule live in exactly one place (rule 84). The JSON verbs
  // stay for scripts; `POST /posts/:id/delete` is how a browser deletes.
  if (path === "posts" && method === "POST") {
    const m = await requireMember(env, request, siteId);
    if (m instanceof Response) return m;
    const { body, form } = await readFrontParams(request);
    return frontAnswer(form, await saveMemberPost(env, siteId, m.id, null, body), {
      redirect: body.redirect,
      fallback: "/",
    });
  }
  const ownDelete = path.match(/^posts\/([^/]+)\/delete$/);
  if (ownDelete && method === "POST") {
    const m = await requireMember(env, request, siteId);
    if (m instanceof Response) return m;
    const { body, form } = await readFrontParams(request);
    const res = await deleteMemberPost(env, siteId, m.id, decodeURIComponent(ownDelete[1]));
    return frontAnswer(form, res, { redirect: body.redirect, fallback: "/" });
  }
  const ownPost = path.match(/^posts\/([^/]+)$/);
  if (ownPost && (method === "PUT" || method === "POST")) {
    const m = await requireMember(env, request, siteId);
    if (m instanceof Response) return m;
    const { body, form } = await readFrontParams(request);
    const res = await saveMemberPost(env, siteId, m.id, decodeURIComponent(ownPost[1]), body);
    return frontAnswer(form, res, { redirect: body.redirect, fallback: "/" });
  }
  if (ownPost && method === "DELETE") {
    const m = await requireMember(env, request, siteId);
    if (m instanceof Response) return m;
    return deleteMemberPost(env, siteId, m.id, decodeURIComponent(ownPost[1]));
  }

  // -- public form submissions ---------------------------------------------
  if ((path === "forms/submit" || path === "form-submit") && method === "POST") {
    const { body, form } = await readFrontParams(request);
    const result = await processPublicFormSubmission(env, siteId, request, body);
    if (!result.ok) {
      const res = ok({ error: result.error || "Submission failed" }, result.status || 400);
      return frontAnswer(form, res, { redirect: body.redirect || body.source_url, fallback: "/" });
    }
    const res = ok({ ok: true, message: result.message }, 200);
    return frontAnswer(form, res, { redirect: result.redirect || body.redirect || body.source_url, fallback: "/" });
  }

  // -- article and page comments -------------------------------------------
  if (path === "comments" && method === "GET") {
    const url = new URL(request.url);
    const postId = url.searchParams.get("post_id") || url.searchParams.get("postId") || "";
    if (!postId) return ok({ error: "post_id is required" }, 400);
    const tree = await getPostCommentsTree(env, siteId, postId);
    return ok({ ok: true, items: tree });
  }

  if (path === "comments" && method === "POST") {
    const { body, form } = await readFrontParams(request);
    const member = await currentMember(env, request, siteId);
    const result = await createComment(env, siteId, request, body, member);
    if (!result.ok) {
      const res = ok({ error: result.error || "Comment submission failed" }, result.status || 400);
      return frontAnswer(form, res, { redirect: body.redirect || body.source_url, fallback: "/" });
    }
    const res = ok({ ok: true, message: result.message, comment: result.comment }, 200);
    return frontAnswer(form, res, { redirect: body.redirect || body.source_url, fallback: "/" });
  }

  return ok({ error: "Not found" }, 404);
}
