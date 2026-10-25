/**
 * Widget Picker Modal Dialog — searchable, categorized, dark-mode native component.
 *
 * Fully aligned with the #/widgets screen component catalog (core, theme, plugin, custom).
 * Zero coupling: completely unaware of specific plugin names or forms.
 *
 * Features:
 *   1. Category pills aligned with widgets catalog: All, Core, Theme, Plugin, Custom, Configured.
 *   2. Instant fuzzy search (matches title, ID, type, description).
 *   3. 100% dark mode parity using CFPress OKLCH CSS tokens.
 *   4. Keyboard accessible (ESC to close, Enter / double-click to select).
 */

import { api, scoped } from "./state.js";
import { attr, esc, toast } from "../ui.js";
import { icon } from "../icons.js";
import { t } from "./i18n.js";

let pickerHost = null;

function ensurePickerHost() {
  if (pickerHost && document.body.contains(pickerHost)) return pickerHost;
  pickerHost = document.createElement("div");
  pickerHost.id = "widget-picker-host";
  document.body.appendChild(pickerHost);
  return pickerHost;
}

/**
 * Open the visual widget picker dialog.
 * Resolves to { kind: "i"|"t", id: string, widget_type: string, title: string } or null when cancelled.
 */
export async function openWidgetPicker({ currentId = "", currentType = "" } = {}) {
  const host = ensurePickerHost();

  let instances = [];
  let types = [];

  // Load instances & types in parallel from unified endpoints
  try {
    const [wRes, tRes] = await Promise.all([
      api(scoped("widgets")).catch(() => ({ items: [] })),
      api(scoped("widgets/types")).catch(() => ({ items: [] })),
    ]);
    instances = Array.isArray(wRes?.items) ? wRes.items : [];
    types = Array.isArray(tRes?.items) ? tRes.items : [];
  } catch {
    toast(t("core.widget.noneAvailable", "No widgets available. Install a plugin or create a custom widget."), "error");
    return null;
  }

  // Normalise all items into uniform PickerItem records
  const items = [];

  // 1. Sidebar configured instances (if any)
  for (const w of instances) {
    items.push({
      key: `i:${w.id}`,
      kind: "i",
      id: String(w.id || ""),
      widget_type: String(w.widget_type || ""),
      title: String(w.title || w.id || ""),
      description: w.sidebar ? `Sidebar: ${w.sidebar}` : (w.widget_type || ""),
      category: "instance",
      badgeText: t("core.widget.badge.instance", "Configured"),
      iconName: "layout-dashboard",
    });
  }

  // 2. Types from extensions and core — strictly mirror #/widgets component catalog
  for (const tp of types) {
    const rawCat = String(tp.category || "").toLowerCase();
    const cat = rawCat === "core" || tp.type.startsWith("core.") ? "core"
      : rawCat === "theme" || tp.type.startsWith("theme.") ? "theme"
      : rawCat === "custom" || tp.type.startsWith("custom.") ? "custom"
      : "plugin";

    let badgeText = t("core.widget.badge.plugin", "Plugin");
    let iconName = tp.icon || "puzzle";

    if (cat === "core") {
      badgeText = t("core.widget.badge.core", "Core");
      const sub = String(tp.type).replace(/^core\./, "");
      iconName = sub === "search" ? "search"
        : sub === "menu" ? "menu"
        : (sub === "categories" || sub === "tag-cloud") ? "sliders-horizontal"
        : sub === "recent-posts" ? "file-text"
        : "puzzle";
    } else if (cat === "theme") {
      badgeText = t("core.widget.badge.theme", "Theme");
      iconName = tp.icon || "palette";
    } else if (cat === "custom") {
      badgeText = t("core.widget.badge.custom", "Custom");
      iconName = tp.icon || "code";
    } else {
      badgeText = t("core.widget.badge.plugin", "Plugin");
      iconName = tp.icon || "puzzle";
    }

    const itemId = String(tp.id || "");
    const title = String(tp.name || tp.title || tp.type || "");
    const desc = tp.description || (itemId ? `ID: ${itemId}` : String(tp.type || ""));

    items.push({
      key: `t:${tp.type}:${itemId}`,
      kind: "t",
      id: itemId,
      widget_type: String(tp.type || ""),
      title,
      description: desc,
      category: cat,
      badgeText,
      iconName,
    });
  }

  if (items.length === 0) {
    toast(t("core.widget.noneAvailable", "No widgets available. Install a plugin or create a custom widget."));
    return null;
  }

  // Pick initial selected key
  let selectedKey = "";
  if (currentId || currentType) {
    const match = items.find((it) =>
      (currentId && it.id === currentId) || (currentType && it.widget_type === currentType)
    );
    if (match) selectedKey = match.key;
  }
  if (!selectedKey && items.length > 0) {
    selectedKey = items[0].key;
  }

  let activeTab = "all"; // 'all' | 'core' | 'theme' | 'plugin' | 'custom' | 'instance'
  let query = "";

  return new Promise((resolve) => {
    const close = (result) => {
      host.innerHTML = "";
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && e.target?.tagName !== "TEXTAREA") {
        const item = items.find((it) => it.key === selectedKey);
        if (item) close(item);
      }
    };
    document.addEventListener("keydown", onKey);

    // Compute category counts
    const counts = {
      all: items.length,
      core: items.filter((x) => x.category === "core").length,
      theme: items.filter((x) => x.category === "theme").length,
      plugin: items.filter((x) => x.category === "plugin").length,
      custom: items.filter((x) => x.category === "custom").length,
      instance: items.filter((x) => x.category === "instance").length,
    };

    function renderModal() {
      // Filter list
      let filtered = items;
      if (activeTab !== "all") {
        filtered = filtered.filter((x) => x.category === activeTab);
      }
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = filtered.filter((x) =>
          x.title.toLowerCase().includes(q) ||
          x.id.toLowerCase().includes(q) ||
          x.widget_type.toLowerCase().includes(q) ||
          x.description.toLowerCase().includes(q) ||
          x.badgeText.toLowerCase().includes(q)
        );
      }

      const activeItem = items.find((it) => it.key === selectedKey);

      // Build Tab buttons strictly aligned with #/widgets categories: All, Core, Theme, Plugin, Custom
      const tabsDef = [
        { id: "all", label: t("core.widget.picker.all", "All") },
        { id: "core", label: t("core.widget.group.core", "Core") },
        { id: "theme", label: t("core.widget.group.theme", "Theme") },
        { id: "plugin", label: t("core.widget.group.plugin", "Plugin") },
        { id: "custom", label: t("core.widget.group.custom", "Custom") },
      ];
      if (counts.instance > 0) {
        tabsDef.push({ id: "instance", label: t("core.widget.group.instance", "Configured") });
      }

      const tabsHtml = tabsDef.map((tab) => {
        const count = counts[tab.id] || 0;
        const isActive = activeTab === tab.id;
        return `
          <button type="button" class="btn sm ${isActive ? "primary" : "ghost"}" data-tab="${attr(tab.id)}"
            style="border-radius:999px;padding:.25rem .75rem;font-size:.8125rem;white-space:nowrap;display:inline-flex;align-items:center;gap:.35rem">
            <span>${esc(tab.label)}</span>
            <span style="font-size:.75rem;opacity:${isActive ? "0.9" : "0.6"};background:${isActive ? "oklch(from var(--primary-foreground) l c h / 0.2)" : "var(--muted)"};color:${isActive ? "inherit" : "var(--foreground)"};padding:.05rem .4rem;border-radius:999px">${count}</span>
          </button>`;
      }).join("");

      // Build cards
      let cardsHtml = "";
      if (filtered.length === 0) {
        cardsHtml = `
          <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--muted-foreground)">
            <div style="font-size:2rem;margin-bottom:.5rem">${icon("search")}</div>
            <div style="font-size:.95rem;font-weight:600;margin-bottom:.25rem">${esc(t("core.widget.picker.noResults", "No matching widgets found"))}</div>
            <div style="font-size:.825rem">${esc(t("core.widget.picker.searchPh", "Search widgets by name, ID or type..."))}</div>
          </div>`;
      } else {
        cardsHtml = filtered.map((it) => {
          const isSelected = it.key === selectedKey;
          return `
            <div class="widget-card-item" data-key="${attr(it.key)}"
              style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem .85rem;border-radius:var(--radius);border:1.5px solid ${isSelected ? "var(--primary)" : "var(--border)"};background:${isSelected ? "oklch(from var(--primary) l c h / 0.08)" : "var(--card)"};cursor:pointer;transition:border-color .15s,background .15s;position:relative">
              <div style="width:2.25rem;height:2.25rem;border-radius:var(--radius-sm);background:${isSelected ? "var(--primary)" : "var(--muted)"};color:${isSelected ? "var(--primary-foreground)" : "var(--foreground)"};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                ${icon(it.iconName)}
              </div>
              <div style="flex:1;min-width:0;padding-right:.5rem">
                <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
                  <span style="font-weight:600;font-size:.875rem;color:var(--foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</span>
                  <span style="font-size:.7rem;padding:.1rem .4rem;border-radius:999px;background:var(--secondary);color:var(--secondary-foreground);white-space:nowrap">${esc(it.badgeText)}</span>
                </div>
                <div style="font-size:.775rem;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.description)}</div>
              </div>
              ${isSelected ? `<div style="color:var(--primary);flex-shrink:0;display:flex;align-items:center;margin-top:.15rem">${icon("circle-check")}</div>` : ""}
            </div>`;
        }).join("");
      }

      host.innerHTML = `
        <div class="overlay" style="z-index:90">
          <div class="dialog dialog-wide" role="dialog" aria-modal="true"
            style="width:min(52rem,100%);max-height:calc(100vh - 3rem);display:flex;flex-direction:column;padding:1.5rem;background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:0 24px 48px oklch(0 0 0 / 0.35)">

            <!-- Header -->
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem">
              <div>
                <h2 style="font-size:1.15rem;font-weight:700;margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem">
                  <span style="color:var(--primary)">${icon("sparkles")}</span>
                  <span>${esc(t("core.widget.picker.title", "Select Widget"))}</span>
                </h2>
                <div style="font-size:.825rem;color:var(--muted-foreground)">${esc(t("core.widget.picker.sub", "Choose a widget from the component catalog or configured widgets to embed."))}</div>
              </div>
              <button type="button" class="btn ghost sm" id="wp-close" style="padding:.25rem;height:auto" title="${attr(t("core.action.cancel", "Cancel"))}">
                ${icon("x")}
              </button>
            </div>

            <!-- Search bar -->
            <div style="display:flex;align-items:center;gap:.5rem;position:relative;margin-bottom:.75rem">
              <div style="position:absolute;left:.75rem;color:var(--muted-foreground);pointer-events:none;display:flex;align-items:center">
                ${icon("search")}
              </div>
              <input id="wp-search" type="search" value="${attr(query)}" placeholder="${attr(t("core.widget.picker.searchPh", "Search widgets by name, ID, slug or type..."))}"
                style="flex:1;padding-left:2.35rem;height:2.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:.875rem">
            </div>

            <!-- Categories Tabs -->
            <div style="display:flex;gap:.35rem;overflow-x:auto;padding-bottom:.4rem;margin-bottom:.65rem;border-bottom:1px solid var(--border)">
              ${tabsHtml}
            </div>

            <!-- Cards Container -->
            <div id="wp-grid" style="flex:1;overflow-y:auto;min-height:220px;max-height:380px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.65rem;padding:.2rem .2rem .6rem">
              ${cardsHtml}
            </div>

            <!-- Footer -->
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.85rem;padding-top:.85rem;border-top:1px solid var(--border)">
              <div style="font-size:.8125rem;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${activeItem ? `${esc(t("core.widget.picker.selected", "Selected: {name}", { name: activeItem.title }))}` : `${filtered.length} ${esc(t("core.widget.picker.all", "items"))}`}
              </div>
              <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
                <button type="button" class="btn outline" id="wp-cancel">${esc(t("core.action.cancel", "Cancel"))}</button>
                <button type="button" class="btn primary" id="wp-confirm" ${!activeItem ? "disabled" : ""}>
                  ${icon("check")}${esc(t("core.widget.picker.insert", "Insert Widget"))}
                </button>
              </div>
            </div>

          </div>
        </div>
      `;

      // Wire interactive events
      const searchInput = host.querySelector("#wp-search");
      if (searchInput) {
        searchInput.focus();
        searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
        searchInput.addEventListener("input", (e) => {
          query = e.target.value;
          renderModal();
        });
      }

      host.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeTab = btn.dataset.tab;
          renderModal();
        });
      });

      host.querySelectorAll(".widget-card-item").forEach((card) => {
        card.addEventListener("click", () => {
          selectedKey = card.dataset.key;
          renderModal();
        });
        card.addEventListener("dblclick", () => {
          selectedKey = card.dataset.key;
          const chosen = items.find((it) => it.key === selectedKey);
          if (chosen) close(chosen);
        });
      });

      const btnClose = host.querySelector("#wp-close");
      if (btnClose) btnClose.onclick = () => close(null);

      const btnCancel = host.querySelector("#wp-cancel");
      if (btnCancel) btnCancel.onclick = () => close(null);

      const btnConfirm = host.querySelector("#wp-confirm");
      if (btnConfirm) {
        btnConfirm.onclick = () => {
          const chosen = items.find((it) => it.key === selectedKey);
          if (chosen) close(chosen);
        };
      }

      const overlay = host.querySelector(".overlay");
      if (overlay) {
        overlay.addEventListener("mousedown", (e) => {
          if (e.target === overlay) close(null);
        });
      }
    }

    renderModal();
  });
}
