/**
 * Screen: content list — platform content (posts, pages) and theme-declared
 * custom post types. Delegates to the editor when `state.editing` is set.
 *
 * Supports batch operations (delete, change status to published/draft, set category),
 * select-all with indeterminate state, per-row deletion, and category/locale filtering.
 */
import { api, contentPath, postTypeInfo, scoped, siteOrigin, state } from "../state.js";
import { go, pageHead } from "../shell.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { fieldsAll, closestBtn, closestField, fieldAt, elAt, closestEl, attr, confirmDialog, emptyRow, esc, fmtDate, statusBadge, toast } from "../../ui.js";
import { editor } from "./editor.js";
import { buildTermTree } from "./tags.js";

/** The active language and category filters. Kept at module level. */
let localeFilter = "";
let categoryFilter = "";

/** Selected item IDs across the current list. */
const selectedIds = new Set();

function updateBulkControls() {
  const allCb = fieldAt("#bulkSelectAll");
  const cbs = fieldsAll(".content-select-cb");
  if (allCb && cbs.length > 0) {
    const checkedCount = cbs.filter((c) => c.checked).length;
    allCb.checked = checkedCount === cbs.length && cbs.length > 0;
    allCb.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
  }
  const badge = elAt("#bulkSelectedBadge");
  if (badge) {
    badge.style.display = selectedIds.size > 0 ? "inline-flex" : "none";
    badge.textContent = t("core.bulk.selectedCount", "{n} selected", { n: selectedIds.size });
  }
  const applyBtn = fieldAt("#bulkApplyBtn");
  const actSel = fieldAt("#bulkActionSelect");
  if (applyBtn) {
    applyBtn.disabled = selectedIds.size === 0 || !actSel || !actSel.value;
  }
}

