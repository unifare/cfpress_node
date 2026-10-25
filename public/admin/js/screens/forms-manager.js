/**
 * Screen: Custom Forms Manager & Visual Form Builder.
 *
 * Provides:
 *   1. Form list management (create, edit, delete, copy shortcode).
 *   2. Modern visual drag/click form builder (toolbox, canvas, inspector).
 *   3. Field types: text, textarea, select, radio, checkbox, number, email, phone, date.
 *   4. Submissions viewer with payload inspection.
 *   5. Full localization via t().
 */

import { api, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { closestEl, alertDialog, confirmDialog, emptyRow, esc, fmtDate, toast, openDialog } from "../../ui.js";
import { t } from "../i18n.js";

// Active builder state in-memory
let builderMode = "list"; // 'list' | 'builder' | 'submissions'
let activeFormSlug = "";
let subSearchQuery = "";
let subSelectedIds = new Set();
let allSubmissionsCached = [];
/** @type {any} */
let currentForm = {
  name: "Contact Us",
  slug: "contact-us",
  description: "Get in touch with our team",
  fields: [
    { key: "name", type: "text", label: "Full Name", placeholder: "e.g. John Doe", required: true },
    { key: "email", type: "email", label: "Email Address", placeholder: "john@example.com", required: true },
    { key: "phone", type: "phone", label: "Phone Number", placeholder: "+1 (555) 000-0000", required: false },
    { key: "message", type: "textarea", label: "Message", placeholder: "How can we help you?", required: true },
  ],
  settings: {
    submit_label: "Send Message",
    success_message: "Thank you! Your message has been sent successfully.",
    redirect_url: "",
    honeypot_enabled: true,
  },
};
let selectedFieldIndex = 0;

export default async function formsManager(c) {
  const activeSiteId = state.site || "default";

  // Check if we are in builder mode or list mode
  if (builderMode === "builder") {
    renderBuilder(c, activeSiteId);
    return;
  }

  if (builderMode === "submissions") {
    await renderSubmissions(c, activeSiteId);
    return;
  }

  // List mode: Fetch forms for this site
  let forms = [];
  try {
    const res = await api(`tables/forms?site=${activeSiteId}&limit=100`);
    forms = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
  } catch {
    forms = [];
  }

  const rows = forms.length === 0
    ? emptyRow(5, t("plugin.forms.noForms", "No custom forms created yet. Click 'Create Form' to build one!"))
    : forms.map((f) => {
        let fieldCount = 0;
        try {
          const raw = f.fields_schema || f.schema_json || "[]";
          fieldCount = JSON.parse(raw).length;
        } catch {}
        const shortcodeText = `[form id="${f.slug}"]`;
        return `
          <tr>
            <td style="font-weight:600">
              <div style="display:flex;align-items:center;gap:.5rem">
                ${icon("layout-dashboard")}
                <span>${esc(f.name || f.title || f.slug)}</span>
              </div>
              <div class="muted text-sm" style="font-weight:normal;margin-top:.2rem">${esc(f.description || "")}</div>
            </td>
            <td><code style="font-size:.85rem;background:var(--accent);padding:.2rem .4rem;border-radius:var(--radius)">${esc(f.slug)}</code></td>
            <td><span class="badge secondary">${fieldCount} ${esc(t("plugin.forms.fieldsBadge", "fields"))}</span></td>
            <td>
              <button class="btn outline sm" data-action="copy-shortcode" data-code="${esc(shortcodeText)}" style="gap:.3rem;height:1.75rem;font-size:.78rem">
                ${icon("copy")}${esc(shortcodeText)}
              </button>
            </td>
            <td style="text-align:right">
              <div style="display:flex;justify-content:flex-end;gap:.4rem">
                <button class="btn outline sm" data-action="edit-form" data-slug="${esc(f.slug)}" title="${esc(t("core.action.edit", "Edit"))}">
                  ${icon("pencil")}${esc(t("core.action.edit", "Edit"))}
                </button>
                <button class="btn outline sm" data-action="view-submissions" data-slug="${esc(f.slug)}" title="${esc(t("plugin.forms.viewSubmissions", "Submissions"))}">
                  ${icon("file-text")}${esc(t("plugin.forms.submissionsBtn", "Submissions"))}
                </button>
                <button class="btn outline sm danger" data-action="delete-form" data-slug="${esc(f.slug)}" data-id="${esc(f.id || f.slug)}">
                  ${icon("trash")}
                </button>
              </div>
            </td>
          </tr>`;
      }).join("");

  c.innerHTML = `${pageHead({
    title: t("plugin.forms.title", "Custom Forms & Builder"),
    sub: t("plugin.forms.sub", "Create visual forms, manage submissions, and embed forms as widgets or shortcodes."),
    crumbs: [{ label: t("core.nav.extensions", "Extensions") }, { label: t("plugin.forms.title", "Forms") }],
  })}

  <div style="display:flex;flex-direction:column;gap:1.5rem">
    <!-- Top Action Card -->
    <div class="panel" style="background:var(--card);border:1px solid var(--border)">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem">
        <div>
          <h2 style="font-size:1.05rem;font-weight:700;margin:0 0 .25rem">${esc(t("plugin.forms.listTitle", "All Forms"))}</h2>
          <div class="muted text-sm">${esc(t("plugin.forms.listSub", "Forms defined for this site. Embed in pages using shortcode or as a sidebar widget."))}&nbsp;(${forms.length} ${esc(t("core.apiKeys.totalKeys", "total"))})</div>
        </div>
        <button class="btn primary" data-action="new-form" style="gap:.4rem">
          ${icon("plus")}${esc(t("plugin.forms.createBtn", "Create New Form"))}
        </button>
      </div>
    </div>

    <!-- Forms List Table -->
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${esc(t("plugin.forms.colName", "Form Name"))}</th>
              <th>${esc(t("plugin.forms.colSlug", "Slug / ID"))}</th>
              <th>${esc(t("plugin.forms.colFields", "Fields"))}</th>
              <th>${esc(t("plugin.forms.colShortcode", "Shortcode"))}</th>
              <th style="width:14rem;text-align:right">${esc(t("core.action.actions", "Actions"))}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/**
 * Renders the Visual Form Builder UI (Toolbox + Canvas + Inspector).
 */
function renderBuilder(c, activeSiteId) {
  const selectedField = currentForm.fields[selectedFieldIndex] || null;

  const toolboxItems = [
    { type: "text", label: "Single-line Text", icon: "file-text" },
    { type: "textarea", label: "Paragraph Text", icon: "file-text" },
    { type: "email", label: "Email Address", icon: "sparkles" },
    { type: "phone", label: "Phone Number", icon: "sparkles" },
    { type: "number", label: "Number Input", icon: "sparkles" },
    { type: "select", label: "Dropdown Select", icon: "chevron-down" },
    { type: "radio", label: "Radio Buttons", icon: "circle-check" },
    { type: "checkbox", label: "Checkboxes", icon: "check" },
    { type: "date", label: "Date Picker", icon: "sparkles" },
  ];

  const canvasFieldsHtml = currentForm.fields.length === 0
    ? `<div style="text-align:center;padding:3rem 1.5rem;color:var(--muted-foreground);border:2px dashed var(--border);border-radius:var(--radius)">${esc(t("plugin.forms.emptyCanvas", "Canvas is empty. Click any control on the left toolbox to add fields!"))}</div>`
    : currentForm.fields.map((f, idx) => {
        const isSelected = idx === selectedFieldIndex;
        const borderStyle = isSelected ? "2px solid var(--primary)" : "1px solid var(--border)";
        const bgStyle = isSelected ? "var(--accent)" : "var(--card)";
        return `
          <div class="cfp-builder-field" data-index="${idx}" style="background:${bgStyle};border:${borderStyle};border-radius:var(--radius);padding:.85rem 1rem;margin-bottom:.75rem;cursor:pointer;transition:all .15s">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="display:flex;align-items:center;gap:.5rem">
                <span class="badge outline" style="font-size:.7rem;text-transform:uppercase">${esc(f.type)}</span>
                <strong style="font-size:.9rem">${esc(f.label)}</strong>
                ${f.required ? '<span style="color:var(--destructive);font-weight:bold">*</span>' : ''}
              </div>
              <div style="display:flex;align-items:center;gap:.25rem" onclick="event.stopPropagation()">
                <button class="btn outline sm" data-action="field-up" data-index="${idx}" ${idx === 0 ? "disabled" : ""} title="Move Up" style="height:1.5rem;padding:0 .35rem">
                  ${icon("arrow-up")}
                </button>
                <button class="btn outline sm" data-action="field-down" data-index="${idx}" ${idx === currentForm.fields.length - 1 ? "disabled" : ""} title="Move Down" style="height:1.5rem;padding:0 .35rem">
                  ${icon("arrow-down")}
                </button>
                <button class="btn outline sm danger" data-action="field-delete" data-index="${idx}" title="Delete" style="height:1.5rem;padding:0 .35rem">
                  ${icon("trash")}
                </button>
              </div>
            </div>
            <div class="muted text-sm" style="margin-top:.35rem;font-family:monospace;font-size:.78rem">
              name="${esc(f.key)}" · placeholder="${esc(f.placeholder || 'none')}"
            </div>
          </div>`;
      }).join("");

  // Inspector options editor for select/radio/checkbox
  let optionsEditorHtml = "";
  if (selectedField && ["select", "radio", "checkbox"].includes(selectedField.type)) {
    const opts = (selectedField.options || []).map((opt, oIdx) => `
      <div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem">
        <input type="text" value="${esc(opt.label)}" data-opt-idx="${oIdx}" data-opt-prop="label" placeholder="Label" style="flex:1;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.85rem">
        <input type="text" value="${esc(opt.value)}" data-opt-idx="${oIdx}" data-opt-prop="value" placeholder="Value" style="flex:1;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.85rem">
        <button class="btn outline sm danger" data-action="delete-option" data-opt-idx="${oIdx}" style="height:1.75rem;padding:0 .4rem">${icon("trash")}</button>
      </div>
    `).join("");

    optionsEditorHtml = `
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <label style="font-size:.85rem;font-weight:600">${esc(t("plugin.forms.fieldOptions", "Choices / Options"))}</label>
          <button class="btn outline sm" data-action="add-option" style="height:1.5rem;font-size:.75rem">${icon("plus")}${esc(t("plugin.forms.addOption", "Add"))}</button>
        </div>
        ${opts}
      </div>`;
  }

  c.innerHTML = `
    ${pageHead({
      title: t("plugin.forms.builderTitle", "Visual Form Builder"),
      sub: `${esc(currentForm.name)} (${esc(currentForm.slug)})`,
      crumbs: [
        { label: t("plugin.forms.title", "Forms") },
        { label: esc(currentForm.name) }
      ],
      actions: [
        `<button class="btn outline" data-action="cancel-builder" style="gap:.35rem">${icon("chevron-left")}${esc(t("core.action.cancel", "Back to List"))}</button>`,
        `<button class="btn primary" data-action="save-form" style="gap:.35rem">${icon("check")}${esc(t("core.action.save", "Save Form"))}</button>`,
      ].join(" ")
    })}

    <!-- 3-Column Layout: Toolbox | Canvas | Inspector -->
    <div style="display:grid;grid-template-columns:15rem 1fr 20rem;gap:1.25rem;align-items:start">
      <!-- 1. Left Toolbox -->
      <div class="panel" style="padding:1rem">
        <h3 style="font-size:.9rem;font-weight:700;margin:0 0 .75rem">${esc(t("plugin.forms.toolboxTitle", "Add Fields"))}</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          ${toolboxItems.map((item) => `
            <button class="btn outline" data-action="add-field-type" data-type="${esc(item.type)}" style="justify-content:flex-start;padding:.6rem .75rem;font-size:.85rem;gap:.5rem">
              ${icon(item.icon)}${esc(item.label)}
            </button>
          `).join("")}
        </div>
      </div>

      <!-- 2. Center Canvas -->
      <div class="panel" style="padding:1.25rem;background:var(--card);min-height:30rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)">
          <div>
            <h2 style="font-size:1rem;font-weight:700;margin:0">${esc(currentForm.name)}</h2>
            <div class="muted text-sm">${esc(currentForm.description)}</div>
          </div>
          <span class="badge secondary">${currentForm.fields.length} ${esc(t("plugin.forms.fieldsBadge", "fields"))}</span>
        </div>
        <div id="cfp-builder-canvas">
          ${canvasFieldsHtml}
        </div>
      </div>

      <!-- 3. Right Inspector & Global Settings -->
      <div style="display:flex;flex-direction:column;gap:1.25rem">
        <!-- Field Properties Panel -->
        <div class="panel" style="padding:1.15rem">
          <h3 style="font-size:.9rem;font-weight:700;margin:0 0 .85rem;display:flex;align-items:center;gap:.4rem">
            ${icon("settings")}${esc(t("plugin.forms.inspectorTitle", "Field Properties"))}
          </h3>
          ${selectedField ? `
            <div style="display:flex;flex-direction:column;gap:.75rem">
              <div>
                <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.fieldLabel", "Label"))}</label>
                <input type="text" id="prop-field-label" value="${esc(selectedField.label)}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
              </div>
              <div>
                <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.fieldKey", "Field Key (name)"))}</label>
                <input type="text" id="prop-field-key" value="${esc(selectedField.key)}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
              </div>
              <div>
                <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.fieldPlaceholder", "Placeholder"))}</label>
                <input type="text" id="prop-field-placeholder" value="${esc(selectedField.placeholder || '')}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
              </div>
              <div>
                <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.fieldHelp", "Help Text"))}</label>
                <input type="text" id="prop-field-help" value="${esc(selectedField.help || '')}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
              </div>
              <div style="display:flex;align-items:center;gap:.5rem;margin-top:.25rem">
                <input type="checkbox" id="prop-field-required" ${selectedField.required ? "checked" : ""}>
                <label for="prop-field-required" style="font-size:.85rem;cursor:pointer;font-weight:600">${esc(t("plugin.forms.fieldRequired", "Required field"))}</label>
              </div>
              ${optionsEditorHtml}
            </div>
          ` : `<div class="muted text-sm">${esc(t("plugin.forms.selectFieldHint", "Click any field in the center canvas to configure its properties."))}</div>`}
        </div>

        <!-- Form Global Settings Panel -->
        <div class="panel" style="padding:1.15rem">
          <h3 style="font-size:.9rem;font-weight:700;margin:0 0 .85rem;display:flex;align-items:center;gap:.4rem">
            ${icon("sliders-horizontal")}${esc(t("plugin.forms.formSettingsTitle", "Form Settings"))}
          </h3>
          <div style="display:flex;flex-direction:column;gap:.75rem">
            <div>
              <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.formName", "Form Name"))}</label>
              <input type="text" id="prop-form-name" value="${esc(currentForm.name)}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
            </div>
            <div>
              <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.formSlug", "Form Slug"))}</label>
              <input type="text" id="prop-form-slug" value="${esc(currentForm.slug)}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
            </div>
            <div>
              <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.submitButtonText", "Submit Button Text"))}</label>
              <input type="text" id="prop-form-submit-label" value="${esc(currentForm.settings.submit_label || 'Submit')}" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem">
            </div>
            <div>
              <label style="display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem">${esc(t("plugin.forms.successMsg", "Success Message"))}</label>
              <textarea id="prop-form-success-msg" style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.85rem;min-height:3.5rem">${esc(currentForm.settings.success_message || '')}</textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach live property listeners
  const fieldLabelInput = c.querySelector("#prop-field-label");
  if (fieldLabelInput && selectedField) {
    fieldLabelInput.addEventListener("input", (e) => {
      selectedField.label = e.target.value;
      const card = c.querySelector(`.cfp-builder-field[data-index="${selectedFieldIndex}"] strong`);
      if (card) card.textContent = selectedField.label;
    });
  }

  const fieldKeyInput = c.querySelector("#prop-field-key");
  if (fieldKeyInput && selectedField) {
    fieldKeyInput.addEventListener("input", (e) => {
      selectedField.key = e.target.value;
    });
  }

  const fieldReqInput = c.querySelector("#prop-field-required");
  if (fieldReqInput && selectedField) {
    fieldReqInput.addEventListener("change", (e) => {
      selectedField.required = e.target.checked;
    });
  }

  const formNameInput = c.querySelector("#prop-form-name");
  if (formNameInput) {
    formNameInput.addEventListener("input", (e) => {
      currentForm.name = e.target.value;
    });
  }

  const formSlugInput = c.querySelector("#prop-form-slug");
  if (formSlugInput) {
    formSlugInput.addEventListener("input", (e) => {
      currentForm.slug = e.target.value;
    });
  }

  const formSubmitLabelInput = c.querySelector("#prop-form-submit-label");
  if (formSubmitLabelInput) {
    formSubmitLabelInput.addEventListener("input", (e) => {
      currentForm.settings.submit_label = e.target.value;
    });
  }

  const formSuccessMsgInput = c.querySelector("#prop-form-success-msg");
  if (formSuccessMsgInput) {
    formSuccessMsgInput.addEventListener("input", (e) => {
      currentForm.settings.success_message = e.target.value;
    });
  }
}

/**
 * Renders the submissions view for the active form.
 */
/**
 * Renders the submissions view for the active form with rich management features.
 */
async function renderSubmissions(c, activeSiteId) {
  try {
    const res = await api(`tables/submissions?site=${activeSiteId}&limit=500`);
    allSubmissionsCached = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
  } catch {
    allSubmissionsCached = [];
  }

  // Filter by active form (if set and not 'all')
  let filtered = allSubmissionsCached;
  if (activeFormSlug && activeFormSlug !== "all") {
    filtered = filtered.filter((s) => s.form_slug === activeFormSlug || s.form_id === activeFormSlug);
  }

  // Filter by search query
  if (subSearchQuery.trim()) {
    const q = subSearchQuery.trim().toLowerCase();
    filtered = filtered.filter((s) => {
      const idMatch = String(s.slug || s.id || "").toLowerCase().includes(q);
      const formMatch = String(s.form_slug || s.form_id || "").toLowerCase().includes(q);
      const payloadMatch = String(s.payload || "").toLowerCase().includes(q);
      return idMatch || formMatch || payloadMatch;
    });
  }

  const allSelected = filtered.length > 0 && filtered.every((s) => subSelectedIds.has(s.id || s.slug));

  const rows = filtered.length === 0
    ? emptyRow(6, t("plugin.forms.noSubmissions", "No submissions recorded yet."))
    : filtered.map((s) => {
        const id = s.id || s.slug;
        const isChecked = subSelectedIds.has(id);
        let payloadObj = {};
        try { payloadObj = JSON.parse(s.payload || "{}"); } catch {}
        const entries = Object.entries(payloadObj);
        const payloadSummary = entries.length === 0
          ? '<span class="muted" style="font-size:.825rem">Empty</span>'
          : entries.slice(0, 3).map(([k, v]) => `
              <span class="badge secondary" style="font-size:11px;padding:.15rem .45rem;max-width:18rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block">
                <strong>${esc(k)}:</strong> ${esc(String(v ?? ""))}
              </span>
            `).join(" ") + (entries.length > 3 ? ` <span class="muted text-xs">+${entries.length - 3}</span>` : "");

        return `
          <tr class="${isChecked ? "row-selected" : ""}" style="${isChecked ? "background:oklch(from var(--primary) l c h / 0.06)" : ""}">
            <td style="width:2.5rem;text-align:center">
              <input type="checkbox" class="sub-row-check" data-id="${esc(id)}" ${isChecked ? "checked" : ""}>
            </td>
            <td style="font-family:monospace;font-size:.825rem;font-weight:600;color:var(--foreground)">
              ${esc(id)}
            </td>
            <td>
              <span class="badge outline" style="font-size:11px">${esc(s.form_slug || activeFormSlug || "default")}</span>
            </td>
            <td>
              <div style="display:flex;flex-wrap:wrap;gap:.35rem;align-items:center">
                ${payloadSummary}
              </div>
            </td>
            <td style="font-size:.825rem;color:var(--muted-foreground);white-space:nowrap">
              ${esc(fmtDate(s.created_at))}
            </td>
            <td style="text-align:right;white-space:nowrap">
              <div style="display:inline-flex;gap:.35rem;align-items:center">
                <button type="button" class="btn ghost sm" data-action="view-submission-detail" data-id="${esc(id)}" title="${esc(t("plugin.forms.viewDetail", "View Details"))}">
                  ${icon("eye")}
                </button>
                <button type="button" class="btn ghost sm danger" data-action="delete-submission" data-id="${esc(id)}" title="${esc(t("core.action.delete", "Delete"))}">
                  ${icon("trash")}
                </button>
              </div>
            </td>
          </tr>`;
      }).join("");

  const pageActions = [
    `<button type="button" class="btn outline sm" data-action="export-submissions-csv" style="gap:.4rem">
      ${icon("download")}${esc(t("plugin.forms.exportCsv", "Export CSV"))}
    </button>`,
  ];

  if (subSelectedIds.size > 0) {
    pageActions.unshift(
      `<button type="button" class="btn danger sm" data-action="batch-delete-submissions" style="gap:.4rem">
        ${icon("trash")}${esc(t("plugin.forms.batchDelete", "Batch Delete"))} (${subSelectedIds.size})
      </button>`
    );
  }

  pageActions.push(
    `<button type="button" class="btn outline sm" data-action="cancel-builder" style="gap:.35rem">
      ${icon("chevron-left")}${esc(t("core.action.cancel", "Back to Forms"))}
    </button>`
  );

  c.innerHTML = `${pageHead({
    title: `${t("plugin.forms.submissionsBtn", "Submissions")}: ${esc(activeFormSlug || t("plugin.forms.allForms", "All Forms"))}`,
    sub: t("plugin.forms.subViewSub", "View and audit user submissions received through this form."),
    crumbs: [
      { label: t("plugin.forms.title", "Forms") },
      { label: esc(activeFormSlug || t("plugin.forms.allForms", "All Forms")) },
      { label: t("plugin.forms.submissionsBtn", "Submissions") }
    ],
    actions: pageActions.join(" "),
  })}

  <!-- Search & Filter Toolbar -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
    <div style="position:relative;flex:1;max-width:24rem">
      <div style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:var(--muted-foreground);pointer-events:none;display:flex;align-items:center">
        ${icon("search")}
      </div>
      <input type="search" id="sub-search-input" value="${esc(subSearchQuery)}" placeholder="${esc(t("plugin.forms.searchSubmissions", "Search submissions by field, value or ID..."))}"
        style="width:100%;padding-left:2.35rem;height:2.3rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--background);color:var(--foreground);font-size:.875rem">
    </div>
    <div style="font-size:.825rem;color:var(--muted-foreground)">
      <span>共 <strong>${filtered.length}</strong> 条记录</span>
      ${subSelectedIds.size > 0 ? `<span style="margin-left:.75rem;color:var(--primary);font-weight:600">已选中 ${subSelectedIds.size} 条</span>` : ""}
    </div>
  </div>

  <div class="panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:2.5rem;text-align:center">
              <input type="checkbox" id="sub-select-all" ${allSelected ? "checked" : ""}>
            </th>
            <th style="width:11rem">${esc(t("plugin.forms.colSubId", "ID"))}</th>
            <th style="width:9rem">${esc(t("plugin.forms.colName", "Form"))}</th>
            <th>${esc(t("plugin.forms.colPayload", "Submitted Data"))}</th>
            <th style="width:10rem">${esc(t("plugin.forms.colDate", "Date"))}</th>
            <th style="width:6rem;text-align:right">${esc(t("core.action.actions", "Actions"))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>`;

  // Bind live search input handler
  const searchInput = c.querySelector("#sub-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      subSearchQuery = e.target.value;
      renderSubmissions(c, activeSiteId);
    });
  }

  // Bind select all checkbox
  const selectAllCb = c.querySelector("#sub-select-all");
  if (selectAllCb) {
    selectAllCb.addEventListener("change", (e) => {
      if (e.target.checked) {
        filtered.forEach((s) => subSelectedIds.add(s.id || s.slug));
      } else {
        filtered.forEach((s) => subSelectedIds.delete(s.id || s.slug));
      }
      renderSubmissions(c, activeSiteId);
    });
  }

  // Bind row checkboxes
  c.querySelectorAll(".sub-row-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        subSelectedIds.add(id);
      } else {
        subSelectedIds.delete(id);
      }
      renderSubmissions(c, activeSiteId);
    });
  });
}

