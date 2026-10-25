/**
 * Built-in Comments System — Tenant-isolated post and page discussions.
 *
 * Conforms to CFPress architecture rules:
 *   - Strictly scoped by `siteId` on every read and write.
 *   - 2-level comment hierarchy (root + reply).
 *   - Integrated with front-end members (`author_member_id`) and guest fallback.
 *   - Moderation status: 'pending' | 'approved' | 'spam' | 'trash'.
 *   - Automatic cache invalidation (`bumpContentCache`) on comment approval/deletion.
 */

import { Env, SessionUser } from "../shared/types";
import { now } from "../shared/repo";
import { randomId } from "../shared/crypto";
import { bumpContentCache } from "../shared/cache";
import { getSetting } from "./settings";
import { MemberUser } from "./members";

export interface CommentRow {
  id: string;
  site_id: string;
  post_id: string;
  parent_id: string | null;
  author_member_id: string | null;
  author_name: string;
  author_email: string | null;
  author_url: string | null;
  content: string;
  status: "pending" | "approved" | "spam" | "trash";
  ip_hash: string | null;
  user_agent: string | null;
  created_at: number;
  updated_at: number;
  post_title?: string;
  post_slug?: string;
  replies?: CommentRow[];
}

export interface CommentCounts {
  all: number;
  pending: number;
  approved: number;
  spam: number;
  trash: number;
}

/**
 * Hash IP address for privacy compliance & anti-spam rate limiting.
 */
async function hashIp(ip: string): Promise<string> {
  if (!ip) return "anon";
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return "anon";
  }
}

/**
 * Submit a new comment (front-end public or member).
 */