export async function contentList(c, type) {
  const pt = postTypeInfo(type);
  if (state.editing) return editor(c, type);

  // Fetch categories for tree filter and bulk category actions
  const catRes = await api(scoped("taxonomies/category/terms")).catch(() => ({ items: [] }));
  const catItems = Array.isArray(catRes.items) ? catRes.items : [];
  const catTree = buildTermTree(catItems);

  if (localeFilter && state.locales?.length && !state.locales.includes(localeFilter)) {
    localeFilter = "";
  }

  const queryParts = [];
  if (localeFilter) queryParts.push("locale=" + encodeURIComponent(localeFilter));
  if (categoryFilter) queryParts.push("category=" + encodeURIComponent(categoryFilter));
  const query = queryParts.length ? "?" + queryParts.join("&") : "";

  const d = await api(scoped(contentPath(type) + query));
  const items = d.items || [];

  // Prune any selection IDs that no longer exist in the fetched items
  const itemIds = new Set(items.map((i) => i.id));
  for (const id of selectedIds) {
    if (!itemIds.has(id)) selectedIds.delete(id);
  }

  // The filter lists the languages the site serves. `""` is the default —
  // the same rows the server shows when no filter is given.
  const filterOptions = ["", ...((state.locales || []).filter((l) => l !== ""))]
    .map((l) => `<option value="${attr(l)}"${l === localeFilter ? " selected" : ""}>${
      l ? esc(l) : esc(t("core.content.localeDefault", "Default language ({locale})", { locale: state.defaultLocale }))
    }</option>`)
    .join("");

  const catOptions = catTree.map((cat) => {
    const prefix = "　".repeat(cat.depth) + (cat.depth > 0 ? "— " : "");
    return `<option value="${attr(cat.id)}"${cat.id === categoryFilter ? " selected" : ""}>${prefix}${esc(cat.name)}</option>`;
  }).join("");

  const isAllChecked = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const rows = items.map((x) => {
    const versions = Array.isArray(x.locales) && x.locales.length ? x.locales : [x.locale].filter(Boolean);
    const localeCell = versions.length
      ? versions.map((l) => `<span class="badge ${l === x.locale ? "primary" : "outline"}">${esc(l)}</span>`).join(" ")
      : `<span class="badge outline">—</span>`;

    const cats = Array.isArray(x.categories) && x.categories.length ? x.categories : [];
    const catCell = cats.length
      ? cats.map((c) => `<span class="badge outline">${esc(c.name || c.slug)}</span>`).join(" ")
      : `<span class="badge outline muted" style="opacity:.6">—</span>`;

    const displayUrl = x.url || (x.slug ? `/${x.slug}` : "/");
    const origin = siteOrigin(x.site_id || state.site);
    const targetUrl = origin ? `${origin}${displayUrl.startsWith("/") ? displayUrl : "/" + displayUrl}` : displayUrl;
    const isChecked = selectedIds.has(x.id);

    return `<tr>
      <td style="width:38px;text-align:center">
        <input type="checkbox" class="content-select-cb" value="${attr(x.id)}"${isChecked ? " checked" : ""}>
      </td>
      <td>
        <div style="font-weight:500">${esc(x.title || t("core.content.untitled", "(untitled)"))}</div>
        <div class="muted text-sm">
          <a href="${attr(targetUrl)}" target="_blank" rel="noopener noreferrer" class="muted text-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:.25rem" title="${attr(t("core.content.view", "View"))}">
            ${esc(displayUrl)}
            ${icon("external", 'style="width:12px;height:12px;opacity:.7"')}
          </a>
        </div>
      </td>
      <td>${catCell}</td>
      <td>${localeCell}</td>
      <td>${statusBadge(x.status)}</td>
      <td class="muted text-sm">${esc(fmtDate(x.updated_at))}</td>
      <td class="actions" style="display:flex;gap:.5rem;align-items:center;justify-content:flex-end">
        <a class="btn outline sm" href="${attr(targetUrl)}" target="_blank" rel="noopener noreferrer" title="${attr(t("core.content.view", "View"))}">${icon("external")}${esc(t("core.content.view", "View"))}</a>
        <button class="btn outline sm" data-edit="${attr(type)}|${attr(x.id)}">${icon("pencil")}${esc(t("core.editor.edit", "Edit"))}</button>
        <button class="btn outline sm danger" data-del="${attr(type)}|${attr(x.id)}" title="${attr(t("core.action.delete", "Delete"))}">${icon("trash")}</button>
      </td>
    </tr>`;
  }).join("");

  c.innerHTML = `${pageHead({
    title: pt.plural,
    sub: t("core.content.countOn", "{n} on {site}", {
      n: items.length,
      site: state.sites.find((s) => s.id === state.site)?.name || state.site,
    }),
    actions: `<button class="btn primary" data-new="${attr(type)}">${icon("plus")}${esc(t("core.content.add", "Add {type}", { type: pt.singular }))}</button>`,
    crumbs: [{ label: t("core.nav.content", "Content") }, { label: pt.plural }],
  })}
  <div class="toolbar" style="margin-bottom:.75rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap">
    <div class="toolbar-bulk" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
      <select id="bulkActionSelect" class="input sm" style="width:auto">
        <option value="">${esc(t("core.bulk.actionPlaceholder", "Bulk Actions"))}</option>
        <option value="status:published">${esc(t("core.bulk.publish", "Set as Published"))}</option>
        <option value="status:draft">${esc(t("core.bulk.draft", "Set as Draft"))}</option>
        ${catTree.length > 0 && (type === "posts" || type === "post") ? `<option value="category">${esc(t("core.bulk.setCategory", "Set Category"))}</option>` : ""}
        <option value="delete">${esc(t("core.bulk.delete", "Delete"))}</option>
      </select>
      <select id="bulkCategorySelect" class="input sm" style="width:auto;display:none">
        <option value="">${esc(t("core.bulk.selectCategory", "Select Category..."))}</option>
        ${catOptions}
      </select>
      <button class="btn outline sm" id="bulkApplyBtn" data-content-type="${attr(type)}"${selectedIds.size === 0 ? " disabled" : ""}>${esc(t("core.bulk.apply", "Apply"))}</button>
      <span id="bulkSelectedBadge" class="badge outline" style="${selectedIds.size > 0 ? "display:inline-flex;" : "display:none;"}align-items:center;gap:.25rem">
        ${esc(t("core.bulk.selectedCount", "{n} selected", { n: selectedIds.size }))}
      </span>
    </div>
    <div class="toolbar-filters" style="display:flex;gap:1.25rem;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:.5rem;align-items:center">
        <label class="muted text-sm" for="contentCategory">${esc(t("core.content.category", "Category"))}</label>
        <select id="contentCategory">
          <option value="">${esc(t("core.content.allCategories", "All Categories"))}</option>
          ${catOptions}
        </select>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <label class="muted text-sm" for="contentLocale">${esc(t("core.content.locale", "Locale"))}</label>
        <select id="contentLocale">${filterOptions}</select>
      </div>
    </div>
  </div>
  <div class="table-wrap"><table class="table">
    <thead><tr>
      <th style="width:38px;text-align:center"><input type="checkbox" id="bulkSelectAll" title="${attr(t("core.bulk.selectAll", "Select All"))}"${isAllChecked ? " checked" : ""}></th>
      <th>${esc(t("core.content.title", "Title"))}</th>
      <th>${esc(t("core.content.categories", "Categories"))}</th>
      <th>${esc(t("core.content.locale", "Locale"))}</th>
      <th>${esc(t("core.content.status", "Status"))}</th>
      <th>${esc(t("core.content.updated", "Updated"))}</th>
      <th></th>
    </tr></thead>
    <tbody>${rows || emptyRow(7, t("core.content.noneYet", "No {type} yet.", { type: pt.plural.toLowerCase() }))}</tbody>
  </table></div>`;
}

