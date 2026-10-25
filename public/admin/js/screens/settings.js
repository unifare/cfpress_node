/**
 * Screen: Settings Center — structured two-column workbench for site & platform settings.
 *
 * Sections:
 *   1. General (`general`)         — site title, description, timezone, pagination, date/time formats
 *   2. Discussion (`discussion`)   — member registration & comment moderation policies
 *   3. Permalinks (`permalinks`)   — URL structure & redirects/rewrites (delegates to `urls.js`)
 *   4. SEO (`seo`)                 — SERP, OpenGraph, Schema, Webmaster & IndexNow (delegates to `seo.js`)
 *   5. Media (`media`)             — storage provider (R2 / imgbb / postimages) & API keys
 *   6. Features (`features`)       — per-site capability switches (delegates to `features.js`)
 *   7. Platform (`platform`)       — install-wide settings (`admin.path`, etc.), shown only with `platform.manage`
 */
import { api, scoped, state, adminBase } from "../state.js";
import { pageHead } from "../shell.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { allAt, fieldsAll, closestEl, attr, esc, toast, confirmDialog } from "../../ui.js";
import urls from "./urls.js";
import seo from "./seo.js";
import features from "./features.js";

let activeSettingsTab = "general";

/**
 * Write the platform-settings panel, and follow the admin if the prefix moved.
 *
 * Exported and taking its rows as an argument so `tests/suites/admin-spa.test.mjs`
 * can drive and verify the prefix move and refusal behavior directly.
 */