export async function createComment(
  env: Env,
  siteId: string,
  request: Request,
  body: Record<string, any>,
  member?: MemberUser | null
): Promise<{ ok: boolean; status: number; message?: string; error?: string; comment?: CommentRow }> {
  // 1. Check if comments are enabled on this site
  const enabled = (await getSetting(env, siteId, "comments.enabled")) !== "0";
  if (!enabled) {
    return { ok: false, status: 403, error: "Comments are disabled on this site." };
  }

  // 2. Check if member login is required
  const requireMember = (await getSetting(env, siteId, "comments.require_member")) === "1";
  if (requireMember && !member) {
    return { ok: false, status: 401, error: "You must be signed in to post a comment." };
  }

  // 3. Anti-spam honeypot check
  if (body._cfp_hp && String(body._cfp_hp).trim().length > 0) {
    // Silently return ok to trick spam bots without saving
    return { ok: true, status: 200, message: "Thank you for your comment!" };
  }

  // 4. Validate post exists on this site
  const postId = String(body.post_id || body.postId || "").trim();
  if (!postId) {
    return { ok: false, status: 400, error: "Missing required post_id." };
  }

  const post = await env.DB.prepare(
    "SELECT id, slug FROM posts WHERE (id = ? OR slug = ?) AND site_id = ? LIMIT 1"
  )
    .bind(postId, postId, siteId)
    .first<{ id: string; slug: string }>();

  if (!post) {
    return { ok: false, status: 404, error: "The article or page was not found." };
  }

  // 5. Validate parent comment (enforce 2-level hierarchy: root + reply)
  let parentId: string | null = null;
  if (body.parent_id) {
    const pId = String(body.parent_id).trim();
    if (pId) {
      const parentRow = await env.DB.prepare(
        "SELECT id, parent_id FROM comments WHERE id = ? AND site_id = ? AND post_id = ? LIMIT 1"
      )
        .bind(pId, siteId, post.id)
        .first<{ id: string; parent_id: string | null }>();

      if (!parentRow) {
        return { ok: false, status: 400, error: "Parent comment not found." };
      }
      // If the parent is already a reply, flatten to the root comment to maintain 2 levels
      parentId = parentRow.parent_id ? parentRow.parent_id : parentRow.id;
    }
  }

  // 6. Validate author info & content
  let authorName = "";
  let authorEmail: string | null = null;
  let authorUrl: string | null = null;
  let authorMemberId: string | null = null;

  if (member) {
    authorMemberId = member.id;
    authorName = (member.displayName || member.username || "").trim();
    authorEmail = member.email || null;
  } else {
    authorName = String(body.author_name || body.name || "").trim();
    const rawEmail = String(body.author_email || body.email || "").trim();
    authorEmail = rawEmail || null;
    const rawUrl = String(body.author_url || body.url || "").trim();
    authorUrl = rawUrl || null;
  }

  if (!authorName) {
    return { ok: false, status: 422, error: "Name is required." };
  }
  if (authorName.length > 80) {
    return { ok: false, status: 422, error: "Name is too long (max 80 characters)." };
  }

  if (authorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) {
    return { ok: false, status: 422, error: "Please provide a valid email address." };
  }

  const content = String(body.content || body.comment || "").trim();
  if (!content || content.length < 2) {
    return { ok: false, status: 422, error: "Comment content is too short (min 2 characters)." };
  }
  if (content.length > 5000) {
    return { ok: false, status: 422, error: "Comment content is too long (max 5000 characters)." };
  }

  // 7. Rate limiting check (same IP within 10 seconds)
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ipHash = await hashIp(clientIp);
  const nowTs = now();

  const recent = await env.DB.prepare(
    "SELECT created_at FROM comments WHERE site_id = ? AND ip_hash = ? AND created_at > ? LIMIT 1"
  )
    .bind(siteId, ipHash, nowTs - 10)
    .first<{ created_at: number }>();

  if (recent) {
    return { ok: false, status: 429, error: "You are posting comments too quickly. Please wait a moment." };
  }

  // 8. Determine moderation status
  const requireApproval = (await getSetting(env, siteId, "comments.require_approval")) !== "0";
  // If member is a staff admin/author or approval is turned off, approve automatically
  const initialStatus: "pending" | "approved" = requireApproval ? "pending" : "approved";

  const commentId = `cmt_${await randomId()}`;
  const userAgent = String(request.headers.get("user-agent") || "").slice(0, 255);

  await env.DB.prepare(
    `INSERT INTO comments (
       id, site_id, post_id, parent_id, author_member_id,
       author_name, author_email, author_url, content,
       status, ip_hash, user_agent, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      commentId,
      siteId,
      post.id,
      parentId,
      authorMemberId,
      authorName,
      authorEmail,
      authorUrl,
      content,
      initialStatus,
      ipHash,
      userAgent,
      nowTs,
      nowTs
    )
    .run();

  // 9. Bump content cache if comment is immediately visible
  if (initialStatus === "approved") {
    await bumpContentCache(env, siteId);
  }

  const successMsg =
    initialStatus === "approved"
      ? "Your comment has been published!"
      : "Your comment has been submitted and is awaiting moderation.";

  return {
    ok: true,
    status: 200,
    message: successMsg,
    comment: {
      id: commentId,
      site_id: siteId,
      post_id: post.id,
      parent_id: parentId,
      author_member_id: authorMemberId,
      author_name: authorName,
      author_email: authorEmail,
      author_url: authorUrl,
      content,
      status: initialStatus,
      ip_hash: ipHash,
      user_agent: userAgent,
      created_at: nowTs,
      updated_at: nowTs,
    },
  };
}

/**
 * Retrieve approved comments for a post as a clean 2-level tree (roots + replies).
 */
export async function getPostCommentsTree(
  env: Env,
  siteId: string,
  postId: string
): Promise<CommentRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, site_id, post_id, parent_id, author_member_id,
            author_name, author_url, content, status, created_at, updated_at
     FROM comments
     WHERE site_id = ? AND post_id = ? AND status = 'approved'
     ORDER BY created_at ASC`
  )
    .bind(siteId, postId)
    .all<CommentRow>();

  const all = (rows.results as CommentRow[]) || [];
  const roots: CommentRow[] = [];
  const replyMap = new Map<string, CommentRow[]>();

  for (const item of all) {
    if (!item.parent_id) {
      item.replies = [];
      roots.push(item);
    } else {
      if (!replyMap.has(item.parent_id)) {
        replyMap.set(item.parent_id, []);
      }
      replyMap.get(item.parent_id)!.push(item);
    }
  }

  // Attach replies to each root comment
  for (const root of roots) {
    root.replies = replyMap.get(root.id) || [];
  }

  return roots;
}

