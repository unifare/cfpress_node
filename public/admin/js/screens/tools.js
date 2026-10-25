/**
 * Screen — Unified Tools Hub (`#/tools`).
 *
 * Consolidates operational & developer tools into one tabbed workbench:
 *   1. Backup & Restore (`backup.js`)
 *   2. AI & API Gateway (`api-keys.js`)
 *   3. Activity Audit Log (with action & keyword filtering)
 *   4. Admin Menu Customization (`menu-config.js`)
 *   5. Demo Content & Runtime Maintenance
 */
import { api, state } from "../state.js";
import { pageHead } from "../shell.js";
import { icon } from "../../icons.js";
import { attr, closestEl, esc, fmtDate } from "../../ui.js";
import { t } from "../i18n.js";
import backup from "./backup.js";
import apiKeys from "./api-keys.js";
import menuConfig from "./menu-config.js";

let activeHubTab = "backup";

export async function tools(el, initialTab = "") {
  if (initialTab && typeof initialTab === "string") {
    activeHubTab = initialTab;
  }

  const TABS = [
    { id: "backup", iconName: "history", label: t("core.tools.tabBackup", "Backup & Restore") },
    { id: "api-keys", iconName: "sparkles", label: t("core.tools.tabApiKeys", "AI & API Gateway") },
    { id: "activity", iconName: "activity", label: t("core.tools.tabActivity", "Activity Audit Log") },
    { id: "menu-config", iconName: "menu", label: t("core.tools.tabMenuConfig", "Menu Customization") },
    { id: "demo", iconName: "package", label: t("core.tools.tabDemo", "Demo & Maintenance") },
  ];

  async function renderHub() {
    el.innerHTML =
      pageHead({
        title: t("core.tools.title", "Tools Hub"),
        sub: t("core.tools.sub", "Backup, API gateway, audit logs, menu customization and demo utilities for {site}", { site: state.site }),
        crumbs: [{ label: t("core.nav.tools", "Tools") }, { label: t("core.tools.title", "Tools Hub") }],
      }) +
      `<div class="hub-tabs" role="tablist">
        ${TABS.map(
          (tab) => `<button type="button" class="hub-tab-btn${activeHubTab === tab.id ? " active" : ""}" data-hub-tab="${attr(tab.id)}">
            ${icon(tab.iconName)}
            <span>${esc(tab.label)}</span>
          </button>`
        ).join("")}
      </div>
      <div id="tools-hub-stage" class="hub-embedded"></div>`;

    const stage = el.querySelector("#tools-hub-stage") || el;
    if (activeHubTab === "backup") {
      await backup(stage);
    } else if (activeHubTab === "api-keys") {
      await apiKeys(stage);
    } else if (activeHubTab === "activity") {
      await renderActivityTab(stage);
    } else if (activeHubTab === "menu-config") {
      await menuConfig(stage);
    } else if (activeHubTab === "demo") {
      renderDemoTab(stage);
    }
  }

  await renderHub();

  el.onclick = async (e) => {
    const tabBtn = closestEl(e, "[data-hub-tab]");
    if (tabBtn) {
      const next = tabBtn.dataset.hubTab;
      if (next && next !== activeHubTab) {
        activeHubTab = next;
        await renderHub();
      }
      return;
    }

    const actBtn = closestEl(e, "[data-action]");
    if (!actBtn) return;
    const action = actBtn.dataset.action;

    if (action === "refresh-activity") {
      const stage = el.querySelector("#tools-hub-stage") || el;
      await renderActivityTab(stage);
    }
  };
}