export async function savePlatformSettings(rows) {
  const failed = [];
  for (const { key, value } of rows) {
    try {
      await api("platform-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch (err) {
      failed.push(`${key}: ${err?.message || err}`);
    }
  }
  if (failed.length) {
    toast(t("core.msg.wentWrong", "Something went wrong") + ": " + failed.join(", "), "error");
    return { failed, moved: null };
  }
  toast(t("core.settings.platformSaved", "Platform settings saved"));
  const wanted = rows.find((r) => r.key === "admin.path")?.value;
  const moved = wanted != null && String(wanted) !== adminBase ? String(wanted) : null;
  if (moved) {
    const hash = typeof location === "undefined" ? "" : location.hash || "";
    if (typeof location !== "undefined" && typeof location.replace === "function") {
      location.replace(moved + "/" + hash);
    }
  }
  return { failed, moved };
}

const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const DATE_FORMATS = ["YYYY-MM-DD", "YYYY/MM/DD", "MM/DD/YYYY", "DD/MM/YYYY", "MMM D, YYYY"];
const TIME_FORMATS = ["HH:mm", "HH:mm:ss", "hh:mm A"];

export default async function settings(c) {
  const d = await api(scoped("settings"));
  const site = state.sites.find((s) => s.id === state.site);
  const items = d.items || [];
  /** @type {Record<string, string>} */
  const valMap = {};
  for (const x of items) {
    valMap[x.key] = String(x.value ?? "");
  }
  const getVal = (k, fallback = "") => (valMap[k] !== undefined && valMap[k] !== "" ? valMap[k] : fallback);

  // Parse `cfpress.media` JSON config
  let mediaCfg = { provider: "r2", require_session: false };
  try {
    const parsed = valMap["cfpress.media"] ? JSON.parse(valMap["cfpress.media"]) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      mediaCfg = {
        provider: parsed.provider || "r2",
        require_session: Boolean(parsed.require_session),
      };
    }
  } catch {
    mediaCfg = { provider: "r2", require_session: false };
  }

  // Platform settings are readable and writable only with `platform.manage`.
  let hasPlatform = false;
  let platformRows = [];
  try {
    const p = await api("platform-settings");
    platformRows = p.items || [];
    hasPlatform = true;
  } catch {
    hasPlatform = false;
  }

  if (activeSettingsTab === "platform" && !hasPlatform) {
    activeSettingsTab = "general";
  }

  const navTabs = [
    { id: "general", iconName: "settings", label: t("core.settings.tabGeneral", "General") },
    { id: "discussion", iconName: "message-square", label: t("core.settings.tabDiscussion", "Discussion & Members") },
    { id: "permalinks", iconName: "route", label: t("core.settings.tabPermalinks", "Permalinks & URLs") },
    { id: "seo", iconName: "chart", label: t("core.settings.tabSeo", "SEO & Search") },
    { id: "media", iconName: "image", label: t("core.settings.tabMedia", "Media & Storage") },
    { id: "features", iconName: "sliders-horizontal", label: t("core.settings.tabFeatures", "Feature Switches") },
    ...(hasPlatform
      ? [{ id: "platform", iconName: "landmark", label: t("core.settings.tabPlatform", "Platform & Security") }]
      : []),
  ];

  const curTz = getVal("site.timezone", "UTC");
  const tzOptions = COMMON_TIMEZONES.includes(curTz) ? COMMON_TIMEZONES : [curTz, ...COMMON_TIMEZONES];

  const curDateFmt = getVal("site.date_format", "YYYY-MM-DD");
  const dateFmtOptions = DATE_FORMATS.includes(curDateFmt) ? DATE_FORMATS : [curDateFmt, ...DATE_FORMATS];

  const curTimeFmt = getVal("site.time_format", "HH:mm");
  const timeFmtOptions = TIME_FORMATS.includes(curTimeFmt) ? TIME_FORMATS : [curTimeFmt, ...TIME_FORMATS];

  const generalPanelHtml = `
    <div class="panel" data-settings-panel="general"${activeSettingsTab === "general" ? "" : " hidden"}>
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.settings.generalTitle", "Site Identity & Regional Settings"))}</div>
          <div class="panel-desc">${esc(t("core.settings.generalDesc", "Basic site information, timezone, and pagination used across frontend templates."))}</div>
        </div>
        <button class="btn primary sm" type="button" data-action="save-settings">${icon("save")}<span>${esc(t("core.action.save", "Save"))}</span></button>
      </div>
      <div class="panel-body">
        <div class="field-grid">
          <div class="field">
            <label>${esc(t("core.settings.fieldSiteTitle", "Site Title"))}</label>
            <input type="text" class="input" data-key="site.title" value="${attr(getVal("site.title", site?.name || "CFPress"))}" />
            <div class="hint">${esc(t("core.settings.fieldSiteTitleHint", "Displayed in the browser title bar, header, and RSS feeds."))}</div>
          </div>
          <div class="field">
            <label>${esc(t("core.settings.fieldSiteDesc", "Tagline / Description"))}</label>
            <input type="text" class="input" data-key="site.description" value="${attr(getVal("site.description", ""))}" />
            <div class="hint">${esc(t("core.settings.fieldSiteDescHint", "In a few words, explain what this site is about."))}</div>
          </div>
        </div>

        <div class="field-grid" style="margin-top:1rem">
          <div class="field">
            <label>${esc(t("core.settings.fieldTimezone", "Timezone"))}</label>
            <select class="control" data-key="site.timezone">
              ${tzOptions.map((tz) => `<option value="${attr(tz)}"${tz === curTz ? " selected" : ""}>${esc(tz)}</option>`).join("")}
            </select>
            <div class="hint">${esc(t("core.settings.fieldTimezoneHint", "Used for scheduled publishing and displaying dates."))}</div>
          </div>
          <div class="field">
            <label>${esc(t("core.settings.fieldPostsPerPage", "Posts per page"))}</label>
            <input type="number" min="1" max="100" class="input" data-key="site.posts_per_page" value="${attr(getVal("site.posts_per_page", "10"))}" />
            <div class="hint">${esc(t("core.settings.fieldPostsPerPageHint", "Maximum number of posts shown on blog index and archive pages."))}</div>
          </div>
        </div>

        <div class="field-grid" style="margin-top:1rem">
          <div class="field">
            <label>${esc(t("core.settings.fieldDateFormat", "Date format"))}</label>
            <select class="control" data-key="site.date_format">
              ${dateFmtOptions.map((df) => `<option value="${attr(df)}"${df === curDateFmt ? " selected" : ""}>${esc(df)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>${esc(t("core.settings.fieldTimeFormat", "Time format"))}</label>
            <select class="control" data-key="site.time_format">
              ${timeFmtOptions.map((tf) => `<option value="${attr(tf)}"${tf === curTimeFmt ? " selected" : ""}>${esc(tf)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
    </div>`;

  const switchRowHtml = (key, defaultVal, titleKey, titleFb, hintKey, hintFb) => {
    const v = getVal(key, defaultVal);
    const isOn = v === "1" || v === "true";
    return `<div class="switch-row">
      <div class="switch-row-info">
        <div class="switch-row-title">${esc(t(titleKey, titleFb))}</div>
        <div class="switch-row-desc">${esc(t(hintKey, hintFb))}</div>
      </div>
      <div style="flex:none">
        <select class="control" style="width:7.5rem" data-key="${attr(key)}">
          <option value="1"${isOn ? " selected" : ""}>${esc(t("core.features.on", "On"))}</option>
          <option value="0"${!isOn ? " selected" : ""}>${esc(t("core.features.off", "Off"))}</option>
        </select>
      </div>
    </div>`;
  };

  const discussionPanelHtml = `
    <div class="panel" data-settings-panel="discussion"${activeSettingsTab === "discussion" ? "" : " hidden"}>
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.settings.discussionTitle", "Member Registration & Comments"))}</div>
          <div class="panel-desc">${esc(t("core.settings.discussionDesc", "Control visitor sign-ups, comment permissions, and moderation workflow."))}</div>
        </div>
        <button class="btn primary sm" type="button" data-action="save-settings">${icon("save")}<span>${esc(t("core.action.save", "Save"))}</span></button>
      </div>
      <div class="panel-body">
        ${switchRowHtml(
          "members.registration",
          "1",
          "core.settings.fieldMembersReg",
          "Allow front-end member registration",
          "core.settings.fieldMembersRegHint",
          "When enabled, visitors can sign up for a member account on this site."
        )}
        ${switchRowHtml(
          "comments.enabled",
          "1",
          "core.settings.fieldCommentsEnabled",
          "Enable article comments",
          "core.settings.fieldCommentsEnabledHint",
          "Allow visitors and members to post comments on published articles."
        )}
        ${switchRowHtml(
          "comments.require_member",
          "0",
          "core.settings.fieldCommentsMember",
          "Require member sign-in to comment",
          "core.settings.fieldCommentsMemberHint",
          "Only logged-in front-end members may submit comments (disables guest comments)."
        )}
        ${switchRowHtml(
          "comments.require_approval",
          "1",
          "core.settings.fieldCommentsApproval",
          "Require manual moderation before publishing",
          "core.settings.fieldCommentsApprovalHint",
          "New comments are held in the Pending queue until approved by an administrator."
        )}
      </div>
    </div>`;

  const mediaPanelHtml = `
    <div class="panel" data-settings-panel="media"${activeSettingsTab === "media" ? "" : " hidden"}>
      <div class="panel-header">
        <div>
          <div class="panel-title">${esc(t("core.media.storageTitle", "Storage"))}</div>
          <div class="panel-desc">${esc(t("core.media.storageDesc", "Where new uploads go. This site only — files already in the library stay where they are."))}</div>
        </div>
        <button class="btn primary sm" type="button" data-action="save-media-settings">${icon("save")}<span>${esc(t("core.media.storageSave", "Save storage"))}</span></button>
      </div>
      <div class="panel-body">
        <div class="field-grid">
          <div class="field">
            <label>${esc(t("core.media.storageTitle", "Storage"))}</label>
            <select class="control" id="settings-media-provider">
              <option value="r2"${mediaCfg.provider === "r2" ? " selected" : ""}>${esc(t("core.media.storageR2", "This server (R2)"))}</option>
              <option value="imgbb"${mediaCfg.provider === "imgbb" ? " selected" : ""}>${esc(t("core.media.storageImgbb", "imgbb"))}</option>
              <option value="postimages"${mediaCfg.provider === "postimages" ? " selected" : ""}>${esc(t("core.media.storagePostimages", "postimages.org"))}</option>
            </select>
          </div>
          <div class="field">
            <label>${esc(t("core.settings.mediaSessionReq", "Require active session to view uploaded media"))}</label>
            <select class="control" id="settings-media-session">
              <option value="0"${!mediaCfg.require_session ? " selected" : ""}>${esc(t("core.features.off", "Off"))}</option>
              <option value="1"${mediaCfg.require_session ? " selected" : ""}>${esc(t("core.features.on", "On"))}</option>
            </select>
            <div class="hint">${esc(t("core.settings.mediaSessionReqHint", "Restrict direct media file access to signed-in users only."))}</div>
          </div>
        </div>

        <div class="field-grid" style="margin-top:1rem">
          <div class="field">
            <label>${esc(t("core.media.storageImgbbKey", "imgbb API key"))}</label>
            <div class="row" style="gap:0.5rem">
              <input type="password" class="input" data-media-secret="cfpress.media.imgbb_key" autocomplete="off" placeholder="${attr(t("core.media.storageKeySet", "Saved — leave blank to keep it"))}" />
              <button type="button" class="btn outline sm" data-clear-media-key="cfpress.media.imgbb_key">${esc(t("core.media.storageKeyClear", "Clear"))}</button>
            </div>
          </div>
          <div class="field">
            <label>${esc(t("core.media.storagePostimagesKey", "postimages.org API key"))}</label>
            <div class="row" style="gap:0.5rem">
              <input type="password" class="input" data-media-secret="cfpress.media.postimages_key" autocomplete="off" placeholder="${attr(t("core.media.storageKeySet", "Saved — leave blank to keep it"))}" />
              <button type="button" class="btn outline sm" data-clear-media-key="cfpress.media.postimages_key">${esc(t("core.media.storageKeyClear", "Clear"))}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const platformFieldLabel = (key) => {
    if (key === "admin.path") return t("core.settings.platformAdminPath", "Admin panel URL prefix (admin.path)");
    if (key === "theme.max_binary_size_kb") return t("core.settings.platformMaxZip", "Max extension upload size (KB)");
    return key;
  };
  const platformFieldHint = (key) => {
    if (key === "admin.path") return t("core.settings.platformAdminPathHint", "Must start with / (e.g. /admin or /console). Moving the prefix hides the old path with 404.");
    if (key === "theme.max_binary_size_kb") return t("core.settings.platformMaxZipHint", "Maximum binary asset size allowed when installing themes or plugins.");
    return "";
  };

  const platformPanelHtml = hasPlatform
    ? `<div class="panel" data-settings-panel="platform"${activeSettingsTab === "platform" ? "" : " hidden"} style="border:1px solid var(--border)">
        <div class="panel-header">
          <div>
            <div class="panel-title">${esc(t("core.settings.platform", "Platform settings"))}</div>
            <div class="panel-desc">${esc(t("core.settings.platformDesc", "Install-wide. These apply to every site and are not affected by deleting one."))}</div>
          </div>
          ${platformRows.length ? `<button class="btn primary sm" type="button" data-action="save-platform-settings">${icon("save")}<span>${esc(t("core.settings.savePlatform", "Save platform settings"))}</span></button>` : ""}
        </div>
        <div class="panel-body">
          <div class="field-grid">
            ${platformRows
              .map((x) => {
                const hint = platformFieldHint(x.key);
                return `<div class="field">
                  <label>${esc(platformFieldLabel(x.key))}</label>
                  <input class="input" data-pkey="${attr(x.key)}" value="${attr(x.value ?? "")}">
                  ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}
                </div>`;
              })
              .join("")}
          </div>
        </div>
      </div>`
    : "";

  c.innerHTML = `${pageHead({
    title: t("core.nav.settingsCenter", "Settings"),
    sub: t("core.settings.sub", "Stored per site · {site}", { site: site?.name || state.site }),
    actions: `<button class="btn primary" data-action="save-settings">${icon("save")}${esc(t("core.settings.saveAll", "Save all"))}</button>`,
    crumbs: [{ label: t("core.nav.tools", "Tools") }, { label: t("core.nav.settingsCenter", "Settings") }],
  })}
  <div class="settings-layout">
    <nav class="settings-nav" role="tablist">
      ${navTabs
        .map(
          (tab) => `<button type="button" class="settings-nav-item${activeSettingsTab === tab.id ? " active" : ""}" data-settings-tab="${attr(tab.id)}">
            ${icon(tab.iconName)}
            <span>${esc(tab.label)}</span>
          </button>`
        )
        .join("")}
    </nav>
    <div class="settings-body">
      ${generalPanelHtml}
      ${discussionPanelHtml}
      <div class="settings-embedded" id="settings-permalinks-mount" data-settings-panel="permalinks"${activeSettingsTab === "permalinks" ? "" : " hidden"}></div>
      <div class="settings-embedded" id="settings-seo-mount" data-settings-panel="seo"${activeSettingsTab === "seo" ? "" : " hidden"}></div>
      ${mediaPanelHtml}
      <div class="settings-embedded" id="settings-features-mount" data-settings-panel="features"${activeSettingsTab === "features" ? "" : " hidden"}></div>
      ${platformPanelHtml}
      <p class="muted text-sm">${esc(t("core.settings.storedPerSite", "Settings are stored per site. Switch sites from the sidebar to edit another one."))}</p>
    </div>
  </div>`;

  async function mountDelegatedTab(tabId) {
    if (tabId === "permalinks") {
      const m = c.querySelector("#settings-permalinks-mount");
      if (m && !m.innerHTML) await urls(m);
    } else if (tabId === "seo") {
      const m = c.querySelector("#settings-seo-mount");
      if (m && !m.innerHTML) await seo(m);
    } else if (tabId === "features") {
      const m = c.querySelector("#settings-features-mount");
      if (m && !m.innerHTML) await features(m);
    }
  }

  await mountDelegatedTab(activeSettingsTab);
}

document.addEventListener("click", async (e) => {
  const tabBtn = closestEl(e, "[data-settings-tab]");
  if (tabBtn) {
    const nextTab = tabBtn.dataset.settingsTab;
    if (!nextTab) return;
    activeSettingsTab = nextTab;
    const layout = /** @type {HTMLElement|null} */ (tabBtn.closest(".settings-layout"));
    if (layout) {
      for (const b of allAt("[data-settings-tab]", layout)) {
        b.classList.toggle("active", b.dataset.settingsTab === nextTab);
      }
      for (const p of allAt("[data-settings-panel]", layout)) {
        p.hidden = p.dataset.settingsPanel !== nextTab;
      }
      if (nextTab === "permalinks") {
        const m = layout.querySelector("#settings-permalinks-mount");
        if (m && !m.innerHTML) await urls(m);
      } else if (nextTab === "seo") {
        const m = layout.querySelector("#settings-seo-mount");
        if (m && !m.innerHTML) await seo(m);
      } else if (nextTab === "features") {
        const m = layout.querySelector("#settings-features-mount");
        if (m && !m.innerHTML) await features(m);
      }
    }
    return;
  }

  const clearKeyBtn = closestEl(e, "[data-clear-media-key]");
  if (clearKeyBtn) {
    const key = clearKeyBtn.dataset.clearMediaKey;
    if (!key) return;
    const ok = await confirmDialog({
      title: t("core.media.storageKeyClearTitle", "Remove this API key?"),
      description: t("core.media.storageKeyClearDesc", "Uploads to this host will stop working until a key is entered again. Files already uploaded stay where they are."),
      confirmLabel: t("core.media.storageKeyClear", "Clear"),
      danger: true,
    });
    if (ok) {
      await api(`${scoped("settings")}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
      toast(t("core.media.storageKeyCleared", "Key removed"));
    }
    return;
  }

  const a = closestEl(e, "[data-action]");
  if (!a) return;
  if (a.dataset.action === "save-settings") {
    for (const el of fieldsAll("[data-key]")) {
      await api(scoped("settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: el.dataset.key, value: el.value }),
      });
    }
    toast(t("core.settings.saved", "Settings saved"));
    return;
  }
  if (a.dataset.action === "save-media-settings") {
    const provEl = /** @type {HTMLSelectElement|null} */ (document.querySelector("#settings-media-provider"));
    const sessEl = /** @type {HTMLSelectElement|null} */ (document.querySelector("#settings-media-session"));
    const provider = provEl ? provEl.value : "r2";
    const require_session = sessEl ? sessEl.value === "1" : false;
    await api(scoped("settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "cfpress.media",
        value: JSON.stringify({ provider, require_session }),
      }),
    });
    for (const secEl of fieldsAll("[data-media-secret]")) {
      const val = String(secEl.value ?? "").trim();
      if (val) {
        await api(scoped("settings"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: secEl.dataset.mediaSecret, value: val }),
        });
        secEl.value = "";
      }
    }
    toast(t("core.media.storageSaved", "Storage saved"));
    return;
  }
  if (a.dataset.action === "save-platform-settings") {
    const rows = [];
    for (const el of fieldsAll("[data-pkey]")) rows.push({ key: el.dataset.pkey, value: el.value });
    await savePlatformSettings(rows);
    return;
  }
  if (a.dataset.action === "seed-demo") {
    if (!confirm(t("core.settings.seedDemo.confirm", "Restore the demo content? This writes the demo articles and the About page (fixed ids)."))) return;
    let written = 0;
    const failed = [];
    for (const key of ["hello", "second", "edge", "templates", "i18n", "about"]) {
      try {
        const r = await api(scoped("seed-demo"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        if (r.written) written += r.written;
        if (r.failed) failed.push(...r.failed);
      } catch (err) {
        failed.push(`${key}: ${err?.message || err}`);
      }
    }
    if (failed.length) {
      toast(t("core.settings.seedDemo.done", "Demo content written: {written} version(s)", { written }) + " — " + failed.join(", "));
    } else {
      toast(t("core.settings.seedDemo.done", "Demo content written: {written} version(s)", { written }));
    }
  }
});
