/**
 * Screen: generic table for tabular resources (locales, activity).
 *
 * The fetch is deliberately **not** site-scoped, and that is correct for both
 * callers: `locales` is the deployment-wide language dictionary (only
 * `menus`/`menu_items` are filtered by site in `genericTable`), and
 * `admin_activity` is a global log with no `site_id` column. Kept as-is so this
 * module split stays behaviour-neutral.
 */
import { api } from "../state.js";
import { pageHead } from "../shell.js";
import { t } from "../i18n.js";
import { emptyRow, esc } from "../../ui.js";

export default async function resources(c, path, title) {
  const pageTitle = path === "activity" ? t("core.nav.activity", title || "Activity") : title;
  const d = await api(path);
  const rows = d.items || [];
  let keys = rows[0] ? Object.keys(rows[0]) : [];
  if (path === "activity") {
    const preferred = ["action", "entity_type", "entity_id", "user_id", "ip", "meta", "created_at"];
    keys = preferred.filter((k) => rows.some((r) => k in r));
    if (!keys.length && rows[0]) keys = Object.keys(rows[0]);
  } else {
    keys = keys.slice(0, 7);
  }
  const colLabels = {
    action: t("core.res.colAction", "Action"),
    entity_type: t("core.res.colType", "Type"),
    entity_id: t("core.res.colId", "ID"),
    user_id: t("core.res.colUser", "User"),
    ip: t("core.res.colIp", "IP Address"),
    meta: t("core.res.colMeta", "Details"),
    created_at: t("core.res.colTime", "Time"),
  };
  const formatCell = (k, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k === "created_at" && typeof v === "number") {
      const dt = new Date(v * 1000);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:${String(dt.getSeconds()).padStart(2, "0")}`;
    }
    return esc(String(v));
  };
  c.innerHTML = `${pageHead({
    title: pageTitle,
    sub: rows.length === 1 ? t("core.res.recordsOne", "1 record") : t("core.res.recordsMany", "{n} records", { n: rows.length }),
    crumbs: [{ label: path === "activity" ? t("core.nav.tools", "Tools") : t("core.nav.general", "General") }, { label: pageTitle }],
  })}
  <div class="table-wrap"><table class="table">
    <thead><tr>${keys.map((k) => `<th>${colLabels[k] || esc(k.replace(/_/g, " "))}</th>`).join("") || `<th>${esc(t("core.res.colData", "Data"))}</th>`}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${formatCell(k, r[k])}</td>`).join("")}</tr>`).join("") || emptyRow(keys.length || 1, t("core.res.noRecords", "No records."))}</tbody>
  </table></div>`;
}