/**
 * Count total approved comments for a post.
 */
export async function getPostCommentsCount(
  env: Env,
  siteId: string,
  postId: string
): Promise<number> {
  const res = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM comments WHERE site_id = ? AND post_id = ? AND status = 'approved'"
  )
    .bind(siteId, postId)
    .first<{ total: number }>();
  return Number(res?.total || 0);
}

/**
 * Admin: Query comments with status counts, post filtering, and pagination.
 */
export async function getAdminComments(
  env: Env,
  siteId: string,
  query: {
    status?: string;
    post_id?: string;
    q?: string;
    page?: number;
    limit?: number;
  }
): Promise<{
  items: CommentRow[];
  total: number;
  page: number;
  limit: number;
  counts: CommentCounts;
}> {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(query.limit || 20)));
  const offset = (page - 1) * limit;

  // 1. Gather status counts for tab badges
  const countRows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM comments
     WHERE site_id = ?
     GROUP BY status`
  )
    .bind(siteId)
    .all<{ status: string; count: number }>();

  const counts: CommentCounts = {
    all: 0,
    pending: 0,
    approved: 0,
    spam: 0,
    trash: 0,
  };

  for (const r of (countRows.results as any[]) || []) {
    const c = Number(r.count || 0);
    const s = String(r.status);
    if (s in counts) (counts as any)[s] = c;
    if (s !== "trash" && s !== "spam") counts.all += c;
  }

  // 2. Build filtered list query
  const conditions: string[] = ["c.site_id = ?"];
  const params: any[] = [siteId];

  const status = String(query.status || "all").toLowerCase();
  if (status && status !== "all") {
    conditions.push("c.status = ?");
    params.push(status);
  } else if (status === "all") {
    // Default 'all' tab hides spam & trash like WordPress
    conditions.push("c.status NOT IN ('spam', 'trash')");
  }

  if (query.post_id) {
    conditions.push("c.post_id = ?");
    params.push(query.post_id);
  }

  if (query.q) {
    conditions.push("(c.author_name LIKE ? OR c.author_email LIKE ? OR c.content LIKE ?)");
    const pattern = `%${query.q}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.join(" AND ");

  const totalRes = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM comments c WHERE ${whereClause}`
  )
    .bind(...params)
    .first<{ total: number }>();
  const total = Number(totalRes?.total || 0);

  const itemsRes = await env.DB.prepare(
    `SELECT c.*, COALESCE(t.title, p.slug) AS post_title, p.slug AS post_slug
     FROM comments c
     LEFT JOIN posts p ON c.post_id = p.id
     LEFT JOIN post_translations t ON t.post_id = p.id
     WHERE ${whereClause}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<CommentRow>();

  return {
    items: (itemsRes.results as CommentRow[]) || [],
    total,
    page,
    limit,
    counts,
  };
}

/**
 * Admin: Update single comment status.
 */
export async function updateCommentStatus(
  env: Env,
  siteId: string,
  commentId: string,
  status: "pending" | "approved" | "spam" | "trash"
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!["pending", "approved", "spam", "trash"].includes(status)) {
    return { ok: false, status: 400, error: "Invalid status value." };
  }

  const res = await env.DB.prepare(
    "UPDATE comments SET status = ?, updated_at = ? WHERE id = ? AND site_id = ?"
  )
    .bind(status, now(), commentId, siteId)
    .run();

  if (res.meta.changes === 0) {
    return { ok: false, status: 404, error: "Comment not found." };
  }

  await bumpContentCache(env, siteId);
  return { ok: true, status: 200 };
}

