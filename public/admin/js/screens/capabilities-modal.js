/**
 * Capabilities Modal: "What '{name}' provides on this site"
 *
 * Displays declared business capabilities & materialised platform assets
 * for themes and plugins, matching the design aesthetics of dotnetcms:
 *   Tab 1: 声明与资产概览 (Overview: Custom fields, Blocks/Tables, UI Translations summary, Hooks & Menus)
 *   Tab 2: 界面翻译字典 (UI Translations dictionary matrix)
 *   Tab 3: 🩺 健康体检报告 (Health & Doctor Inspection Report with live trigger)
 */
import { api, scoped, state } from "../state.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { esc, attr } from "../../ui.js";

let modalHost = null;

function ensureModalHost() {
  if (!modalHost) {
    modalHost = document.createElement("div");
    modalHost.id = "capabilities-modal-host";
    document.body.appendChild(modalHost);
  }
  return modalHost;
}

export async function showCapabilitiesModal({ type, item, siteId, initialTab = "overview" }) {
  const host = ensureModalHost();
  const sid = siteId || state.site;
  const isTheme = type === "theme";
  const name = item.name;
  const title = item.title || name;
  const version = item.version || "1.0.0";
  const manifest = item.manifest || {};

  // Fetch materialised runtime data if active theme
  let fields = Array.isArray(manifest.fields) ? [...manifest.fields] : [];
  let blocks = Array.isArray(manifest.blocks) ? [...manifest.blocks] : [];
  let tables = Array.isArray(manifest.tables) ? [...manifest.tables] : [];
  let routes = Array.isArray(manifest.routes) ? [...manifest.routes] : [];
  let menus = Array.isArray(manifest.adminMenus) ? [...manifest.adminMenus] : (Array.isArray(manifest.menuLocations) ? [...manifest.menuLocations] : []);
  let hooks = Array.isArray(manifest.hooks) ? [...manifest.hooks] : [];
  let translations = {};

  // Doctor state
  let doctorReport = item.report || null;
  let isChecking = false;
  let doctorError = null;

  if (isTheme && item.active) {
    try {
      const [fRes, bRes, rRes] = await Promise.all([
        api(scoped("theme/fields")).catch(() => ({ items: [] })),
        api(scoped("theme/blocks")).catch(() => ({ items: [] })),
        api(scoped("theme/routes")).catch(() => ({ items: [] })),
      ]);
      if (fRes?.items?.length) fields = fRes.items;
      if (bRes?.items?.length) blocks = bRes.items;
      if (rRes?.items?.length) routes = rRes.items;
    } catch {}
  }

  // Attempt to load language files for theme/plugin
  if (isTheme) {
    try {
      const flRes = await api(scoped(`extensions/themes/${encodeURIComponent(name)}/files`)).catch(() => ({ files: [] }));
      const langFiles = (flRes.files || []).filter((f) => f.startsWith("langs/") && f.endsWith(".json"));
      for (const lf of langFiles) {
        const loc = lf.replace(/^langs\//, "").replace(/\.json$/, "");
        try {
          const contentRes = await api(scoped(`extensions/themes/${encodeURIComponent(name)}/file?path=${encodeURIComponent(lf)}`));
          if (contentRes?.content) {
            translations[loc] = JSON.parse(contentRes.content);
          }
        } catch {}
      }
    } catch {}
  }

  // Fallback demo/manifest translations if empty
  if (Object.keys(translations).length === 0) {
    if (manifest.translations && typeof manifest.translations === "object") {
      translations = manifest.translations;
    } else if (manifest.langs && typeof manifest.langs === "object") {
      translations = manifest.langs;
    } else {
      translations = {
        "zh-CN": {
          "site.title": title,
          "common.read_more": "阅读全文",
          "nav.home": "首页",
          "nav.archive": "归档",
          "comment.submit": "发表评论",
          "footer.copyright": "保留所有权利",
        },
        "en-US": {
          "site.title": title,
          "common.read_more": "Read more",
          "nav.home": "Home",
          "nav.archive": "Archives",
          "comment.submit": "Post Comment",
          "footer.copyright": "All rights reserved",
        },
      };
    }
  }

  // Gather translation keys
  const langCodes = Object.keys(translations);
  const allKeysSet = new Set();
  for (const loc of langCodes) {
    for (const k of Object.keys(translations[loc] || {})) {
      allKeysSet.add(k);
    }
  }
  const allKeys = Array.from(allKeysSet);
  const totalKeysCount = allKeys.length;

  let activeTab = initialTab || "overview"; // 'overview' | 'i18n' | 'doctor'
  let searchQuery = "";

  async function triggerDoctorInspection() {
    isChecking = true;
    doctorError = null;
    mount();
    try {
      const res = await api(scoped("extensions/inspect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, manifest }),
      });
      if (res && res.report) {
        doctorReport = res.report;
        item.report = res.report;
      }
    } catch (err) {
      doctorError = err.message || "体检执行失败";
    } finally {
      isChecking = false;
      mount();
    }
  }

  // Auto trigger if opened directly on doctor tab
  if (activeTab === "doctor" && !doctorReport) {
    triggerDoctorInspection();
  }

  function renderContent() {
    const customFieldsHtml = fields.length
      ? fields.map((f) => {
          const l = f.label || f.meta_key || f.key || "Field";
          const k = f.meta_key || f.key || "";
          const tName = f.type || "text";
          const dVal = f.default !== undefined ? ` (默认: ${esc(f.default)})` : "";
          return `<span style="display:inline-block;padding:4px 10px;margin:3px 4px 3px 0;background:var(--muted);border-radius:var(--radius-sm, 6px);font-size:.85rem">
            <strong>${esc(l)}</strong> <span class="muted text-xs">(${esc(k)}) [${esc(tName)}${dVal}]</span>
          </span>`;
        }).join("")
      : `<span class="muted text-sm">未声明自定义字段</span>`;

    const blocksOrTablesTitle = isTheme ? "Blocks" : "Tables & Schemas";
    const blocksOrTablesCount = isTheme ? blocks.length : tables.length;
    const blocksOrTablesHtml = isTheme
      ? (blocks.length
          ? blocks.map((b) => {
              const bTitle = b.title || b.name || "Block";
              const bName = b.name || "";
              return `<span style="display:inline-flex;align-items:center;gap:.35rem;padding:3px 9px;margin:3px 4px 3px 0;border:1px solid #bfdbfe;color:#1e40af;background:#eff6ff;border-radius:var(--radius-sm, 6px);font-size:.82rem">
                ${icon("package", 'style="width:.9rem;height:.9rem"')}
                <span>${esc(bTitle)} <span style="opacity:.7">(${esc(bName)})</span></span>
              </span>`;
            }).join("")
          : `<span class="muted text-sm">未声明独立区块</span>`)
      : (tables.length
          ? tables.map((tb) => {
              const tbName = typeof tb === "string" ? tb : (tb.name || tb.tableName || "table");
              const fieldsCount = Array.isArray(tb.fields) ? tb.fields.length : 0;
              return `<span style="display:inline-flex;align-items:center;gap:.35rem;padding:3px 9px;margin:3px 4px 3px 0;border:1px solid #c7d2fe;color:#3730a3;background:#eef2ff;border-radius:var(--radius-sm, 6px);font-size:.82rem">
                ${icon("layers", 'style="width:.9rem;height:.9rem"')}
                <span>${esc(tbName)} ${fieldsCount ? `<span style="opacity:.8">(${fieldsCount} 列)</span>` : ""}</span>
              </span>`;
            }).join("")
          : `<span class="muted text-sm">未声明持久化数据表</span>`);

    const i18nBadgesHtml = langCodes.map((loc) => {
      const cnt = Object.keys(translations[loc] || {}).length;
      return `<span style="display:inline-flex;align-items:center;gap:.35rem;padding:3px 8px;margin-right:6px;background:var(--muted);border-radius:var(--radius-sm, 6px);font-size:.82rem">
        ${icon("globe", 'style="width:.85rem;height:.85rem;color:var(--primary)"')}
        <strong>${esc(loc)}</strong> <span class="muted text-xs">${cnt} keys</span>
      </span>`;
    }).join("");

    const hooksAndMenusHtml = [];
    if (hooks.length) {
      hooksAndMenusHtml.push(`<div style="margin-bottom:6px"><strong>Hooks 挂载:</strong> ${hooks.map((h) => `<span class="badge secondary" style="margin-right:4px">${esc(h)}</span>`).join("")}</div>`);
    }
    if (menus.length) {
      hooksAndMenusHtml.push(`<div><strong>注册菜单:</strong> ${menus.map((m) => {
        const mLabel = m.label || m.name || m.title || m.id || "Menu";
        const mScreen = m.screen || m.location || m.id || "";
        return `<span style="display:inline-flex;align-items:center;gap:.3rem;padding:2px 8px;margin-right:4px;border:1px solid #bbf7d0;color:#15803d;background:#f0fdf4;border-radius:var(--radius-sm, 6px);font-size:.82rem">
          ${icon("layout-dashboard", 'style="width:.8rem;height:.8rem"')}
          ${esc(mLabel)} ${mScreen ? `<span style="opacity:.7">(${esc(mScreen)})</span>` : ""}
        </span>`;
      }).join("")}</div>`);
    }
    if (hooksAndMenusHtml.length === 0) {
      hooksAndMenusHtml.push(`<span class="muted text-sm">未声明额外菜单或钩子插槽</span>`);
    }

    // Filtered translation keys for Tab 2
    const q = searchQuery.trim().toLowerCase();
    const filteredKeys = q
      ? allKeys.filter((k) => {
          if (k.toLowerCase().includes(q)) return true;
          return langCodes.some((loc) => String(translations[loc]?.[k] || "").toLowerCase().includes(q));
        })
      : allKeys;

    // Doctor Report rendering
    let doctorTabBadge = '<span class="badge secondary sm" style="margin-left:.35rem">待检查</span>';
    if (isChecking) {
      doctorTabBadge = '<span class="badge info sm" style="margin-left:.35rem">检查中...</span>';
    } else if (doctorReport) {
      const sc = doctorReport.score;
      const bColor = sc >= 90 ? "success" : sc >= 70 ? "info" : "danger";
      doctorTabBadge = `<span class="badge ${bColor} sm" style="margin-left:.35rem">${sc}分</span>`;
    }

    return `
      <style>
        .cap-modal-overlay {
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(4px);
          padding: 1.5rem;
        }
        .cap-modal-card {
          background: var(--card, #fff);
          color: var(--foreground, #0f172a);
          border-radius: var(--radius-lg, 12px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
          width: 100%;
          max-width: 880px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border, #e2e8f0);
          overflow: hidden;
        }
        .cap-modal-header {
          padding: 1.25rem 1.5rem 1rem;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          border-bottom: 1px solid var(--border, #e2e8f0);
          gap: 1rem;
        }
        .cap-modal-header-title {
          font-size: 1.35rem;
          font-weight: 700;
          margin: 0 0 0.25rem;
          color: var(--foreground);
          line-height: 1.3;
          word-break: break-word;
        }
        .cap-modal-header-sub {
          font-size: 0.85rem;
          color: var(--muted-foreground, #64748b);
          line-height: 1.4;
          word-break: break-word;
        }
        .cap-modal-tabs {
          padding: 0.5rem 1.5rem 0;
          display: flex;
          gap: 1.5rem;
          border-bottom: 1px solid var(--border, #e2e8f0);
          background: var(--muted, #f8fafc);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .cap-modal-tabs::-webkit-scrollbar {
          display: none;
        }
        .cap-tab-btn {
          padding: 0.6rem 0.2rem;
          border-radius: 0;
          font-weight: 600;
          font-size: 0.9rem;
          white-space: nowrap;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          cursor: pointer;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--muted-foreground, #64748b);
          transition: all 0.15s ease;
        }
        .cap-tab-btn.active {
          color: var(--primary, #2563eb);
          border-bottom-color: var(--primary, #2563eb);
        }
        .cap-modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
          -webkit-overflow-scrolling: touch;
        }
        .cap-score-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem 1.5rem;
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: 10px;
          margin-bottom: 1.5rem;
          gap: 1rem;
        }
        .cap-score-main {
          display: flex;
          align-items: center;
          gap: 1.25rem;
          min-width: 0;
          flex: 1;
        }
        .cap-score-circle {
          width: 68px;
          height: 68px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          color: #fff;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
        }
        .cap-score-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--foreground);
          line-height: 1.35;
          word-break: break-word;
        }
        .cap-score-sub {
          margin-top: 0.25rem;
          line-height: 1.4;
          word-break: break-word;
        }
        .cap-score-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .cap-diag-card {
          padding: 1rem 1.15rem;
          border-radius: 8px;
          color: var(--foreground);
          margin-bottom: 0.75rem;
        }
        .cap-diag-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.35rem;
          flex-wrap: wrap;
        }
        .cap-diag-title {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          font-weight: 600;
          font-size: 0.92rem;
          color: var(--foreground);
          flex: 1;
          min-width: 200px;
          line-height: 1.4;
          word-break: break-word;
        }
        .cap-diag-file {
          opacity: 0.85;
          color: var(--foreground);
          word-break: break-all;
        }
        .cap-modal-footer {
          padding: 0.9rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid var(--border, #e2e8f0);
          background: var(--muted, #f8fafc);
          gap: 0.75rem;
        }
        .cap-footer-info {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 0.82rem;
          color: var(--muted-foreground);
          min-width: 0;
          flex-wrap: wrap;
        }
        .cap-footer-btns {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-shrink: 0;
        }

        /* 手机/移动端适配规则 (Screen Width <= 640px) */
        @media (max-width: 640px) {
          .cap-modal-overlay {
            padding: 0.35rem !important;
          }
          .cap-modal-card {
            max-height: 96vh !important;
            border-radius: 8px !important;
          }
          .cap-modal-header {
            padding: 0.85rem 1rem 0.65rem !important;
          }
          .cap-modal-header-title {
            font-size: 1.1rem !important;
          }
          .cap-modal-header-sub {
            font-size: 0.78rem !important;
          }
          .cap-modal-tabs {
            padding: 0.35rem 0.75rem 0 !important;
            gap: 0.75rem !important;
          }
          .cap-tab-btn {
            font-size: 0.82rem !important;
            padding: 0.5rem 0.15rem !important;
          }
          .cap-modal-body {
            padding: 0.85rem !important;
          }
          .cap-score-banner {
            flex-direction: column !important;
            align-items: stretch !important;
            padding: 0.85rem !important;
            gap: 0.85rem !important;
            margin-bottom: 1rem !important;
          }
          .cap-score-main {
            gap: 0.85rem !important;
          }
          .cap-score-circle {
            width: 54px !important;
            height: 54px !important;
          }
          .cap-score-circle span:first-child {
            font-size: 1.3rem !important;
          }
          .cap-score-title {
            font-size: 1rem !important;
          }
          .cap-score-actions {
            justify-content: space-between !important;
            width: 100% !important;
            padding-top: 0.65rem !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
          }
          .cap-diag-title {
            min-width: 100% !important;
          }
          .cap-modal-footer {
            flex-direction: column !important;
            align-items: stretch !important;
            padding: 0.75rem 0.85rem !important;
            gap: 0.75rem !important;
          }
          .cap-footer-info {
            justify-content: space-between !important;
            width: 100% !important;
            font-size: 0.78rem !important;
          }
          .cap-footer-btns {
            width: 100% !important;
            justify-content: stretch !important;
          }
          .cap-footer-btns .btn {
            flex: 1 !important;
            justify-content: center !important;
          }
        }
      </style>

      <div class="overlay cap-modal-overlay">
        <div class="cap-modal-card">
          
          <!-- Modal Header -->
          <div class="cap-modal-header">
            <div>
              <h2 class="cap-modal-header-title">
                What “${esc(title)}” provides on this site
              </h2>
              <div class="cap-modal-header-sub">
                Business capabilities the ${isTheme ? "theme" : "plugin"} declared and Platform materialised (${isTheme ? "主题" : "插件"}声明的业务能力与平台生效资产)
              </div>
            </div>
            <button id="modal-x-close" class="btn icon sm ghost" style="color:var(--muted-foreground);border-radius:50%;flex-shrink:0">
              ${icon("x", 'style="width:1.2rem;height:1.2rem"')}
            </button>
          </div>

          <!-- Tabs -->
          <div class="cap-modal-tabs">
            <button id="tab-btn-overview" class="cap-tab-btn ${activeTab === "overview" ? "active" : ""}">
              ${icon("layout-dashboard", 'style="width:1rem;height:1rem"')} 声明与资产概览
            </button>
            <button id="tab-btn-i18n" class="cap-tab-btn ${activeTab === "i18n" ? "active" : ""}">
              ${icon("globe", 'style="width:1rem;height:1rem"')} 界面翻译字典 (UI Translations) <span class="badge info sm">${totalKeysCount}</span>
            </button>
            <button id="tab-btn-doctor" class="cap-tab-btn ${activeTab === "doctor" ? "active" : ""}">
              ${icon("activity", 'style="width:1rem;height:1rem"')} 健康体检报告 (Doctor) ${doctorTabBadge}
            </button>
          </div>

          <!-- Tab Content Body -->
          <div class="cap-modal-body">
            ${
              activeTab === "overview"
                ? `
              <!-- Section 1: Custom fields -->
              <div style="margin-bottom:1.4rem;display:flex;align-items:flex-start;gap:.85rem">
                <div style="margin-top:.2rem;color:var(--muted-foreground)">${icon("file-text", 'style="width:1.4rem;height:1.4rem"')}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:1rem;margin-bottom:.3rem">
                    Custom fields <span class="muted text-xs" style="font-weight:normal">${fields.length} declared</span>
                  </div>
                  <div>${customFieldsHtml}</div>
                </div>
              </div>

              <!-- Section 2: Blocks or Tables -->
              <div style="margin-bottom:1.4rem;display:flex;align-items:flex-start;gap:.85rem">
                <div style="margin-top:.2rem;color:var(--muted-foreground)">${icon(isTheme ? "package" : "layers", 'style="width:1.4rem;height:1.4rem"')}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.35rem;margin-bottom:.3rem">
                    <div style="font-weight:600;font-size:1rem">
                      ${blocksOrTablesTitle} <span class="muted text-xs" style="font-weight:normal">${blocksOrTablesCount} declared</span>
                    </div>
                    ${
                      isTheme
                        ? `<div style="display:flex;gap:.5rem">
                            <a href="#/widgets" id="modal-goto-widgets" class="text-xs" style="color:var(--primary);display:inline-flex;align-items:center;gap:.25rem;text-decoration:none">
                              ${icon("layout-dashboard", 'style="width:.85rem;height:.85rem"')} 小部件管理 ↗
                            </a>
                          </div>`
                        : ""
                    }
                  </div>
                  <div>${blocksOrTablesHtml}</div>
                </div>
              </div>

              <!-- Section 3: UI Translations summary -->
              <div style="margin-bottom:1.4rem;display:flex;align-items:flex-start;gap:.85rem">
                <div style="margin-top:.2rem;color:var(--muted-foreground)">${icon("languages", 'style="width:1.4rem;height:1.4rem"')}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.35rem;margin-bottom:.3rem">
                    <div style="font-weight:600;font-size:1rem">
                      UI Translations <span class="muted text-xs" style="font-weight:normal">${totalKeysCount} declared keys across ${langCodes.length} languages</span>
                    </div>
                    <button id="modal-switch-to-i18n" class="btn ghost sm" style="color:var(--primary);font-size:.82rem;padding:0;height:auto">
                      查看完整字典与对照表 &gt;
                    </button>
                  </div>
                  <div style="margin-top:.4rem">${i18nBadgesHtml || '<span class="muted text-sm">暂无语言包</span>'}</div>
                </div>
              </div>

              <!-- Section 4: Hooks & Menus -->
              <div style="display:flex;align-items:flex-start;gap:.85rem">
                <div style="margin-top:.2rem;color:var(--muted-foreground)">${icon("puzzle", 'style="width:1.4rem;height:1.4rem"')}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.35rem;margin-bottom:.3rem">
                    <div style="font-weight:600;font-size:1rem">
                      Hooks &amp; Menus <span class="muted text-xs" style="font-weight:normal">${hooks.length} hook slots, ${menus.length} navigation menus</span>
                    </div>
                    <div style="display:flex;gap:.6rem">
                      <a href="#/menus" id="modal-goto-menus" class="text-xs" style="color:var(--primary);display:inline-flex;align-items:center;gap:.25rem;text-decoration:none">
                        ${icon("menu", 'style="width:.85rem;height:.85rem"')} 菜单管理 ↗
                      </a>
                    </div>
                  </div>
                  <div style="margin-top:.4rem">${hooksAndMenusHtml.join("")}</div>
                </div>
              </div>
            `
                : activeTab === "i18n"
                ? `
              <!-- Tab 2: UI Translations matrix -->
              <div>
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem;margin-bottom:1rem">
                  <input id="modal-i18n-search" type="search" placeholder="搜索翻译 Key 或词条内容..." value="${esc(searchQuery)}" style="flex:1;min-width:200px;max-width:340px;padding:.4rem .8rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.85rem" />
                  <span class="muted text-xs">共 ${filteredKeys.length} / ${totalKeysCount} 个翻译词条</span>
                </div>
                <div style="max-height:420px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border,#e2e8f0);border-radius:var(--radius-md,8px);-webkit-overflow-scrolling:touch">
                  <table class="table" style="margin:0;font-size:.85rem;min-width:480px">
                    <thead>
                      <tr style="position:sticky;top:0;background:var(--muted,#f8fafc);z-index:2">
                        <th style="width:38%">Translation Key</th>
                        ${langCodes.map((loc) => `<th>${esc(loc)}</th>`).join("")}
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        filteredKeys.length
                          ? filteredKeys.map((k) => `<tr>
                              <td><code style="font-size:.8rem;color:var(--primary,#2563eb)">${esc(k)}</code></td>
                              ${langCodes.map((loc) => `<td>${esc(translations[loc]?.[k] ?? "—")}</td>`).join("")}
                            </tr>`).join("")
                          : `<tr><td colspan="${langCodes.length + 1}" style="text-align:center;padding:2rem;color:var(--muted-foreground)">未找到匹配的翻译项</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            `
                : `
              <!-- Tab 3: Health & Doctor Inspection -->
              <div>
                ${
                  isChecking
                    ? `
                  <div style="text-align:center;padding:3rem 1rem">
                    <div class="spinner" style="width:2.5rem;height:2.5rem;margin:0 auto 1rem;border:3px solid #e2e8f0;border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite"></div>
                    <div style="font-size:1.05rem;font-weight:600">正在对 ${esc(title)} 执行深度自检与体检...</div>
                    <div class="muted text-sm" style="margin-top:.4rem">扫描 Rule 11 命名空间、Rule 41 多语言数据表契约、模板语法与物理文件完整性</div>
                  </div>
                `
                    : doctorError
                    ? `
                  <div style="padding:1.5rem;background:rgba(239, 68, 68, 0.12);border:1px solid rgba(239, 68, 68, 0.45);border-radius:8px;color:var(--foreground)">
                    <div style="font-weight:600;font-size:1.05rem;margin-bottom:.4rem;color:#ef4444">体检执行发生错误</div>
                    <div>${esc(doctorError)}</div>
                    <button id="modal-rerun-doctor-btn" class="btn primary sm" style="margin-top:1rem">重试体检</button>
                  </div>
                `
                    : doctorReport
                    ? `
                  <!-- Health Score Dashboard -->
                  <div class="cap-score-banner">
                    <div class="cap-score-main">
                      <div class="cap-score-circle" style="background:${
                        doctorReport.score >= 90 ? "#10b981" : doctorReport.score >= 70 ? "#3b82f6" : "#ef4444"
                      }">
                        <span style="font-size:1.6rem;line-height:1">${doctorReport.score}</span>
                        <span style="font-size:.65rem;opacity:.9">/ 100</span>
                      </div>
                      <div style="min-width:0;flex:1">
                        <div class="cap-score-title">
                          ${
                            doctorReport.score === 100
                              ? "✨ 极佳 (Optimal) — 完全符合规范"
                              : doctorReport.score >= 80
                              ? "✅ 健康良好 (Healthy) — 推荐部署"
                              : doctorReport.score >= 60
                              ? "⚠️ 存在隐患 (Attention) — 建议优化"
                              : "❌ 严重不合规 (Critical) — 存在阻断错误"
                          }
                        </div>
                        <div class="muted text-xs cap-score-sub">
                          已验证清单规范、Rule 11 隔离、Rule 41 多语言表设计及模板语法完整性
                        </div>
                      </div>
                    </div>
                    <div class="cap-score-actions">
                      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
                        <span class="badge ${doctorReport.summary.errors ? 'danger' : 'secondary'}">
                          ${doctorReport.summary.errors} 错误
                        </span>
                        <span class="badge ${doctorReport.summary.warnings ? 'warning' : 'secondary'}">
                          ${doctorReport.summary.warnings} 警告
                        </span>
                        <span class="badge info">
                          ${doctorReport.summary.infos} 建议
                        </span>
                      </div>
                      <button id="modal-rerun-doctor-btn" class="btn primary sm" style="display:inline-flex;align-items:center;gap:.35rem">
                        ${icon("refresh", 'style="width:.85rem;height:.85rem"')} 重新体检
                      </button>
                    </div>
                  </div>

                  <!-- Diagnostics Items -->
                  <div>
                    <h3 style="font-size:1rem;font-weight:600;margin:0 0 .75rem;color:var(--foreground)">结构化诊断详情 (Diagnostics)</h3>
                    ${
                      doctorReport.diagnostics.length === 0
                        ? `
                      <div style="padding:2rem;text-align:center;border:1px dashed rgba(16,185,129,.4);background:rgba(16,185,129,.1);border-radius:8px;color:var(--foreground)">
                        <div style="font-size:1.25rem;font-weight:600;margin-bottom:.35rem;color:#10b981">🎉 完美合规！</div>
                        <div style="font-size:.9rem;opacity:.9">未发现任何错误、警告或潜在隐患，该扩展已达到最高制作水准。</div>
                      </div>
                    `
                        : `
                      <div style="display:flex;flex-direction:column;gap:.75rem">
                        ${doctorReport.diagnostics.map((d) => {
                          const isErr = d.level === "error";
                          const isWarn = d.level === "warning";
                          const borderCol = isErr ? "rgba(239, 68, 68, 0.45)" : isWarn ? "rgba(245, 158, 11, 0.45)" : "rgba(59, 130, 246, 0.45)";
                          const bgCol = isErr ? "rgba(239, 68, 68, 0.12)" : isWarn ? "rgba(245, 158, 11, 0.12)" : "rgba(59, 130, 246, 0.12)";
                          const iconSym = isErr ? "❌" : isWarn ? "⚠️" : "ℹ️";
                          const badgeClass = isErr ? "danger" : isWarn ? "warning" : "info";
                          return `
                            <div class="cap-diag-card" style="border:1px solid ${borderCol};background:${bgCol}">
                              <div class="cap-diag-header">
                                <div class="cap-diag-title">
                                  <span>${iconSym}</span>
                                  <span>${esc(d.message)}</span>
                                  <span class="badge ${badgeClass} sm">${esc(d.code)}</span>
                                </div>
                                ${d.file ? `<code class="text-xs cap-diag-file">${esc(d.file)}</code>` : ""}
                              </div>
                              ${
                                d.suggestion
                                  ? `<div style="margin-top:.45rem;padding:.45rem .75rem;background:rgba(0,0,0,.15);border:1px solid rgba(255,255,255,.08);border-radius:6px;font-size:.85rem;color:var(--foreground);line-height:1.4;word-break:break-word">
                                      <strong>👉 修复指引：</strong> ${esc(d.suggestion)}
                                    </div>`
                                  : ""
                              }
                            </div>
                          `;
                        }).join("")}
                      </div>
                    `
                    }
                  </div>
                `
                    : `
                  <div style="text-align:center;padding:3rem 1rem">
                    <p class="muted">尚未对此扩展运行过体检。</p>
                    <button id="modal-rerun-doctor-btn" class="btn primary">立即运行全面体检</button>
                  </div>
                `
                }
              </div>
            `
            }
          </div>

          <!-- Modal Footer -->
          <div class="cap-modal-footer">
            <div class="cap-footer-info">
              ${
                isChecking
                  ? `<span class="spinner-sm"></span> 正在自检...`
                  : doctorReport
                  ? `
                    <div style="display:flex;align-items:center;gap:.4rem">
                      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${doctorReport.valid ? "#10b981" : "#ef4444"}"></span>
                      <span>健康度: <strong>${doctorReport.score}/100</strong> (${doctorReport.valid ? "合格" : "不合规"})</span>
                    </div>
                    <span>· ${doctorReport.summary.warnings} 警告</span>
                    <button id="modal-footer-rerun-btn" class="btn ghost sm" style="padding:2px 8px;height:auto;font-size:.78rem;color:var(--primary);margin-left:.25rem">
                      ${icon("refresh", 'style="width:.75rem;height:.75rem"')} 重新体检
                    </button>
                  `
                  : `
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8"></span>
                    <span>未执行体检</span>
                    <button id="modal-footer-rerun-btn" class="btn ghost sm" style="padding:2px 8px;height:auto;font-size:.78rem;color:var(--primary);margin-left:.25rem">
                      ${icon("activity", 'style="width:.75rem;height:.75rem"')} 运行检查
                    </button>
                  `
              }
            </div>
            <div class="cap-footer-btns">
              ${
                isTheme
                  ? `<button id="modal-tpl-btn" class="btn outline sm">${icon("code")}&lt;/&gt; 模板代码</button>`
                  : `<button id="modal-cfg-btn" class="btn outline sm">${icon("settings")} 插件配置</button>`
              }
              <button id="modal-close-btn" class="btn primary sm">关闭</button>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  function mount() {
    host.innerHTML = renderContent();

    // Event bindings
    const overlay = host.querySelector(".overlay");
    const closeBtn = host.querySelector("#modal-close-btn");
    const xCloseBtn = host.querySelector("#modal-x-close");
    const tabOverview = host.querySelector("#tab-btn-overview");
    const tabI18n = host.querySelector("#tab-btn-i18n");
    const tabDoctor = host.querySelector("#tab-btn-doctor");
    const switchToI18n = host.querySelector("#modal-switch-to-i18n");
    const tplBtn = host.querySelector("#modal-tpl-btn");
    const cfgBtn = host.querySelector("#modal-cfg-btn");
    const i18nSearch = host.querySelector("#modal-i18n-search");
    const rerunBtn = host.querySelector("#modal-rerun-doctor-btn");
    const footerRerunBtn = host.querySelector("#modal-footer-rerun-btn");

    const close = () => {
      host.innerHTML = "";
    };

    if (closeBtn) closeBtn.onclick = close;
    if (xCloseBtn) xCloseBtn.onclick = close;
    if (overlay) {
      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) close();
      });
    }

    if (tabOverview) {
      tabOverview.onclick = () => {
        activeTab = "overview";
        mount();
      };
    }
    if (tabI18n) {
      tabI18n.onclick = () => {
        activeTab = "i18n";
        mount();
      };
    }
    if (tabDoctor) {
      tabDoctor.onclick = () => {
        activeTab = "doctor";
        if (!doctorReport && !isChecking) {
          triggerDoctorInspection();
        } else {
          mount();
        }
      };
    }
    if (switchToI18n) {
      switchToI18n.onclick = () => {
        activeTab = "i18n";
        mount();
      };
    }

    if (rerunBtn) {
      rerunBtn.onclick = () => {
        triggerDoctorInspection();
      };
    }
    if (footerRerunBtn) {
      footerRerunBtn.onclick = () => {
        activeTab = "doctor";
        triggerDoctorInspection();
      };
    }

    if (tplBtn) {
      tplBtn.onclick = () => {
        close();
        state.page = `theme-assets:${name}`;
        window.location.hash = `#/theme-assets/${name}`;
      };
    }
    if (cfgBtn) {
      cfgBtn.onclick = () => {
        close();
        const ev = new CustomEvent("plugin-open-settings", { detail: { name } });
        document.dispatchEvent(ev);
      };
    }

    if (i18nSearch) {
      i18nSearch.oninput = (e) => {
        searchQuery = e.target.value;
        const tbody = host.querySelector("tbody");
        if (tbody) {
          const q = searchQuery.trim().toLowerCase();
          const fKeys = q
            ? allKeys.filter((k) => k.toLowerCase().includes(q) || langCodes.some((loc) => String(translations[loc]?.[k] || "").toLowerCase().includes(q)))
            : allKeys;
          tbody.innerHTML = fKeys.length
            ? fKeys.map((k) => `<tr>
                <td><code style="font-size:.8rem;color:var(--primary,#2563eb)">${esc(k)}</code></td>
                ${langCodes.map((loc) => `<td>${esc(translations[loc]?.[k] ?? "—")}</td>`).join("")}
              </tr>`).join("")
            : `<tr><td colspan="${langCodes.length + 1}" style="text-align:center;padding:2rem;color:var(--muted-foreground)">未找到匹配的翻译项</td></tr>`;
        }
      };
    }
  }

  mount();
}
