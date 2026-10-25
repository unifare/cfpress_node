/**
 * Screen: Plugins — installed plugins, enable/disable and declared settings.
 *
 * Plugins are declarative: the manifest names hooks, the host provides their
 * implementations. There is no executable plugin code.
 */
import { api, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { evtField, elAt, closestEl, alertDialog, attr, confirmDialog, emptyRow, esc, openDialog, toast } from "../../ui.js";
import { installExtension } from "./extension-install.js";
import { showCapabilitiesModal } from "./capabilities-modal.js";

let lastPluginItems = [];

export default async function plugins(c) {
  const d = await api("extensions/plugins");
  const items = d.items || [];
  lastPluginItems = items;

  const rows = items.map((x) => `<tr>
      <td><div style="display:flex;align-items:center;gap:.6rem">
        <span class="team-logo" style="width:2rem;height:2rem;background:var(--muted);color:var(--muted-foreground)">${icon("puzzle")}</span>
        <div>
          <div style="display:flex;align-items:center;gap:.4rem">
            <span style="font-weight:600;font-size:.95rem">${esc(x.title)}</span>
            <span class="badge secondary" style="font-size:.72rem;padding:1px 6px">v${esc(x.version || "1.0.0")}</span>
          </div>
          <div class="muted text-sm">${x.hooks_wired?.length ? esc(t("core.plugins.hooks", "hooks: {list}", { list: x.hooks_wired.join(", ") })) : esc(x.name)}</div>
        </div>
      </div></td>
      <td>${x.enabled ? `<span class="badge success">${esc(t("core.plugins.enabled", "enabled"))}</span>` : `<span class="badge secondary">${esc(t("core.plugins.disabled", "disabled"))}</span>`}</td>
      <td class="actions" style="display:flex;align-items:center;gap:.35rem;justify-content:flex-end">
        <button class="btn outline sm" data-plugin-doctor="${attr(x.name)}">${icon("activity")}${esc(t("core.ext.doctor", "体检"))}</button>
        <button class="btn outline sm" data-plugin-manifest="${attr(x.name)}">${icon("layers")}${esc(t("core.plugins.manifest", "清单"))}</button>
        <button class="btn outline sm" data-plugin-toggle="${attr(x.name)}|${x.enabled ? 1 : 0}">${icon(x.enabled ? "x" : "check")}${esc(t(x.enabled ? "core.plugins.disable" : "core.plugins.enable", x.enabled ? "Disable" : "Enable"))}</button>
        <button class="btn outline sm" data-plugin-settings="${attr(x.name)}">${icon("settings")}${esc(t("core.nav.settings", "Settings"))}</button>
        <button class="btn outline danger sm" data-plugin-del="${attr(x.name)}">${icon("trash")}${esc(t("core.plugins.delete", "删除"))}</button>
      </td>
    </tr>`).join("");

  c.innerHTML = `${pageHead({
    title: t("core.nav.plugins", "Plugins"),
    sub: t("core.plugins.sub", "{n} installed · declarative hooks, no executable plugin code", { n: items.length }),
    actions: `<label class="btn primary">${icon("upload")}${esc(t("core.plugins.installZip", "Install plugin ZIP"))}<input id="pluginZip" type="file" accept=".zip" hidden></label>`,
    crumbs: [{ label: t("core.nav.extensions", "Extensions") }, { label: t("core.nav.plugins", "Plugins") }],
  })}
  <div class="table-wrap"><table class="table">
    <thead><tr><th>${esc(t("core.plugins.colPlugin", "Plugin"))}</th><th>${esc(t("core.content.status", "Status"))}</th><th style="text-align:right">${esc(t("core.action.actions", "操作"))}</th></tr></thead>
    <tbody>${rows || emptyRow(3, t("core.plugins.none", "No plugins installed."))}</tbody>
  </table></div>`;

  elAt("#pluginZip").onchange = (e) => installExtension(evtField(e).files[0], "plugins");
}

export async function pluginSettings(n) {
  let d;
  try { d = await api(`extensions/plugins/${n}/settings`); }
  catch (e) { await alertDialog({ title: t("core.plugins.loadFailed", "Could not load settings"), description: e.message }); return; }
  if (!d.items?.length) { toast(t("core.plugins.noSettings", "This plugin declares no settings")); return; }

  const v = await openDialog({
    title: t("core.plugins.settingsTitle", "{name} settings", { name: n }),
    description: t("core.plugins.settingsDesc", "Values are stored per plugin and validated against its manifest."),
    confirmLabel: t("core.plugins.saveSettings", "Save settings"),
    fields: d.items.map((x) => ({ name: x.key, label: x.label || x.key, value: x.value || "" })),
  });
  if (!v) return;
  try {
    for (const [key, value] of Object.entries(v)) {
      await api(`extensions/plugins/${n}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
    }
    toast(t("core.plugins.saved", "Plugin settings saved"));
  } catch (e) { await alertDialog({ title: t("core.plugins.saveFailed", "Could not save"), description: e.message }); }
}

document.addEventListener("plugin-open-settings", (e) => {
  const ce = /** @type {CustomEvent} */ (e);
  if (ce.detail?.name) pluginSettings(ce.detail.name);
});

document.addEventListener("click", async (e) => {
  const btn = closestEl(e, "[data-plugin-toggle]");
  if (btn) {
    const [name, on] = btn.dataset.pluginToggle.split("|");
    try {
      await api("extensions/plugins/" + name + "/" + (on === "1" ? "disable" : "enable"), { method: "POST" });
      toast(on === "1" ? t("core.plugins.toggledOff", "Plugin disabled") : t("core.plugins.toggledOn", "Plugin enabled"));
      render();
    } catch (err) { toast(err.message, "error"); }
    return;
  }

  const s = closestEl(e, "[data-plugin-settings]");
  if (s) {
    await pluginSettings(s.dataset.pluginSettings);
    return;
  }

  const doc = closestEl(e, "[data-plugin-doctor]");
  if (doc) {
    const name = doc.dataset.pluginDoctor;
    const item = lastPluginItems.find((x) => x.name === name) || { name, title: name };
    showCapabilitiesModal({ type: "plugin", item, siteId: state.site, initialTab: "doctor" });
    return;
  }

  const mf = closestEl(e, "[data-plugin-manifest]");
  if (mf) {
    const name = mf.dataset.pluginManifest;
    const item = lastPluginItems.find((x) => x.name === name) || { name, title: name };
    showCapabilitiesModal({ type: "plugin", item, siteId: state.site });
    return;
  }

  const del = closestEl(e, "[data-plugin-del]");
  if (del) {
    const name = del.dataset.pluginDel;
    const sure = await confirmDialog({
      title: t("core.plugins.uninstallTitle", "卸载并删除插件？"),
      description: t("core.plugins.uninstallDesc", "将从系统彻底移除插件【{name}】，并清理其注册的菜单、自定义数据表与配置，此操作不可恢复。", { name }),
      confirmLabel: t("core.plugins.delete", "删除"),
      danger: true,
    });
    if (!sure) return;
    try {
      await api("extensions/plugins/" + encodeURIComponent(name), { method: "DELETE" });
      toast(t("core.plugins.deleted", "插件已成功卸载并删除"));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.plugins.deleteFailed", "删除失败"), description: err.message });
    }
    return;
  }
});
