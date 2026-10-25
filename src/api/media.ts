/**
 * The media domain: list, upload, update, delete, and the row a write path
 * must re-read before it mutates.
 *
 * Extracted from `src/api.ts` (refactor plan §5). Scoping decisions live in
 * `platform/media-policy.ts`, not here — this file is the transport layer
 * around them.
 */
import { Env } from "../shared/types";
import { activity, now, ok } from "../shared/repo";
import { randomId } from "../shared/crypto";
import { readMediaPolicy, mediaOwnerClause } from "../platform/media-policy";
import {
  mediaProviderOf,
  isMediaStorageProvider,
  readMediaStorage,
  remoteObjectKey,
  readMediaKeys,
  uploadToImgbb,
  uploadToPostimages,
  deleteRemoteImage,
  type MediaStorageProvider,
} from "../platform/media-hosts";
import { listSites } from "../platform/sites";
import { getSetting } from "../platform/settings";
import { requestSiteId } from "./core";
import { requirePermission } from "../platform/permissions";
import { jsonBody } from "../shared/repo";
import { SessionUser } from "../shared/types";
import { requireSiteAccess } from "./core";

/**
 * The media library for one site, as this user may see it.
 *
 * Scoping is two-dimensional and both halves are decided in
 * `platform/media-policy.ts`, not here: `site_id` (the tenant) and, when the
 * site's policy asks for it, `uploaded_by` (the owner). The same module answers
 * the `/media/<key>` read path, so a file the list shows is a file the reader
 * can actually fetch.
 */
export async function mediaList(env: Env, url: URL, siteId: string, userId: string) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
  const offset = (page - 1) * limit;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const type = String(url.searchParams.get("type") ?? "").trim();
  const policy = await readMediaPolicy(env, siteId);
  const owner = mediaOwnerClause(policy, userId);

  // `WHERE site_id = ?` is written into each statement rather than assembled
  // into a shared fragment: `tests/tools/_tenant-query-audit.mjs` reads
  // statements line by line, and a tenant predicate it cannot see is a tenant
  // predicate nobody re-reads. The optional filters and the owner clause are
  // appended after it.
  const extra: string[] = [];
  const extraBinds: unknown[] = [];
  if (q) { extra.push("(filename LIKE ? OR alt_text LIKE ? OR title LIKE ?)"); extraBinds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  // `type` is a MIME prefix ("image/", "application/pdf"), matched with LIKE so
  // a caller does not have to enumerate the exact media types it will accept.
  if (type) { extra.push("mime_type LIKE ?"); extraBinds.push(`${type}%`); }
  const tail = `${extra.length ? " AND " + extra.join(" AND ") : ""}${owner.sql}`;
  const binds = [siteId, ...extraBinds, ...owner.binds];

  const rows = await env.DB.prepare(
    `SELECT * FROM media_files WHERE site_id = ?${tail} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM media_files WHERE site_id = ?${tail}`)
    .bind(...binds).first<any>();
  // `storage` tells the Media screen where new uploads go and whether each
  // vendor key is configured — as booleans, because the keys themselves must
  // never leave the server. Additive: existing readers ignore unknown fields.
  const storage = await readMediaStorage(env, siteId);
  return ok({ items: rows.results, page, limit, total: total?.count ?? 0, isolation: policy.isolation, site: siteId, storage });
}