// Global click event dispatcher for forms-manager screen
document.addEventListener("click", async (e) => {
  const btn = closestEl(e, "[data-action]");
  const canvasCard = closestEl(e, ".cfp-builder-field");

  // Selecting a canvas field in builder mode
  if (canvasCard && !btn) {
    const idx = parseInt(canvasCard.dataset.index, 10);
    if (!isNaN(idx)) {
      selectedFieldIndex = idx;
      render();
    }
    return;
  }

  if (!btn) return;

  const action = btn.dataset.action;

  if (action === "copy-shortcode") {
    const code = btn.dataset.code || "";
    try {
      await navigator.clipboard.writeText(code);
      toast(t("plugin.forms.copiedToast", "Shortcode copied to clipboard!"));
    } catch {
      prompt(t("core.apiKeys.copyManual", "Copy to clipboard:"), code);
    }
    return;
  }

  if (action === "new-form") {
    activeFormSlug = "";
    currentForm = {
      name: "New Contact Form",
      slug: `form-${Date.now().toString().slice(-4)}`,
      description: "Submit inquiries or feedback",
      fields: [
        { key: "name", type: "text", label: "Full Name", placeholder: "e.g. John Doe", required: true },
        { key: "email", type: "email", label: "Email Address", placeholder: "john@example.com", required: true },
        { key: "message", type: "textarea", label: "Message", placeholder: "Your inquiry...", required: true },
      ],
      settings: {
        submit_label: "Submit Form",
        success_message: "Thank you! Your submission has been received.",
        redirect_url: "",
        honeypot_enabled: true,
      },
    };
    selectedFieldIndex = 0;
    builderMode = "builder";
    render();
    return;
  }

  if (action === "edit-form") {
    const slug = btn.dataset.slug;
    activeFormSlug = slug;
    try {
      const activeSiteId = state.site || "default";
      const formRes = await api(`tables/forms/${encodeURIComponent(slug)}?site=${activeSiteId}`);
      const formRow = formRes?.row || formRes;
      if (formRow) {
        let fields = [];
        try { fields = JSON.parse(formRow.fields_schema || formRow.schema_json || "[]"); } catch {}
        let settings = {};
        try { settings = JSON.parse(formRow.settings_schema || formRow.settings_json || "{}"); } catch {}

        currentForm = {
          name: formRow.name || formRow.title || slug,
          slug: formRow.slug || slug,
          description: formRow.description || "",
          fields: Array.isArray(fields) ? fields : [],
          settings: (settings && typeof settings === "object") ? settings : {},
        };
        selectedFieldIndex = 0;
        builderMode = "builder";
        render();
        return;
      }
    } catch (err) {
      alertDialog({ title: "Error", description: err.message });
    }
    return;
  }

  if (action === "view-submissions") {
    activeFormSlug = btn.dataset.slug || "";
    builderMode = "submissions";
    render();
    return;
  }

  if (action === "cancel-builder") {
    builderMode = "list";
    render();
    return;
  }

  if (action === "add-field-type") {
    const type = btn.dataset.type || "text";
    const count = currentForm.fields.length + 1;
    const newField = {
      key: `field_${count}`,
      type,
      label: `Field ${count}`,
      placeholder: "",
      required: false,
      options: ["select", "radio", "checkbox"].includes(type)
        ? [{ label: "Option 1", value: "opt1" }, { label: "Option 2", value: "opt2" }]
        : undefined,
    };
    currentForm.fields.push(newField);
    selectedFieldIndex = currentForm.fields.length - 1;
    render();
    return;
  }

  if (action === "field-up") {
    const idx = parseInt(btn.dataset.index, 10);
    if (idx > 0) {
      const tmp = currentForm.fields[idx - 1];
      currentForm.fields[idx - 1] = currentForm.fields[idx];
      currentForm.fields[idx] = tmp;
      selectedFieldIndex = idx - 1;
      render();
    }
    return;
  }

  if (action === "field-down") {
    const idx = parseInt(btn.dataset.index, 10);
    if (idx < currentForm.fields.length - 1) {
      const tmp = currentForm.fields[idx + 1];
      currentForm.fields[idx + 1] = currentForm.fields[idx];
      currentForm.fields[idx] = tmp;
      selectedFieldIndex = idx + 1;
      render();
    }
    return;
  }

  if (action === "field-delete") {
    const idx = parseInt(btn.dataset.index, 10);
    currentForm.fields.splice(idx, 1);
    if (selectedFieldIndex >= currentForm.fields.length) {
      selectedFieldIndex = Math.max(0, currentForm.fields.length - 1);
    }
    render();
    return;
  }

  if (action === "add-option") {
    const f = currentForm.fields[selectedFieldIndex];
    if (f) {
      if (!Array.isArray(f.options)) f.options = [];
      const oCount = f.options.length + 1;
      f.options.push({ label: `Option ${oCount}`, value: `opt_${oCount}` });
      render();
    }
    return;
  }

  if (action === "delete-option") {
    const oIdx = parseInt(btn.dataset.optIdx, 10);
    const f = currentForm.fields[selectedFieldIndex];
    if (f && Array.isArray(f.options)) {
      f.options.splice(oIdx, 1);
      render();
    }
    return;
  }

  if (action === "save-form") {
    const activeSiteId = state.site || "default";
    try {
      const fieldsJson = JSON.stringify(currentForm.fields || []);
      const settingsJson = JSON.stringify(currentForm.settings || {});
      const payload = {
        name: currentForm.name,
        title: currentForm.name,
        slug: currentForm.slug,
        description: currentForm.description || "",
        fields_schema: fieldsJson,
        settings_schema: settingsJson,
        schema_json: fieldsJson,
        settings_json: settingsJson,
        status: "published",
      };

      await api(`tables/forms?site=${activeSiteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      toast(t("plugin.forms.savedToast", "Form saved successfully!"));
      builderMode = "list";
      render();
    } catch (err) {
      alertDialog({ title: "Error Saving Form", description: err.message });
    }
    return;
  }

  if (action === "view-submission-detail") {
    const subId = btn.dataset.id;
    const item = allSubmissionsCached.find((s) => (s.id || s.slug) === subId);
    if (!item) return;

    let payloadObj = {};
    try { payloadObj = JSON.parse(item.payload || "{}"); } catch {}
    const entries = Object.entries(payloadObj);

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 0">
        <div style="display:flex;justify-content:space-between;padding:.75rem 1rem;background:var(--muted);border-radius:var(--radius);font-size:.85rem;color:var(--foreground)">
          <div><strong>${esc(t("plugin.forms.colSubId", "ID"))}:</strong> <span style="font-family:monospace">${esc(item.id || item.slug)}</span></div>
          <div><strong>${esc(t("plugin.forms.colDate", "Date"))}:</strong> ${esc(fmtDate(item.created_at))}</div>
        </div>

        <div style="font-weight:600;font-size:.875rem;color:var(--muted-foreground);margin-top:.25rem">${esc(t("plugin.forms.colPayload", "Submitted Data"))}:</div>
        <div style="display:grid;gap:.75rem">
          ${entries.length === 0 ? '<div class="muted">No fields submitted</div>' : entries.map(([k, v]) => `
            <div style="padding:.75rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card)">
              <div style="font-size:.75rem;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;margin-bottom:.25rem">${esc(k)}</div>
              <div style="font-size:.95rem;color:var(--foreground);white-space:pre-wrap;word-break:break-word">${esc(String(v ?? ""))}</div>
            </div>
          `).join("")}
        </div>

        <div style="padding:.75rem 1rem;background:oklch(from var(--muted) l c h / 0.5);border-radius:var(--radius);font-size:.78rem;color:var(--muted-foreground);display:flex;flex-direction:column;gap:.25rem">
          <div><strong>IP Hash:</strong> ${esc(item.ip_hash || "none")}</div>
          <div style="word-break:break-all"><strong>User Agent:</strong> ${esc(item.user_agent || "unknown")}</div>
        </div>
      </div>
    `;

    await openDialog({
      title: t("plugin.forms.detailTitle", "Submission Details"),
      bodyHtml,
      confirmLabel: t("core.action.ok", "OK"),
    });
    return;
  }

  if (action === "batch-delete-submissions") {
    if (subSelectedIds.size === 0) return;
    const ok = await confirmDialog({
      title: t("plugin.forms.batchDelete", "Batch Delete"),
      description: t("plugin.forms.batchDeleteConfirm", `Are you sure you want to delete ${subSelectedIds.size} selected submissions?`, { n: subSelectedIds.size }),
      confirmLabel: t("core.action.delete", "Delete"),
      danger: true,
    });
    if (!ok) return;

    const activeSiteId = state.site || "default";
    const ids = Array.from(subSelectedIds);
    let deletedCount = 0;
    for (const id of ids) {
      try {
        await api(`tables/submissions/${encodeURIComponent(id)}?site=${activeSiteId}`, { method: "DELETE" });
        deletedCount++;
      } catch {}
    }
    subSelectedIds.clear();
    toast(`${t("plugin.forms.deletedToast", "Deleted")} (${deletedCount})`);
    render();
    return;
  }

  if (action === "export-submissions-csv") {
    if (allSubmissionsCached.length === 0) {
      toast(t("plugin.forms.noSubmissions", "No submissions recorded yet."));
      return;
    }
    const allKeysSet = new Set();
    const rowsData = allSubmissionsCached.map((s) => {
      let p = {};
      try { p = JSON.parse(s.payload || "{}"); } catch {}
      Object.keys(p).forEach((k) => allKeysSet.add(k));
      return { id: s.id || s.slug, form: s.form_slug || "", date: fmtDate(s.created_at), ip: s.ip_hash || "", ...p };
    });
    const customKeys = Array.from(allKeysSet);
    const headers = ["ID", "Form", "Date", "IP Hash", ...customKeys];

    const escapeCsv = (val) => {
      const str = String(val ?? "");
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvContent = "\uFEFF" + [
      headers.map(escapeCsv).join(","),
      ...rowsData.map((row) => [
        escapeCsv(row.id),
        escapeCsv(row.form),
        escapeCsv(row.date),
        escapeCsv(row.ip),
        ...customKeys.map((k) => escapeCsv(row[k] ?? "")),
      ].join(",")),
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `submissions-${activeFormSlug || "all"}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("CSV Exported successfully!");
    return;
  }

  if (action === "delete-submission") {
    const subId = btn.dataset.id;
    const ok = await confirmDialog({
      title: t("core.action.delete", "Delete"),
      description: t("plugin.forms.deleteConfirm", "Are you sure you want to delete this record?"),
      confirmLabel: t("core.action.delete", "Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      const activeSiteId = state.site || "default";
      await api(`tables/submissions/${encodeURIComponent(subId)}?site=${activeSiteId}`, { method: "DELETE" });
      toast(t("plugin.forms.deletedToast", "Deleted"));
      render();
    } catch (err) {
      alertDialog({ title: "Error", description: err.message });
    }
    return;
  }

  if (action === "delete-form") {
    const slug = btn.dataset.slug;
    const ok = await confirmDialog({
      title: t("plugin.forms.deleteTitle", "Delete Form"),
      description: t("plugin.forms.deleteConfirm", `Are you sure you want to delete form "${slug}"?`),
      confirmLabel: t("core.action.delete", "Delete"),
      danger: true,
    });
    if (!ok) return;

    try {
      const activeSiteId = state.site || "default";
      await api(`tables/forms/${encodeURIComponent(slug)}?site=${activeSiteId}`, { method: "DELETE" });
      toast(t("plugin.forms.deletedToast", "Form deleted."));
      render();
    } catch (err) {
      alertDialog({ title: "Error", description: err.message });
    }
    return;
  }
});