document.addEventListener("change", (e) => {
  const allCb = closestField(e, "#bulkSelectAll");
  if (allCb) {
    const cbs = fieldsAll(".content-select-cb");
    for (const cb of cbs) {
      cb.checked = allCb.checked;
      if (allCb.checked) selectedIds.add(cb.value);
      else selectedIds.delete(cb.value);
    }
    updateBulkControls();
    return;
  }

  const itemCb = closestField(e, ".content-select-cb");
  if (itemCb) {
    if (itemCb.checked) selectedIds.add(itemCb.value);
    else selectedIds.delete(itemCb.value);
    updateBulkControls();
    return;
  }

  const actSel = closestField(e, "#bulkActionSelect");
  if (actSel) {
    const catSel = fieldAt("#bulkCategorySelect");
    if (catSel) {
      catSel.style.display = actSel.value === "category" ? "inline-block" : "none";
    }
    updateBulkControls();
    return;
  }

  const catSel = closestField(e, "#contentCategory");
  if (catSel && catSel.value !== categoryFilter) {
    categoryFilter = catSel.value;
    go(state.page);
    return;
  }

  const sel = closestField(e, "#contentLocale");
  if (!sel || sel.value === localeFilter) return;
  localeFilter = sel.value;
  go(state.page);
});

document.addEventListener("click", async (e) => {
  const applyBtn = closestBtn(e, "#bulkApplyBtn");
  if (applyBtn) {
    const type = applyBtn.dataset.contentType || "posts";
    const actSel = fieldAt("#bulkActionSelect");
    const action = actSel?.value || "";
    if (!action) {
      toast(t("core.bulk.noAction", "Please choose an action."), "warn");
      return;
    }

    // Synchronize with any checked checkboxes in the DOM
    const checkedDoms = fieldsAll(".content-select-cb:checked").map((el) => el.value);
    for (const cid of checkedDoms) selectedIds.add(cid);

    if (selectedIds.size === 0) {
      toast(t("core.bulk.noSelection", "Please select at least one item."), "warn");
      return;
    }

    const ids = Array.from(selectedIds);
    const count = ids.length;

    if (action === "delete") {
      const yes = await confirmDialog({
        title: t("core.bulk.deleteTitle", "Delete {n} items", { n: count }),
        description: t("core.bulk.deleteConfirm", "Are you sure you want to delete {n} selected items? This cannot be undone.", { n: count }),
      });
      if (!yes) return;
      try {
        const res = await api(scoped(contentPath(type) + "/batch"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", ids, all_locales: true }),
        });
        selectedIds.clear();
        toast(t("core.bulk.deletedCount", "{n} items deleted successfully", { n: res?.count ?? count }));
        go(state.page);
      } catch (err) {
        toast(err.message || t("core.bulk.failed", "Bulk operation failed"), "error");
      }
      return;
    }

    if (action.startsWith("status:")) {
      const status = action.split(":")[1];
      try {
        const res = await api(scoped(contentPath(type) + "/batch"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", status, ids, all_locales: true }),
        });
        selectedIds.clear();
        toast(t("core.bulk.updatedCount", "{n} items updated successfully", { n: res?.count ?? count }));
        go(state.page);
      } catch (err) {
        toast(err.message || t("core.bulk.failed", "Bulk operation failed"), "error");
      }
      return;
    }

    if (action === "category") {
      const catId = fieldAt("#bulkCategorySelect")?.value;
      if (!catId) {
        toast(t("core.bulk.noCategory", "Please choose a category."), "warn");
        return;
      }
      try {
        const res = await api(scoped(contentPath(type) + "/batch"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "category", category_id: catId, ids, all_locales: true }),
        });
        selectedIds.clear();
        toast(t("core.bulk.categoryUpdated", "Category assigned to {n} items", { n: res?.count ?? count }));
        go(state.page);
      } catch (err) {
        toast(err.message || t("core.bulk.failed", "Bulk operation failed"), "error");
      }
      return;
    }
  }

  const delBtn = closestEl(e, "[data-del]");
  if (delBtn) {
    const [delType, id] = (delBtn.dataset.del || "").split("|");
    const singular = postTypeInfo(delType).singular;
    const yes = await confirmDialog({
      title: t("core.content.deleteTitle", "Delete {type}", { type: singular }),
      description: t("core.content.deleteConfirm", "Are you sure you want to delete this {type}? This cannot be undone.", { type: singular }),
    });
    if (!yes) return;
    try {
      await api(scoped(contentPath(delType) + "/" + id), { method: "DELETE" });
      selectedIds.delete(id);
      toast(t("core.content.deleted", "Deleted successfully"));
      go(state.page);
    } catch (err) {
      toast(err.message || t("core.content.deleteFailed", "Delete failed"), "error");
    }
    return;
  }
});