export async function mediaUpload(env: Env, userId: string, request: Request, siteId: string) {
  // The tenant a file is filed under comes from `?site=`, which the client
  // controls and `requestSiteId()` only shape-checks. A write is the one place
  // that mints a tenant, so it is the one place that must confirm the site
  // exists — otherwise a typo files the upload under a site nobody can list.
  const known = await listSites(env);
  if (!known.some((s) => s.id === siteId)) return ok({ error: "unknown site" }, 400);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return ok({ error: "file required" }, 400);
  if (file.size > 25 * 1024 * 1024) return ok({ error: "max file size is 25MB" }, 413);
  const id = await randomId();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Where the bytes go is the site's `cfpress.media` → `provider`: "r2" when
  // the site never chose (every existing install), anything else only when it
  // names a real provider. A present-but-unknown value answers 400 rather
  // than silently landing in R2 — the operator believes imgbb has the bytes,
  // and "answered success, stored elsewhere" is the defect this file will not
  // reintroduce.
  let provider: MediaStorageProvider = "r2";
  try {
    const raw = await getSetting(env, siteId, "cfpress.media").catch(() => "{}");
    const parsed = raw ? JSON.parse(String(raw)) : {};
    const p = mediaProviderOf(parsed && typeof parsed === "object" ? parsed : {});
    if (isMediaStorageProvider(p)) provider = p;
    else return ok({ error: `unknown media provider "${p}" (use r2, imgbb or postimages)` }, 400);
  } catch {
    provider = "r2";
  }
  let key: string;
  let remoteUrl: string | null = null;
  let remoteDeleteUrl: string | null = null;
  if (provider === "r2") {
    // Without an R2 binding this branch has nowhere to put bytes: refuse with
    // the remedy attached, instead of inserting a row that points at nothing
    // (or throwing a TypeError off an undefined binding, which the error
    // wrapper would report as an opaque 500).
    if (!env.MEDIA) return ok({ error: "R2 is not configured on this install — pick imgbb or postimages on the Media screen, or enable R2" }, 400);
    key = `uploads/${siteId}/${new Date().toISOString().slice(0,10)}/${id}-${safe}`;
    // The bytes go in as a buffer, not a `File.stream()`: a stream body is only
    // consumed by whatever reads it, and the local R2 shim accepts the handle
    // without draining it — the row then exists with no object behind it, and
    // the read path answers 404 forever after. Buffering makes the write
    // complete before the row claims it does.
    const bytes = await file.arrayBuffer();
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: file.type || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" }
    });
  } else {
    // Remote rows keep a namespaced key (`uploads/{site}/remote/…`) so the
    // tenant gate keeps answering from the key alone, and the content keeps
    // storing `/media/<key>` URLs: the read path 302s to the vendor after the
    // same policy decision, so the picker, the renderer and rule 60b need no
    // new URL shape. The vendor answers first — a row is only inserted once
    // there are bytes (a URL) to point at.
    key = remoteObjectKey(siteId, provider, id, safe);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const input = { bytes, filename: file.name, mimeType: file.type || "application/octet-stream" };
    // Effective keys: the site's own setting first, the install secret as
    // fallback (`readMediaKeys`). Either layer empty still refuses below.
    const keys = await readMediaKeys(env, siteId);
    try {
      const remote = provider === "imgbb"
        ? await uploadToImgbb(input, { apiKey: keys.imgbb })
        : await uploadToPostimages(input, { apiKey: keys.postimages });
      remoteUrl = remote.url;
      remoteDeleteUrl = remote.deleteUrl;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A missing key is operator configuration (400 with the fix attached);
      // a vendor refusal is upstream (502 with their message, truncated).
      // Log it server-side too: the UI toast shows the operator one failure,
      // but only the log shows the *pattern* (every failure at 400-forbidden
      // reads very differently from a mix of 429s and timeouts).
      if (!/missing API key/.test(message)) console.error(`media remote upload refused: provider=${provider} site=${siteId}: ${message}`);
      const missingKey = /missing API key/.test(message);
      return ok({ error: missingKey ? message : `remote host refused the upload: ${message}` }, missingKey ? 400 : 502);
    }
  }
  // `uploaded_by` is what the owner axis reads. Leaving it NULL here would make
  // every new upload fall into the grandfathered "visible site-wide" bucket,
  // which is the opposite of what recording an owner is for.
  await env.DB.prepare(
    "INSERT INTO media_files (id, site_id, object_key, filename, mime_type, size, alt_text, title, uploaded_by, created_at, storage, remote_url, remote_delete_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, siteId, key, file.name, file.type || "application/octet-stream", file.size, String(form.get("alt") ?? ""), String(form.get("title") ?? file.name), userId, now(), provider, remoteUrl, remoteDeleteUrl).run();
  await activity(env, userId, "upload", "media", id, { filename: file.name, size: file.size, siteId, storage: provider });
  return ok({ id, url: `/media/${encodeURIComponent(key)}`, site: siteId }, 201);
}

/**
 * Load a media row **and** establish that this user may act on it.
 *
 * Two separate questions, and the second one is the one that keeps getting
 * skipped: `site_id` decides whether the row is in this tenant at all, while
 * the owner axis decides whether this particular user may edit or delete it.
 * Both are checked before anything is written or removed — the pattern
 * `savePost`/`deletePost` had to learn twice (see `docs/HANDOVER.md` §8.33).
 *
 * Returns a stable error string rather than a Response so the caller decides
 * the status code; `not_found` covers "no such row" and "another site's row"
 * on purpose, so the API does not confirm the existence of other tenants' ids.
 */
export async function mediaRowForWrite(
  env: Env,
  id: string,
  siteId: string,
  userId: string
): Promise<{ row: any } | { error: "not_found" | "not_owner" }> {
  const row = await env.DB.prepare("SELECT * FROM media_files WHERE id=? AND site_id=? LIMIT 1")
    .bind(id, siteId).first<any>();
  if (!row) return { error: "not_found" };
  const policy = await readMediaPolicy(env, siteId);
  if (policy.isolation === "owner" && row.uploaded_by != null && row.uploaded_by !== userId) {
    return { error: "not_owner" };
  }
  return { row };
}