async function renderActivityTab(stage) {
  const d = await api(`activity?site=${encodeURIComponent(state.site)}`);
  const allRows = d.items || [];
  const actions = [...new Set(allRows.map((r) => r.action).filter(Boolean))];

  let filterAction = "";
  let searchQ = "";

  function drawTable() {
    const filtered = allRows.filter((r) => {
      if (filterAction && r.action !== filterAction) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        const hay = `${r.action || ""} ${r.resource_type || ""} ${r.resource_id || ""} ${r.username || r.user_id || ""} ${r.ip || ""} ${r.meta || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const countLabel =
      filtered.length === 1
        ? t("core.res.recordsOne", "1 record")
        : t("core.res.recordsMany", "{n} records", { n: filtered.length });

    stage.innerHTML = `<div class="panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.tools.activityTitle", "Activity Audit Log"))}</div>
          <div class="panel-desc">${esc(t("core.tools.activitySub", "Track administrative actions, content edits, and system events on {site}", { site: state.site }))}</div>
        </div>
        <div class="row" style="gap:0.5rem">
          <span class="badge secondary">${esc(countLabel)}</span>
          <button type="button" class="btn outline sm" data-action="refresh-activity">${icon("refresh")}<span>${esc(t("core.action.refresh", "Refresh"))}</span></button>
        </div>
      </div>
      <div class="panel-body">
        <div class="row" style="gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap">
          <div style="flex:1;min-width:14rem">
            <input type="search" class="input" id="activity-search-input" value="${attr(searchQ)}" placeholder="${attr(t("core.tools.activitySearch", "Filter by action, resource type, user or IP..."))}" />
          </div>
          <div style="min-width:11rem">
            <select class="control" id="activity-action-filter">
              <option value="">${esc(t("core.tools.activityAllActions", "All actions"))}</option>
              ${actions.map((act) => `<option value="${attr(act)}"${filterAction === act ? " selected" : ""}>${esc(act)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead>
            <tr>
              <th>${esc(t("core.res.colAction", "Action"))}</th>
              <th>${esc(t("core.res.colType", "Type"))}</th>
              <th>${esc(t("core.res.colId", "ID"))}</th>
              <th>${esc(t("core.res.colUser", "User"))}</th>
              <th>${esc(t("core.res.colIp", "IP Address"))}</th>
              <th>${esc(t("core.res.colMeta", "Details"))}</th>
              <th>${esc(t("core.res.colTime", "Time"))}</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered
                .map((r) => {
                  let metaText = "—";
                  if (r.meta && r.meta !== "{}") {
                    try {
                      const parsed = typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta;
                      const pairs = Object.entries(parsed || {}).map(
                        ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
                      );
                      if (pairs.length) metaText = pairs.join(", ");
                    } catch {
                      metaText = String(r.meta);
                    }
                  }
                  return `<tr>
                    <td><span class="badge secondary">${esc(r.action)}</span></td>
                    <td class="muted">${esc(r.resource_type || "—")}</td>
                    <td class="mono muted">${esc(r.resource_id || "—")}</td>
                    <td>${esc(r.username || r.user_id || "system")}</td>
                    <td class="mono muted" style="font-size:0.75rem">${esc(r.ip || "—")}</td>
                    <td class="muted" style="font-size:0.75rem;max-width:18rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(metaText)}">${esc(metaText)}</td>
                    <td class="muted">${fmtDate(r.created_at)}</td>
                  </tr>`;
                })
                .join("") || `<tr><td colspan="7" class="empty">${esc(t("core.res.noRecords", "No records."))}</td></tr>`
            }
          </tbody>
        </table></div>
      </div>
    </div>`;

    const searchInput = stage.querySelector("#activity-search-input");
    if (searchInput) {
      searchInput.oninput = (ev) => {
        searchQ = ev.target.value || "";
        drawTable();
      };
    }
    const actionSelect = stage.querySelector("#activity-action-filter");
    if (actionSelect) {
      actionSelect.onchange = (ev) => {
        filterAction = ev.target.value || "";
        drawTable();
      };
    }
  }

  drawTable();
}

function renderDemoTab(stage) {
  stage.innerHTML = `
    <div class="panel" style="margin-bottom:1.25rem">
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.settings.seedDemo.title", "Demo content"))}</div>
          <div class="panel-desc">${esc(t("core.settings.seedDemo.desc", "Write the bilingual demo articles and the About page for this site. Fixed per-site ids — safe to re-run, it updates instead of duplicating."))}</div>
        </div>
        <button class="btn outline sm" type="button" data-action="seed-demo">
          ${icon("refresh")}<span>${esc(t("core.settings.seedDemo.run", "Restore demo content"))}</span>
        </button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.tools.runtimeTitle", "Node.js + Drizzle Runtime"))}</div>
          <div class="panel-desc">${esc(t("core.tools.runtimeDesc", "Running on native Node.js HTTP server with SQLite WAL + Drizzle ORM."))}</div>
        </div>
        <span class="badge success">${icon("circle-check")}<span>Active</span></span>
      </div>
    </div>
  `;
}
