/**
 * Screen: Comments — core built-in comment moderation and management.
 *
 * Supports status tabs (all, pending, approved, spam, trash), inline approval/rejection,
 * admin replies, batch operations, search, and site scoping.
 */
import { api, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { closestEl, closestBtn, closestField, fieldAt, btnAt, fieldsAll, evtField, alertDialog, confirmDialog, emptyRow, esc, fmtDate, toast, openDialog } from "../../ui.js";

let activeStatus = "all";
let searchQuery = "";
let currentPage = 1;
const selectedCommentIds = new Set();

export default async function comments(c) {
  const siteId = state.site || "default";

  // Build query
  const params = new URLSearchParams();
  if (activeStatus && activeStatus !== "all") params.set("status", activeStatus);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  params.set("page", String(currentPage));
  params.set("limit", "20");

  let data = { items: [], total: 0, counts: { all: 0, pending: 0, approved: 0, spam: 0, trash: 0 }, page: 1, limit: 20 };
  try {
    data = await api(`comments?${params.toString()}`);
  } catch (err) {
    data = { items: [], total: 0, counts: { all: 0, pending: 0, approved: 0, spam: 0, trash: 0 }, page: 1, limit: 20 };
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  const counts = data?.counts || { all: 0, pending: 0, approved: 0, spam: 0, trash: 0 };
  const total = Number(data?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / 20));

  // Prune deleted IDs from selection
  const currentItemIds = new Set(items.map((x) => String(x.id)));
  for (const id of selectedCommentIds) {
    if (!currentItemIds.has(id)) selectedCommentIds.delete(id);
  }

  const tabs = [
    { key: "all", label: t("core.comments.all", "All"), count: counts.all ?? 0 },
    { key: "pending", label: t("core.comments.pending", "Pending"), count: counts.pending ?? 0, badge: counts.pending > 0 },
    { key: "approved", label: t("core.comments.approved", "Approved"), count: counts.approved ?? 0 },
    { key: "spam", label: t("core.comments.spam", "Spam"), count: counts.spam ?? 0 },
    { key: "trash", label: t("core.comments.trash", "Trash"), count: counts.trash ?? 0 },
  ];

  const tabHtml = `
    <div style="display:flex;gap:.5rem;margin-bottom:1rem;border-bottom:1px solid var(--border);padding-bottom:.5rem;flex-wrap:wrap">
      ${tabs
        .map(
          (tb) => `
        <button class="btn sm ${activeStatus === tb.key ? "primary" : "ghost"}" data-comment-tab="${tb.key}" style="display:inline-flex;align-items:center;gap:.4rem">
          <span>${esc(tb.label)}</span>
          <span class="badge ${tb.badge ? "danger" : activeStatus === tb.key ? "secondary" : "outline"}" style="font-size:0.75rem;padding:0.1rem 0.4rem">
            ${tb.count}
          </span>
        </button>
      `
        )
        .join("")}
    </div>
  `;

  // Bulk actions dropdown
  const bulkOptions =
    activeStatus === "trash"
      ? `
      <option value="">${esc(t("core.bulk.actionPlaceholder", "Bulk Actions"))}</option>
      <option value="restore">${esc(t("core.comments.restore", "Restore"))}</option>
      <option value="delete">${esc(t("core.comments.deletePermanently", "Delete Permanently"))}</option>
    `
      : `
      <option value="">${esc(t("core.bulk.actionPlaceholder", "Bulk Actions"))}</option>
      <option value="approve">${esc(t("core.comments.approve", "Approve"))}</option>
      <option value="unapprove">${esc(t("core.comments.unapprove", "Unapprove"))}</option>
      <option value="spam">${esc(t("core.comments.markSpam", "Spam"))}</option>
      <option value="trash">${esc(t("core.comments.moveToTrash", "Trash"))}</option>
    `;

  const isAllSelected = items.length > 0 && items.every((x) => selectedCommentIds.has(String(x.id)));

  const rowsHtml =
    items.length === 0
      ? emptyRow(6, t("core.comments.empty", "No comments found."))
      : items
          .map((x) => {
            const isChecked = selectedCommentIds.has(String(x.id));
            const isMember = Boolean(x.author_member_id);
            const statusKind =
              x.status === "approved"
                ? "success"
                : x.status === "pending"
                ? "warning"
                : x.status === "spam"
                ? "secondary"
                : "danger";

            const statusLabel =
              x.status === "approved"
                ? t("core.comments.approved", "Approved")
                : x.status === "pending"
                ? t("core.comments.pending", "Pending")
                : x.status === "spam"
                ? t("core.comments.spam", "Spam")
                : t("core.comments.trash", "Trash");

            // Row action buttons
            let actionButtons = "";
            if (activeStatus === "trash" || x.status === "trash") {
              actionButtons = `
                <button class="btn ghost sm text-xs" data-comment-restore="${esc(x.id)}" title="${esc(t("core.comments.restore", "Restore"))}">
                  ${esc(t("core.comments.restore", "Restore"))}
                </button>
                <button class="btn ghost sm text-xs text-danger" data-comment-delete="${esc(x.id)}" title="${esc(t("core.comments.deletePermanently", "Delete Permanently"))}">
                  ${esc(t("core.comments.deletePermanently", "Delete Permanently"))}
                </button>
              `;
            } else {
              if (x.status === "pending") {
                actionButtons += `
                  <button class="btn ghost sm text-xs text-success" data-comment-status="${esc(x.id)}" data-target-status="approved">
                    ${esc(t("core.comments.approve", "Approve"))}
                  </button>
                `;
              } else if (x.status === "approved") {
                actionButtons += `
                  <button class="btn ghost sm text-xs" data-comment-status="${esc(x.id)}" data-target-status="pending">
                    ${esc(t("core.comments.unapprove", "Unapprove"))}
                  </button>
                `;
              }

              if (x.status !== "spam") {
                actionButtons += `
                  <button class="btn ghost sm text-xs" data-comment-reply="${esc(x.id)}" data-author="${esc(x.author_name || "Guest")}">
                    ${esc(t("core.comments.reply", "Reply"))}
                  </button>
                  <button class="btn ghost sm text-xs text-warning" data-comment-status="${esc(x.id)}" data-target-status="spam">
                    ${esc(t("core.comments.markSpam", "Spam"))}
                  </button>
                `;
              } else {
                actionButtons += `
                  <button class="btn ghost sm text-xs text-success" data-comment-status="${esc(x.id)}" data-target-status="approved">
                    ${esc(t("core.comments.notSpam", "Not Spam"))}
                  </button>
                `;
              }

              actionButtons += `
                <button class="btn ghost sm text-xs text-danger" data-comment-status="${esc(x.id)}" data-target-status="trash">
                  ${esc(t("core.comments.moveToTrash", "Trash"))}
                </button>
              `;
            }

            return `
              <tr style="${x.status === "pending" ? "background:var(--accent-subtle, rgba(234, 179, 8, 0.05));" : ""}">
                <td style="width:36px;vertical-align:top;padding-top:1rem">
                  <input type="checkbox" class="comment-select-cb" data-comment-id="${esc(x.id)}" ${isChecked ? "checked" : ""} />
                </td>
                <td style="width:220px;vertical-align:top;padding-top:1rem">
                  <div style="display:flex;align-items:flex-start;gap:.6rem">
                    <span class="team-logo" style="width:2rem;height:2rem;flex-shrink:0;background:var(--muted);color:var(--muted-foreground);font-weight:600">
                      ${esc(String(x.author_name || "G").slice(0, 2).toUpperCase())}
                    </span>
                    <div style="line-height:1.3">
                      <div style="font-weight:600;display:flex;align-items:center;gap:.3rem">
                        <span>${esc(x.author_name || t("core.comments.guest", "Guest"))}</span>
                        ${isMember ? `<span class="badge primary" style="font-size:0.65rem;padding:0 0.3rem">${esc(t("core.comments.member", "Member"))}</span>` : ""}
                      </div>
                      ${x.author_email ? `<div class="muted text-xs">${esc(x.author_email)}</div>` : ""}
                      ${x.author_url ? `<div class="text-xs"><a href="${esc(x.author_url)}" target="_blank" rel="noopener" class="muted" style="text-decoration:underline">${esc(x.author_url)}</a></div>` : ""}
                      ${x.ip_hash ? `<div class="muted text-xs" style="font-family:monospace;font-size:0.7rem">IP: ${esc(x.ip_hash.slice(0, 8))}</div>` : ""}
                    </div>
                  </div>
                </td>
                <td style="vertical-align:top;padding-top:1rem">
                  ${x.parent_id ? `<div class="muted text-xs" style="margin-bottom:.3rem">${icon("message-square", 'style="width:12px;height:12px;vertical-align:middle"')} ${esc(t("core.comments.inReplyTo", "In reply to comment #{id}", { id: x.parent_id }))}</div>` : ""}
                  <div style="white-space:pre-wrap;word-break:break-word;line-height:1.5;font-size:0.9rem">${esc(x.content)}</div>
                  <div style="margin-top:.5rem;display:flex;gap:.4rem;flex-wrap:wrap">
                    ${actionButtons}
                  </div>
                </td>
                <td style="width:180px;vertical-align:top;padding-top:1rem">
                  <div style="font-weight:500;line-height:1.3">
                    <a href="#/posts?edit=${esc(x.post_id)}" style="color:var(--primary);text-decoration:none">
                      ${esc(x.post_title || x.post_slug || x.post_id)}
                    </a>
                  </div>
                </td>
                <td style="width:90px;vertical-align:top;padding-top:1rem">
                  <span class="badge ${statusKind}">${esc(statusLabel)}</span>
                </td>
                <td style="width:130px;vertical-align:top;padding-top:1rem" class="muted text-xs">
                  ${esc(fmtDate(x.created_at))}
                </td>
              </tr>
            `;
          })
          .join("");

  // Pagination HTML
  const paginationHtml =
    totalPages > 1
      ? `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1rem;padding-top:.5rem;border-top:1px solid var(--border)">
      <div class="muted text-sm">
        ${esc(t("core.bulk.selectedCount", "{n} selected", { n: selectedCommentIds.size }))} · ${total} ${esc(t("core.comments.title", "Comments"))}
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <button class="btn outline sm" data-comment-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>
          ${icon("chevron-left")}
        </button>
        <span class="text-sm font-medium">${currentPage} / ${totalPages}</span>
        <button class="btn outline sm" data-comment-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}>
          ${icon("chevron-right")}
        </button>
      </div>
    </div>
  `
      : "";

  c.innerHTML = `
    ${pageHead({ title: t("core.comments.title", "Comments") })}

    ${tabHtml}

    <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:1rem;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:.5rem">
        <select class="input sm" id="commentBulkAction" style="width:auto">
          ${bulkOptions}
        </select>
        <button class="btn outline sm" id="commentApplyBulk" ${selectedCommentIds.size === 0 ? "disabled" : ""}>
          ${esc(t("core.bulk.apply", "Apply"))}
        </button>
        <span id="commentBulkBadge" class="badge outline text-xs" style="display:${selectedCommentIds.size > 0 ? "inline-flex" : "none"}">
          ${esc(t("core.bulk.selectedCount", "{n} selected", { n: selectedCommentIds.size }))}
        </span>
      </div>

      <div style="display:flex;align-items:center;gap:.5rem">
        <input
          type="search"
          class="input sm"
          id="commentSearchInput"
          placeholder="${esc(t("core.comments.searchPlaceholder", "Search author, email or content..."))}"
          value="${esc(searchQuery)}"
          style="width:240px"
        />
        <button class="btn outline sm" id="commentSearchBtn">
          ${icon("search")}${esc(t("core.action.search", "Search"))}
        </button>
      </div>
    </div>

    <div class="table-wrap"><table class="table">
        <thead>
          <tr>
            <th style="width:36px">
              <input type="checkbox" id="commentSelectAll" ${isAllSelected ? "checked" : ""} />
            </th>
            <th style="width:220px">${esc(t("core.comments.author", "Author"))}</th>
            <th>${esc(t("core.comments.comment", "Comment"))}</th>
            <th style="width:180px">${esc(t("core.comments.inResponseTo", "In Response To"))}</th>
            <th style="width:90px">${esc(t("core.comments.status", "Status"))}</th>
            <th style="width:130px">${esc(t("core.comments.submittedOn", "Submitted On"))}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    ${paginationHtml}
  `;
}

// Global click event handlers for comments screen
document.addEventListener("click", async (e) => {
  // Tab switch
  const tabBtn = closestEl(e, "[data-comment-tab]");
  if (tabBtn) {
    activeStatus = tabBtn.dataset.commentTab;
    currentPage = 1;
    selectedCommentIds.clear();
    render();
    return;
  }

  // Page switch
  const pageBtn = closestBtn(e, "[data-comment-page]");
  if (pageBtn && !pageBtn.disabled) {
    const p = Number(pageBtn.dataset.commentPage);
    if (p >= 1) {
      currentPage = p;
      render();
    }
    return;
  }

  // Search button
  const searchBtn = closestEl(e, "#commentSearchBtn");
  if (searchBtn) {
    const input = fieldAt("#commentSearchInput");
    searchQuery = input ? input.value : "";
    currentPage = 1;
    render();
    return;
  }

  // Single status change (Approve, Unapprove, Spam, Trash, etc.)
  const statusBtn = closestEl(e, "[data-comment-status]");
  if (statusBtn) {
    const id = statusBtn.dataset.commentStatus;
    const targetStatus = statusBtn.dataset.targetStatus;
    try {
      await api(`comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      toast(t("core.comments.statusUpdated", "Comment status updated."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Restore from trash
  const restoreBtn = closestEl(e, "[data-comment-restore]");
  if (restoreBtn) {
    const id = restoreBtn.dataset.commentRestore;
    try {
      await api(`comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      toast(t("core.comments.statusUpdated", "Comment status updated."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Permanently delete single comment
  const deleteBtn = closestEl(e, "[data-comment-delete]");
  if (deleteBtn) {
    const id = deleteBtn.dataset.commentDelete;
    const ok = await confirmDialog({
      title: t("core.action.delete", "Delete"),
      description: t("core.comments.deleteConfirm", "Are you sure you want to permanently delete this comment? Its replies will also be deleted."),
      confirmLabel: t("core.action.delete", "Delete"),
      danger: true,
    });
    if (!ok) return;

    try {
      await api(`comments/${encodeURIComponent(id)}`, { method: "DELETE" });
      selectedCommentIds.delete(id);
      toast(t("core.comments.deleted", "Comment deleted."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Admin reply dialog
  const replyBtn = closestEl(e, "[data-comment-reply]");
  if (replyBtn) {
    const id = replyBtn.dataset.commentReply;
    const author = replyBtn.dataset.author || "";
    const v = await openDialog({
      title: t("core.comments.replyTo", "Reply to {author}", { author }),
      description: t("core.comments.replyDesc", "Submit an official admin reply. It will be published immediately."),
      confirmLabel: t("core.comments.sendReply", "Send Reply"),
      fields: [
        {
          name: "content",
          label: t("core.comments.replyContent", "Reply Content"),
          type: "textarea",
          required: true,
          placeholder: t("core.comments.replyPlaceholder", "Write your reply here..."),
        },
      ],
    });
    if (!v || !String(v.content || "").trim()) return;

    try {
      await api("comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: id, content: String(v.content).trim() }),
      });
      toast(t("core.comments.replySuccess", "Reply sent successfully."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.comments.replyFailed", "Failed to send reply."), description: err.message });
    }
    return;
  }

  // Bulk Apply
  const applyBtn = closestBtn(e, "#commentApplyBulk");
  if (applyBtn && !applyBtn.disabled) {
    const sel = fieldAt("#commentBulkAction");
    const action = sel ? sel.value : "";
    if (!action) return;

    const ids = Array.from(selectedCommentIds);
    if (!ids.length) return;

    if (action === "delete") {
      const ok = await confirmDialog({
        title: t("core.action.delete", "Delete"),
        description: t("core.comments.batchDeleteConfirm", "Are you sure you want to permanently delete {n} selected comments? Their replies will also be deleted.", { n: ids.length }),
        confirmLabel: t("core.action.delete", "Delete"),
        danger: true,
      });
      if (!ok) return;
    }

    try {
      await api("comments/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      selectedCommentIds.clear();
      toast(t("core.comments.batchSuccess", "Batch operation completed."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Select all checkbox
  const selectAllCb = closestField(e, "#commentSelectAll");
  if (selectAllCb) {
    const isChecked = selectAllCb.checked;
    const cbs = fieldsAll(".comment-select-cb");
    cbs.forEach((cb) => {
      cb.checked = isChecked;
      const id = cb.dataset.commentId;
      if (id) {
        if (isChecked) selectedCommentIds.add(id);
        else selectedCommentIds.delete(id);
      }
    });
    const apply = btnAt("#commentApplyBulk");
    if (apply) apply.disabled = selectedCommentIds.size === 0;
    const badge = document.getElementById("commentBulkBadge");
    if (badge) {
      badge.style.display = selectedCommentIds.size > 0 ? "inline-flex" : "none";
      badge.textContent = t("core.bulk.selectedCount", "{n} selected", { n: selectedCommentIds.size });
    }
    return;
  }

  // Single row checkbox
  const singleCb = closestField(e, ".comment-select-cb");
  if (singleCb) {
    const id = singleCb.dataset.commentId;
    if (id) {
      if (singleCb.checked) selectedCommentIds.add(id);
      else selectedCommentIds.delete(id);
    }
    const apply = btnAt("#commentApplyBulk");
    if (apply) apply.disabled = selectedCommentIds.size === 0;
    const badge = document.getElementById("commentBulkBadge");
    if (badge) {
      badge.style.display = selectedCommentIds.size > 0 ? "inline-flex" : "none";
      badge.textContent = t("core.bulk.selectedCount", "{n} selected", { n: selectedCommentIds.size });
    }
    const allCb = fieldAt("#commentSelectAll");
    const allCbs = fieldsAll(".comment-select-cb");
    if (allCb && allCbs.length) {
      allCb.checked = allCbs.every((c) => c.checked);
      allCb.indeterminate = !allCb.checked && allCbs.some((c) => c.checked);
    }
  }
});

// Search input Enter key handler
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && evtField(e).id === "commentSearchInput") {
    e.preventDefault();
    searchQuery = evtField(e).value;
    currentPage = 1;
    render();
  }
});