/** Update the language-neutral descriptive fields. The bytes never change here:
 *  replacing a file's contents would silently break every page already
 *  referencing the old object, so that is a delete + upload, not a PATCH. */
export async function mediaUpdate(env: Env, userId: string, id: string, body: any, siteId: string) {
  const found = await mediaRowForWrite(env, id, siteId, userId);
  if ("error" in found) return ok({ error: found.error }, found.error === "not_found" ? 404 : 403);
  const fields: string[] = [];
  const binds: unknown[] = [];
  if (body.alt_text !== undefined) { fields.push("alt_text=?"); binds.push(String(body.alt_text ?? "")); }
  if (body.title !== undefined) { fields.push("title=?"); binds.push(String(body.title ?? "")); }
  if (!fields.length) return ok({ error: "nothing to update" }, 400);
  await env.DB.prepare(`UPDATE media_files SET ${fields.join(", ")} WHERE id=? AND site_id=?`)
    .bind(...binds, id, siteId).run();
  await activity(env, userId, "update", "media", id, { fields: fields.length, siteId });
  return ok({ ok: true, id, site: siteId });
}

/**
 * Delete a media file: the object first, then the row.
 *
 * Order is not cosmetic. The row is the only thing that knows the object's key,
 * so deleting the row first would strand the bytes in R2 with nothing left to
 * name them — an orphan no listing can show and no operator can find. Deleting
 * the object first can at worst leave a row whose object is gone, which the
 * read path already answers with 404 and a re-upload repairs.
 *
 * A failed R2 delete is reported, not swallowed: silently removing the row
 * would tell the operator the file is gone while it is still being served.
 */
export async function mediaDelete(env: Env, userId: string, id: string, siteId: string) {
  const found = await mediaRowForWrite(env, id, siteId, userId);
  if ("error" in found) return ok({ error: found.error }, found.error === "not_found" ? 404 : 403);
  const key = String(found.row.object_key ?? "");
  const storage = String(found.row.storage ?? "r2");
  if (storage !== "r2" && isMediaStorageProvider(storage)) {
    // Remote bytes belong to the vendor: ask them to delete (best-effort —
    // `deleteRemoteImage` never throws), skip the R2 delete (there is no
    // object under this key), then drop the row either way. The row is ours;
    // a down vendor must not veto the local delete.
    const gone = await deleteRemoteImage(storage, found.row.remote_delete_url ?? null);
    if (!gone) console.error(`media remote delete unconfirmed: provider=${storage} id=${id}`);
  } else {
    try {
      // No R2 here either: without a binding there are no bytes to strand,
      // so the row delete below is the whole delete (and must not throw).
      if (key) await env.MEDIA?.delete(key);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ok({ error: "object delete failed", detail: message }, 502);
    }
  }
  await env.DB.prepare("DELETE FROM media_files WHERE id=? AND site_id=?").bind(id, siteId).run();
  await activity(env, userId, "delete", "media", id, { key, siteId });
  return ok({ ok: true, id, key, site: siteId });
}

export async function dispatchMediaAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "media" && method === "GET") return mediaList(env, url, siteId, user.id);
  if ((path === "media" || path === "media/upload") && method === "POST") {
    if (!(await requirePermission(env, user, "media.write", siteId))) return ok({ error: "Forbidden" }, 403);
    return mediaUpload(env, user.id, request, siteId);
  }
  const mediaItem = path.match(/^media\/([^/]+)$/);
  if (mediaItem && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const key = decodeURIComponent(mediaItem[1]);
    const row = await env.DB.prepare("SELECT * FROM media_files WHERE site_id=? AND (id=? OR file_name=? OR r2_key=?) LIMIT 1")
      .bind(siteId, key, key, key).first<any>();
    if (!row) return ok({ error: "media not found" }, 404);
    return ok({ item: row });
  }
  if (mediaItem && (method === "PATCH" || method === "PUT")) {
    if (!(await requirePermission(env, user, "media.write", siteId))) return ok({ error: "Forbidden" }, 403);
    return mediaUpdate(env, user.id, decodeURIComponent(mediaItem[1]), await jsonBody(request), siteId);
  }
  if (mediaItem && method === "DELETE") {
    if (!(await requirePermission(env, user, "media.write", siteId))) return ok({ error: "Forbidden" }, 403);
    return mediaDelete(env, user.id, decodeURIComponent(mediaItem[1]), siteId);
  }

  return null;
}