/**
 * Admin: Permanently delete a comment.
 */
export async function deleteComment(
  env: Env,
  siteId: string,
  commentId: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await env.DB.prepare(
    "DELETE FROM comments WHERE id = ? AND site_id = ?"
  )
    .bind(commentId, siteId)
    .run();

  if (res.meta.changes === 0) {
    return { ok: false, status: 404, error: "Comment not found." };
  }

  // Also clean up any children if deleting root comment
  await env.DB.prepare("DELETE FROM comments WHERE parent_id = ? AND site_id = ?")
    .bind(commentId, siteId)
    .run();

  await bumpContentCache(env, siteId);
  return { ok: true, status: 200 };
}

/**
 * Admin: Batch status update (approve, spam, trash, restore).
 */
export async function batchCommentStatus(
  env: Env,
  siteId: string,
  ids: string[],
  status: "pending" | "approved" | "spam" | "trash"
): Promise<{ ok: boolean; updated: number }> {
  if (!ids.length || !["pending", "approved", "spam", "trash"].includes(status)) {
    return { ok: false, updated: 0 };
  }

  const nowTs = now();
  const stmts = ids.map((id) =>
    env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ? AND site_id = ?").bind(
      status,
      nowTs,
      id,
      siteId
    )
  );

  await env.DB.batch(stmts);
  await bumpContentCache(env, siteId);
  return { ok: true, updated: ids.length };
}

/**
 * Admin: Batch permanent delete.
 */
export async function batchDeleteComments(
  env: Env,
  siteId: string,
  ids: string[]
): Promise<{ ok: boolean; deleted: number }> {
  if (!ids.length) return { ok: false, deleted: 0 };

  const stmts: any[] = [];
  for (const id of ids) {
    stmts.push(
      env.DB.prepare("DELETE FROM comments WHERE id = ? AND site_id = ?").bind(id, siteId),
      env.DB.prepare("DELETE FROM comments WHERE parent_id = ? AND site_id = ?").bind(id, siteId)
    );
  }

  await env.DB.batch(stmts);
  await bumpContentCache(env, siteId);
  return { ok: true, deleted: ids.length };
}

/**
 * Admin: Reply to a comment as a staff member.
 */
