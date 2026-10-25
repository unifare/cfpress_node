/**
 * Screen: Members — front-end registered member management for the current site.
 *
 * Provides site-isolated member viewing, creating new members, editing member info,
 * changing passwords, status toggling (active, banned, suspended), search, and deletion.
 */
import { api, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { closestEl, closestBtn, fieldAt, evtField, alertDialog, confirmDialog, emptyRow, esc, fmtDate, toast, openDialog } from "../../ui.js";

let statusFilter = "";
let memberSearchQuery = "";
let memberPage = 1;

export default async function members(c) {
  const siteId = state.site || "default";

  const params = new URLSearchParams();
  if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
  if (memberSearchQuery.trim()) params.set("q", memberSearchQuery.trim());
  params.set("page", String(memberPage));
  params.set("limit", "20");

  let data = { items: [], total: 0, page: 1, limit: 20 };
  try {
    data = await api(`members?${params.toString()}`);
  } catch (err) {
    data = { items: [], total: 0, page: 1, limit: 20 };
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const rowsHtml =
    items.length === 0
      ? emptyRow(8, t("core.members.empty", "No members found."))
      : items
          .map((m) => {
            const isBanned = m.status === "banned";
            const statusKind = m.status === "active" ? "success" : isBanned ? "danger" : "warning";
            const statusLabel =
              m.status === "active"
                ? t("core.members.statusActive", "Active")
                : isBanned
                ? t("core.members.statusBanned", "Banned")
                : t("core.members.statusSuspended", "Suspended");

            return `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:.6rem">
                    <span class="team-logo" style="width:2rem;height:2rem;flex-shrink:0;background:var(--muted);color:var(--muted-foreground);font-weight:600">
                      ${esc(String(m.username || "M").slice(0, 2).toUpperCase())}
                    </span>
                    <div>
                      <div style="font-weight:600">${esc(m.username)}</div>
                      <div class="muted text-xs">ID: ${esc(m.id)}</div>
                    </div>
                  </div>
                </td>
                <td>${esc(m.display_name || "—")}</td>
                <td><span class="muted text-sm">${esc(m.email || "—")}</span></td>
                <td><span class="badge ${statusKind}">${esc(statusLabel)}</span></td>
                <td>
                  <span class="badge outline" title="${esc(t("core.members.commentsCount", "Comments"))}">
                    ${icon("message-square", 'style="width:12px;height:12px;vertical-align:middle;margin-right:3px"')}
                    ${m.comments_count ?? 0}
                  </span>
                </td>
                <td>
                  <span class="badge outline" title="${esc(t("core.members.postsCount", "Posts"))}">
                    ${icon("file-text", 'style="width:12px;height:12px;vertical-align:middle;margin-right:3px"')}
                    ${m.posts_count ?? 0}
                  </span>
                </td>
                <td class="muted text-xs">${esc(fmtDate(m.created_at))}</td>
                <td class="actions">
                  <div style="display:flex;gap:.3rem;justify-content:flex-end">
                    <button class="btn ghost sm text-xs" data-member-edit="${esc(m.id)}" data-member-name="${esc(m.username)}" data-member-display="${esc(m.display_name || "")}" data-member-email="${esc(m.email || "")}" data-member-status="${esc(m.status)}">
                      ${icon("pencil")}${esc(t("core.action.edit", "Edit"))}
                    </button>
                    <button class="btn ghost sm text-xs" data-member-password="${esc(m.id)}" data-member-name="${esc(m.username)}">
                      ${icon("key-round")}${esc(t("core.members.resetPassword", "Password"))}
                    </button>
                    ${
                      isBanned
                        ? `
                      <button class="btn ghost sm text-success text-xs" data-member-unban="${esc(m.id)}" data-member-name="${esc(m.username)}">
                        ${icon("check")}${esc(t("core.members.unban", "Unban"))}
                      </button>
                    `
                        : `
                      <button class="btn ghost sm text-warning text-xs" data-member-ban="${esc(m.id)}" data-member-name="${esc(m.username)}">
                        ${icon("x")}${esc(t("core.members.ban", "Ban"))}
                      </button>
                    `
                    }
                    <button class="btn ghost sm text-danger text-xs" data-member-delete="${esc(m.id)}" data-member-name="${esc(m.username)}">
                      ${icon("trash")}${esc(t("core.action.delete", "Delete"))}
                    </button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("");

  const paginationHtml =
    totalPages > 1
      ? `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1rem;padding-top:.5rem;border-top:1px solid var(--border)">
      <div class="muted text-sm">
        ${total} ${esc(t("core.members.title", "Members"))}
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <button class="btn outline sm" data-member-page="${memberPage - 1}" ${memberPage <= 1 ? "disabled" : ""}>
          ${icon("chevron-left")}
        </button>
        <span class="text-sm font-medium">${memberPage} / ${totalPages}</span>
        <button class="btn outline sm" data-member-page="${memberPage + 1}" ${memberPage >= totalPages ? "disabled" : ""}>
          ${icon("chevron-right")}
        </button>
      </div>
    </div>
  `
      : "";

  c.innerHTML = `
    ${pageHead({
      title: t("core.members.title", "Site Members"),
      sub: t("core.members.desc", "Front-end registered members for this site."),
      actions: `<button class="btn primary sm" data-action="new-member">${icon("plus")}${esc(t("core.members.newMember", "New Member"))}</button>`,
    })}

    <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:1rem;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:.5rem">
        <select class="input sm" id="memberStatusSelect" style="width:auto">
          <option value="" ${statusFilter === "" ? "selected" : ""}>${esc(t("core.members.statusAll", "All Statuses"))}</option>
          <option value="active" ${statusFilter === "active" ? "selected" : ""}>${esc(t("core.members.statusActive", "Active"))}</option>
          <option value="banned" ${statusFilter === "banned" ? "selected" : ""}>${esc(t("core.members.statusBanned", "Banned"))}</option>
          <option value="suspended" ${statusFilter === "suspended" ? "selected" : ""}>${esc(t("core.members.statusSuspended", "Suspended"))}</option>
        </select>
      </div>

      <div style="display:flex;align-items:center;gap:.5rem">
        <input
          type="search"
          class="input sm"
          id="memberSearchInput"
          placeholder="${esc(t("core.members.searchPlaceholder", "Search username, email or display name..."))}"
          value="${esc(memberSearchQuery)}"
          style="width:260px"
        />
        <button class="btn outline sm" id="memberSearchBtn">
          ${icon("search")}${esc(t("core.action.search", "Search"))}
        </button>
      </div>
    </div>

    <div class="table-wrap"><table class="table">
        <thead>
          <tr>
            <th>${esc(t("core.members.username", "Username"))}</th>
            <th>${esc(t("core.members.displayName", "Display Name"))}</th>
            <th>${esc(t("core.members.email", "Email"))}</th>
            <th>${esc(t("core.members.status", "Status"))}</th>
            <th>${esc(t("core.members.commentsCount", "Comments"))}</th>
            <th>${esc(t("core.members.postsCount", "Posts"))}</th>
            <th>${esc(t("core.members.registered", "Registered"))}</th>
            <th style="text-align:right">${esc(t("core.action.actions", "Actions"))}</th>
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

// Global click event handlers for members screen
document.addEventListener("click", async (e) => {
  // Page switch
  const pageBtn = closestBtn(e, "[data-member-page]");
  if (pageBtn && !pageBtn.disabled) {
    const p = Number(pageBtn.dataset.memberPage);
    if (p >= 1) {
      memberPage = p;
      render();
    }
    return;
  }

  // Search button
  const searchBtn = closestEl(e, "#memberSearchBtn");
  if (searchBtn) {
    const input = fieldAt("#memberSearchInput");
    memberSearchQuery = input ? input.value : "";
    memberPage = 1;
    render();
    return;
  }

  // Create new member dialog
  const newBtn = closestEl(e, '[data-action="new-member"]');
  if (newBtn) {
    const v = await openDialog({
      title: t("core.members.createTitle", "Create Front-end Member"),
      description: t("core.members.createDesc", "Create a new front-end member account for this site."),
      confirmLabel: t("core.action.create", "Create"),
      fields: [
        { name: "username", label: t("core.members.username", "Username"), required: true, hint: "3-32 characters" },
        { name: "password", label: t("core.users.fieldPassword", "Password"), type: "password", required: true, hint: t("core.users.passwordHint", "At least 8 characters") },
        { name: "display_name", label: t("core.members.displayName", "Display Name") },
        { name: "email", label: t("core.members.email", "Email"), type: "email" },
        {
          name: "status",
          label: t("core.members.status", "Status"),
          type: "select",
          value: "active",
          options: [
            { value: "active", label: t("core.members.statusActive", "Active") },
            { value: "banned", label: t("core.members.statusBanned", "Banned") },
            { value: "suspended", label: t("core.members.statusSuspended", "Suspended") },
          ],
        },
      ],
    });
    if (!v) return;
    if (String(v.password || "").length < 8) {
      await alertDialog({ title: t("core.users.tooShort", "Password too short"), description: t("core.users.tooShortDesc", "Use at least 8 characters.") });
      return;
    }
    try {
      await api("members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      toast(t("core.members.created", "Member created successfully."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.members.createFailed", "Failed to create member."), description: err.message });
    }
    return;
  }

  // Edit member dialog
  const editBtn = closestEl(e, "[data-member-edit]");
  if (editBtn) {
    const id = editBtn.dataset.memberEdit;
    const username = editBtn.dataset.memberName || "member";
    const currentDisplay = editBtn.dataset.memberDisplay || "";
    const currentEmail = editBtn.dataset.memberEmail || "";
    const currentStatus = editBtn.dataset.memberStatus || "active";

    const v = await openDialog({
      title: t("core.members.editTitle", "Edit Member {username}", { username }),
      description: t("core.members.editDesc", "Update profile and account status for this member."),
      confirmLabel: t("core.action.save", "Save"),
      fields: [
        { name: "display_name", label: t("core.members.displayName", "Display Name"), value: currentDisplay },
        { name: "email", label: t("core.members.email", "Email"), type: "email", value: currentEmail },
        {
          name: "status",
          label: t("core.members.status", "Status"),
          type: "select",
          value: currentStatus,
          options: [
            { value: "active", label: t("core.members.statusActive", "Active") },
            { value: "banned", label: t("core.members.statusBanned", "Banned") },
            { value: "suspended", label: t("core.members.statusSuspended", "Suspended") },
          ],
        },
      ],
    });
    if (!v) return;

    try {
      await api(`members/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      toast(t("core.members.statusUpdated", "Member status updated."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Change password dialog
  const passBtn = closestEl(e, "[data-member-password]");
  if (passBtn) {
    const id = passBtn.dataset.memberPassword;
    const username = passBtn.dataset.memberName || "member";

    const v = await openDialog({
      title: t("core.members.passwordTitle", "Change Password for {username}", { username }),
      description: t("core.members.passwordDesc", "Set a new login password for this member."),
      confirmLabel: t("core.action.save", "Save"),
      fields: [
        {
          name: "password",
          label: t("core.users.fieldPassword", "Password"),
          type: "password",
          required: true,
          hint: t("core.users.passwordHint", "At least 8 characters"),
        },
      ],
    });
    if (!v || !v.password) return;
    if (String(v.password).length < 8) {
      await alertDialog({ title: t("core.users.tooShort", "Password too short"), description: t("core.users.tooShortDesc", "Use at least 8 characters.") });
      return;
    }

    try {
      await api(`members/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: v.password }),
      });
      toast(t("core.members.passwordUpdated", "Password updated successfully."));
    } catch (err) {
      await alertDialog({ title: t("core.members.passwordFailed", "Failed to update password."), description: err.message });
    }
    return;
  }

  // Ban member
  const banBtn = closestEl(e, "[data-member-ban]");
  if (banBtn) {
    const id = banBtn.dataset.memberBan;
    const name = banBtn.dataset.memberName || "member";
    const ok = await confirmDialog({
      title: t("core.members.ban", "Ban Member"),
      description: t("core.members.banConfirm", 'Are you sure you want to ban member "{username}"? They will be unable to log in or post.', { username: name }),
      confirmLabel: t("core.members.ban", "Ban Member"),
      danger: true,
    });
    if (!ok) return;

    try {
      await api(`members/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "banned" }),
      });
      toast(t("core.members.statusUpdated", "Member status updated."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Unban member
  const unbanBtn = closestEl(e, "[data-member-unban]");
  if (unbanBtn) {
    const id = unbanBtn.dataset.memberUnban;
    const name = unbanBtn.dataset.memberName || "member";
    const ok = await confirmDialog({
      title: t("core.members.unban", "Unban Member"),
      description: t("core.members.unbanConfirm", 'Are you sure you want to unban member "{username}"?', { username: name }),
      confirmLabel: t("core.members.unban", "Unban Member"),
    });
    if (!ok) return;

    try {
      await api(`members/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      toast(t("core.members.statusUpdated", "Member status updated."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }

  // Delete member
  const deleteBtn = closestEl(e, "[data-member-delete]");
  if (deleteBtn) {
    const id = deleteBtn.dataset.memberDelete;
    const name = deleteBtn.dataset.memberName || "member";
    const ok = await confirmDialog({
      title: t("core.action.delete", "Delete"),
      description: t("core.members.deleteConfirm", 'Are you sure you want to delete member "{username}"? Their sessions will be invalidated immediately.', { username: name }),
      confirmLabel: t("core.action.delete", "Delete"),
      danger: true,
    });
    if (!ok) return;

    try {
      await api(`members/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast(t("core.members.deleted", "Member deleted."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.action.error", "Error"), description: err.message });
    }
    return;
  }
});

// Status dropdown change handler
document.addEventListener("change", (e) => {
  if (e.target && evtField(e).id === "memberStatusSelect") {
    statusFilter = evtField(e).value;
    memberPage = 1;
    render();
  }
});

// Member search input Enter key handler
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && evtField(e).id === "memberSearchInput") {
    e.preventDefault();
    memberSearchQuery = evtField(e).value;
    memberPage = 1;
    render();
  }
});