export async function replyComment(
  env: Env,
  siteId: string,
  parentId: string,
  content: string,
  user: SessionUser
): Promise<{ ok: boolean; status: number; error?: string; comment?: CommentRow }> {
  const parent = await env.DB.prepare(
    "SELECT id, post_id, parent_id FROM comments WHERE id = ? AND site_id = ? LIMIT 1"
  )
    .bind(parentId, siteId)
    .first<{ id: string; post_id: string; parent_id: string | null }>();

  if (!parent) {
    return { ok: false, status: 404, error: "Parent comment not found." };
  }

  const cleanContent = String(content || "").trim();
  if (!cleanContent) {
    return { ok: false, status: 422, error: "Reply content cannot be empty." };
  }

  // 2-level hierarchy
  const rootParentId = parent.parent_id ? parent.parent_id : parent.id;
  const commentId = `cmt_${await randomId()}`;
  const nowTs = now();
  const authorName = user.username || "Staff";

  await env.DB.prepare(
    `INSERT INTO comments (
       id, site_id, post_id, parent_id, author_member_id,
       author_name, author_email, author_url, content,
       status, ip_hash, user_agent, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'staff', 'cfpress-admin', ?, ?)`
  )
    .bind(
      commentId,
      siteId,
      parent.post_id,
      rootParentId,
      null,
      authorName,
      user.email || null,
      null,
      cleanContent,
      nowTs,
      nowTs
    )
    .run();

  await bumpContentCache(env, siteId);

  return {
    ok: true,
    status: 200,
    comment: {
      id: commentId,
      site_id: siteId,
      post_id: parent.post_id,
      parent_id: rootParentId,
      author_member_id: null,
      author_name: authorName,
      author_email: user.email || null,
      author_url: null,
      content: cleanContent,
      status: "approved",
      ip_hash: "staff",
      user_agent: "cfpress-admin",
      created_at: nowTs,
      updated_at: nowTs,
    },
  };
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(ts: number): string {
  if (!ts) return "";
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Render the full interactive comments section (tree + form + AJAX script) into HTML.
 */
export async function renderCommentSectionHtml(
  env: Env,
  siteId: string,
  post: { id: string; title?: string; slug?: string },
  member?: MemberUser | null
): Promise<string> {
  const enabled = (await getSetting(env, siteId, "comments.enabled")) !== "0";
  if (!enabled) {
    return `<div class="cfp-comments-closed" style="margin:2.5rem 0;color:var(--muted-foreground);font-size:.9rem;text-align:center">评论已关闭。</div>`;
  }

  const requireMember = (await getSetting(env, siteId, "comments.require_member")) === "1";
  const roots = await getPostCommentsTree(env, siteId, post.id);
  const totalCount = await getPostCommentsCount(env, siteId, post.id);

  let treeHtml = "";
  if (roots.length === 0) {
    treeHtml = `<div class="cfp-comments-empty" style="padding:1.5rem 0;color:var(--muted-foreground);font-size:.9rem">暂无评论，来发表第一条留言吧！</div>`;
  } else {
    treeHtml = roots
      .map((root) => {
        const rootInitial = (root.author_name || "访").slice(0, 1).toUpperCase();
        let repliesHtml = "";
        if (root.replies && root.replies.length > 0) {
          repliesHtml = root.replies
            .map((reply) => {
              const replyInitial = (reply.author_name || "访").slice(0, 1).toUpperCase();
              return `
              <div class="cfp-comment-item cfp-comment-reply" id="comment-${esc(reply.id)}" style="display:flex;gap:1rem;margin-top:1rem;padding-left:1.5rem;border-left:2px solid var(--border)">
                <div class="cfp-comment-avatar" style="width:2rem;height:2rem;border-radius:50%;background:var(--accent);color:var(--accent-foreground);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:.85rem;flex-shrink:0">
                  ${esc(replyInitial)}
                </div>
                <div class="cfp-comment-body" style="flex:1">
                  <div class="cfp-comment-meta" style="display:flex;align-items:center;gap:.6rem;font-size:.825rem;margin-bottom:.3rem">
                    <strong style="color:var(--foreground)">${esc(reply.author_name)}</strong>
                    <span style="color:var(--muted-foreground)">${esc(fmtDate(reply.created_at))}</span>
                  </div>
                  <div class="cfp-comment-text" style="font-size:.925rem;line-height:1.6;color:var(--foreground)">${esc(reply.content)}</div>
                </div>
              </div>`;
            })
            .join("");
        }

        return `
        <div class="cfp-comment-item" id="comment-${esc(root.id)}" style="display:flex;gap:1rem;margin-bottom:1.5rem;padding-bottom:1.25rem;border-bottom:1px solid var(--border)">
          <div class="cfp-comment-avatar" style="width:2.5rem;height:2.5rem;border-radius:50%;background:var(--primary);color:var(--primary-foreground);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:1rem;flex-shrink:0">
            ${esc(rootInitial)}
          </div>
          <div class="cfp-comment-body" style="flex:1">
            <div class="cfp-comment-meta" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem">
              <div style="display:flex;align-items:center;gap:.6rem;font-size:.875rem">
                <strong style="color:var(--foreground)">${esc(root.author_name)}</strong>
                <span style="color:var(--muted-foreground)">${esc(fmtDate(root.created_at))}</span>
              </div>
              <button type="button" class="cfp-reply-btn btn outline sm" data-parent-id="${esc(root.id)}" data-author="${esc(root.author_name)}" style="padding:.2rem .6rem;font-size:.78rem;height:auto">回复</button>
            </div>
            <div class="cfp-comment-text" style="font-size:.95rem;line-height:1.6;color:var(--foreground)">${esc(root.content)}</div>
            ${repliesHtml}
          </div>
        </div>`;
      })
      .join("");
  }

  let formHtml = "";
  if (requireMember && !member) {
    formHtml = `
      <div class="cfp-comment-login-prompt" style="padding:1.5rem;text-align:center;background:var(--accent);border-radius:8px;margin-top:1.5rem">
        <p style="margin:0 0 .75rem;font-size:.925rem;color:var(--foreground)">本站已开启实名评论，请登录前台会员账号后参与讨论。</p>
        <a href="/login?redirect=${encodeURIComponent(post.slug ? `/posts/${post.slug}` : "")}" class="btn primary sm">登录会员账号</a>
      </div>`;
  } else {
    const authorFields = member
      ? `<div class="cfp-comment-signed" style="margin-bottom:.75rem;font-size:.875rem;color:var(--muted-foreground)">当前登录身份：<strong style="color:var(--foreground)">${esc(member.displayName || member.username)}</strong></div>`
      : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:.75rem">
          <div>
            <input type="text" name="author_name" placeholder="您的称呼 / 昵称 *" required style="width:100%;padding:.5rem .75rem;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--foreground)">
          </div>
          <div>
            <input type="email" name="author_email" placeholder="电子邮箱 (选填)" style="width:100%;padding:.5rem .75rem;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--foreground)">
          </div>
        </div>`;

    formHtml = `
      <form class="cfp-comment-form" action="/api/v1/front/comments" method="POST" style="margin-top:1.5rem">
        <input type="hidden" name="post_id" value="${esc(post.id)}">
        <input type="hidden" name="parent_id" value="">
        <input type="hidden" name="source_url" value="">
        <div style="display:none !important;visibility:hidden" aria-hidden="true">
          <input type="text" name="_cfp_hp" tabindex="-1" autocomplete="off">
        </div>

        <div class="cfp-reply-indicator" style="display:none;margin-bottom:.75rem;padding:.4rem .8rem;background:var(--accent);border-radius:6px;font-size:.825rem;align-items:center;justify-content:space-between">
          <span>回复 <strong class="cfp-reply-target-name"></strong>：</span>
          <button type="button" class="cfp-cancel-reply-btn" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:.8rem">取消回复</button>
        </div>

        ${authorFields}

        <div style="margin-bottom:.75rem">
          <textarea name="content" placeholder="文明理性交流，写下您的见解..." rows="3" required style="width:100%;padding:.6rem .75rem;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font-family:inherit;font-size:.925rem;resize:vertical"></textarea>
        </div>

        <div class="cfp-comment-feedback" style="display:none"></div>

        <div style="display:flex;justify-content:flex-end">
          <button type="submit" class="btn primary sm cfp-comment-submit-btn" style="padding:.5rem 1.25rem;cursor:pointer">发表评论</button>
        </div>
      </form>`;
  }

  return `
    <section class="cfp-comments-section" id="comments" style="margin-top:3.5rem;padding-top:2rem;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
        <h3 style="margin:0;font-size:1.25rem;font-weight:700">文章留言 (${totalCount})</h3>
      </div>

      <div class="cfp-comments-list">
        ${treeHtml}
      </div>

      <div class="cfp-comments-form-wrap">
        ${formHtml}
      </div>

      <script>
      (function() {
        var section = document.getElementById("comments");
        if (!section) return;

        var form = section.querySelector(".cfp-comment-form");
        if (!form) return;

        var parentInput = form.querySelector('input[name="parent_id"]');
        var replyBox = form.querySelector(".cfp-reply-indicator");
        var replyTarget = form.querySelector(".cfp-reply-target-name");
        var cancelBtn = form.querySelector(".cfp-cancel-reply-btn");
        var msgBox = form.querySelector(".cfp-comment-feedback");
        var submitBtn = form.querySelector(".cfp-comment-submit-btn");
        var origBtnText = submitBtn ? submitBtn.innerHTML : "发表评论";

        // Handle Reply button clicks
        section.addEventListener("click", function(e) {
          var btn = e.target.closest(".cfp-reply-btn");
          if (!btn) return;
          var parentId = btn.getAttribute("data-parent-id") || "";
          var author = btn.getAttribute("data-author") || "";
          if (parentInput) parentInput.value = parentId;
          if (replyTarget) replyTarget.textContent = author;
          if (replyBox) replyBox.style.display = "flex";
          form.scrollIntoView({ behavior: "smooth", block: "center" });
          var txt = form.querySelector('textarea[name="content"]');
          if (txt) txt.focus();
        });

        // Cancel Reply
        if (cancelBtn) {
          cancelBtn.addEventListener("click", function() {
            if (parentInput) parentInput.value = "";
            if (replyBox) replyBox.style.display = "none";
          });
        }

        // AJAX Form Submit
        form.addEventListener("submit", async function(e) {
          e.preventDefault();
          if (msgBox) { msgBox.style.display = "none"; msgBox.innerHTML = ""; }

          var srcInput = form.querySelector('input[name="source_url"]');
          if (srcInput && !srcInput.value) srcInput.value = window.location.href;

          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = "0.7";
            submitBtn.innerHTML = "⏳ 提交中...";
          }

          var formData = new FormData(form);
          var payload = {};
          formData.forEach(function(val, key) { payload[key] = val; });

          try {
            var res = await fetch(form.action, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify(payload)
            });
            var data = await res.json().catch(function() { return {}; });

            if (res.ok && data.ok) {
              if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = "1"; submitBtn.innerHTML = origBtnText; }
              form.reset();
              if (parentInput) parentInput.value = "";
              if (replyBox) replyBox.style.display = "none";
              if (msgBox) {
                msgBox.style.display = "block";
                msgBox.style.padding = ".75rem 1rem";
                msgBox.style.marginBottom = "1rem";
                msgBox.style.borderRadius = "6px";
                msgBox.style.background = "oklch(0.97 0.03 140)";
                msgBox.style.color = "oklch(0.3 0.1 140)";
                msgBox.style.border = "1px solid oklch(0.85 0.08 140)";
                msgBox.style.fontSize = ".875rem";
                msgBox.innerHTML = "✅ " + (data.message || "评论发表成功！");
              }
              // If immediately approved, reload or insert
              if (data.comment && data.comment.status === "approved") {
                setTimeout(function() { window.location.reload(); }, 1200);
              }
            } else {
              if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = "1"; submitBtn.innerHTML = origBtnText; }
              if (msgBox) {
                msgBox.style.display = "block";
                msgBox.style.padding = ".75rem 1rem";
                msgBox.style.marginBottom = "1rem";
                msgBox.style.borderRadius = "6px";
                msgBox.style.background = "oklch(0.96 0.05 25)";
                msgBox.style.color = "oklch(0.4 0.18 25)";
                msgBox.style.border = "1px solid oklch(0.88 0.1 25)";
                msgBox.style.fontSize = ".875rem";
                msgBox.innerHTML = "⚠️ " + (data.error || "评论提交失败，请稍后重试。");
              }
            }
          } catch (err) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = "1"; submitBtn.innerHTML = origBtnText; }
            if (msgBox) {
              msgBox.style.display = "block";
              msgBox.style.padding = ".75rem 1rem";
              msgBox.style.marginBottom = "1rem";
              msgBox.style.borderRadius = "6px";
              msgBox.style.background = "oklch(0.96 0.05 25)";
              msgBox.style.color = "oklch(0.4 0.18 25)";
              msgBox.style.border = "1px solid oklch(0.88 0.1 25)";
              msgBox.style.fontSize = ".875rem";
              msgBox.innerHTML = "⚠️ 网络异常：" + err.message;
            }
          }
        });
      })();
      </script>
    </section>
  `;
}

