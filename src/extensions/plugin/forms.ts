/**
 * CFPress Custom Forms Plugin — Core Runtime Engine.
 *
 * Responsibilities:
 *   1. Shortcode renderer for [form id="..."] or [cfpress-form id="..."]
 *   2. HTML form markup generator (responsive, accessible, with honeypot)
 *   3. Public submission processing pipeline (validation, anti-spam, D1 storage)
 *   4. Lifecycle hooks dispatching (formRender, formSubmit) & Domain Events
 */

import type { Env } from "../../shared/types";
import { now } from "../../shared/repo";
import { randomId } from "../../shared/crypto";
import { applyFilters, doAction } from "./runtime";

export interface FormFieldDef {
  key: string;
  type: "text" | "textarea" | "select" | "radio" | "checkbox" | "number" | "email" | "phone" | "date" | "hidden";
  label: string;
  placeholder?: string;
  help?: string;
  default_value?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FormSettings {
  submit_label?: string;
  success_message?: string;
  redirect_url?: string;
  honeypot_enabled?: boolean;
  notify_email?: string;
}

export interface FormRecord {
  id?: string;
  slug: string;
  name?: string;
  title?: string;
  description?: string;
  schema_json?: string;
  settings_json?: string;
  fields_schema?: string;
  settings_schema?: string;
  status?: string;
}

/** Escapes special HTML characters to prevent XSS. */
function esc(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates frontend HTML for a form instance.
 */
export function renderFormHtml(form: FormRecord, siteId: string, currentLocale?: string): string {
  let fields: FormFieldDef[] = [];
  try {
    fields = JSON.parse(form.schema_json || form.fields_schema || "[]");
  } catch {
    fields = [];
  }

  let settings: FormSettings = {};
  try {
    settings = JSON.parse(form.settings_json || form.settings_schema || "{}");
  } catch {
    settings = {};
  }

  const submitLabel = esc(settings.submit_label || "Submit");
  const formTitle = esc(form.title || form.name || "");
  const formDesc = form.description ? `<p class="cfp-form-desc">${esc(form.description)}</p>` : "";

  // Render individual fields
  const fieldsHtml = fields.map((f) => {
    const isRequired = f.required ? "required" : "";
    const reqMark = f.required ? `<span class="cfp-req-mark" style="color:var(--destructive,#ef4444);margin-left:.25rem">*</span>` : "";
    const labelHtml = f.type !== "hidden"
      ? `<label for="cfp_f_${esc(f.key)}" class="cfp-form-label" style="display:block;font-weight:600;font-size:.875rem;margin-bottom:.35rem">${esc(f.label)}${reqMark}</label>`
      : "";
    const helpHtml = f.help
      ? `<div class="cfp-form-help" style="font-size:.78rem;color:var(--muted-foreground,#64748b);margin-top:.25rem">${esc(f.help)}</div>`
      : "";

    let controlHtml = "";
    switch (f.type) {
      case "textarea":
        controlHtml = `<textarea id="cfp_f_${esc(f.key)}" name="${esc(f.key)}" class="cfp-form-control" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:.9rem;min-height:5rem" placeholder="${esc(f.placeholder || "")}" ${isRequired}>${esc(f.default_value || "")}</textarea>`;
        break;

      case "select":
        const opts = (f.options || []).map((opt) => {
          const sel = opt.value === f.default_value ? "selected" : "";
          return `<option value="${esc(opt.value)}" ${sel}>${esc(opt.label)}</option>`;
        }).join("");
        controlHtml = `
          <select id="cfp_f_${esc(f.key)}" name="${esc(f.key)}" class="cfp-form-control" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:.9rem" ${isRequired}>
            ${f.placeholder ? `<option value="" disabled selected>${esc(f.placeholder)}</option>` : ""}
            ${opts}
          </select>`;
        break;

      case "radio":
        controlHtml = `
          <div class="cfp-form-radios" style="display:flex;flex-direction:column;gap:.4rem">
            ${(f.options || []).map((opt, idx) => {
              const chk = opt.value === f.default_value ? "checked" : "";
              return `
                <label style="display:flex;align-items:center;gap:.45rem;font-size:.875rem;cursor:pointer">
                  <input type="radio" name="${esc(f.key)}" value="${esc(opt.value)}" ${chk} ${idx === 0 && f.required ? "required" : ""}>
                  <span>${esc(opt.label)}</span>
                </label>`;
            }).join("")}
          </div>`;
        break;

      case "checkbox":
        controlHtml = `
          <div class="cfp-form-checkboxes" style="display:flex;flex-direction:column;gap:.4rem">
            ${(f.options || []).map((opt) => {
              return `
                <label style="display:flex;align-items:center;gap:.45rem;font-size:.875rem;cursor:pointer">
                  <input type="checkbox" name="${esc(f.key)}[]" value="${esc(opt.value)}">
                  <span>${esc(opt.label)}</span>
                </label>`;
            }).join("")}
          </div>`;
        break;

      case "hidden":
        controlHtml = `<input type="hidden" name="${esc(f.key)}" value="${esc(f.default_value || "")}">`;
        break;

      default: // text, email, phone, number, date
        const inputType = f.type === "phone" ? "tel" : f.type;
        controlHtml = `<input type="${esc(inputType)}" id="cfp_f_${esc(f.key)}" name="${esc(f.key)}" value="${esc(f.default_value || "")}" class="cfp-form-control" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:.9rem" placeholder="${esc(f.placeholder || "")}" ${isRequired}>`;
        break;
    }

    if (f.type === "hidden") return controlHtml;

    return `
      <div class="cfp-form-group" style="margin-bottom:1.15rem">
        ${labelHtml}
        ${controlHtml}
        ${helpHtml}
      </div>`;
  }).join("\n");

  // Honeypot field (hidden from real users, bots fill it)
  const honeypotHtml = `
    <div style="position:absolute;left:-9999px;opacity:0;pointer-events:none;height:0;overflow:hidden" aria-hidden="true" tabindex="-1">
      <label for="cfp_hp_${esc(form.slug)}">Leave this blank</label>
      <input type="text" id="cfp_hp_${esc(form.slug)}" name="_cfp_hp" value="" autocomplete="off">
    </div>`;

  return `
    <div class="cfp-form-container" style="background:var(--card,#ffffff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:1.5rem;box-shadow:0 4px 12px rgba(0,0,0,0.03);margin:1.5rem 0">
      ${formTitle ? `<h3 class="cfp-form-title" style="margin:0 0 .5rem;font-size:1.25rem;font-weight:700">${formTitle}</h3>` : ""}
      ${formDesc}
      <form class="cfp-custom-form" action="/api/v1/front/forms/submit" method="POST" data-form-slug="${esc(form.slug)}" style="margin-top:1.25rem">
        <input type="hidden" name="form_slug" value="${esc(form.slug)}">
        <input type="hidden" name="site_id" value="${esc(siteId)}">
        <input type="hidden" name="source_url" value="">
        ${currentLocale ? `<input type="hidden" name="locale" value="${esc(currentLocale)}">` : ""}
        ${honeypotHtml}
        <div class="cfp-form-feedback" style="display:none"></div>
        ${fieldsHtml}
        <div class="cfp-form-actions" style="margin-top:1.25rem">
          <button type="submit" class="cfp-form-submit-btn" style="padding:.65rem 1.4rem;background:var(--primary,#2563eb);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:.925rem;cursor:pointer;transition:opacity .15s">
            ${submitLabel}
          </button>
        </div>
      </form>
      <script>
      (function() {
        var form = document.currentScript ? document.currentScript.previousElementSibling : null;
        if (!form || !form.classList || !form.classList.contains("cfp-custom-form")) {
          var forms = document.querySelectorAll(".cfp-custom-form");
          form = forms[forms.length - 1];
        }
        if (!form || form.__cfp_bound) return;
        form.__cfp_bound = true;

        var srcInput = form.querySelector('input[name="source_url"]');
        if (srcInput && typeof window !== "undefined") srcInput.value = window.location.href;

        form.addEventListener("submit", async function(e) {
          e.preventDefault();
          var btn = form.querySelector(".cfp-form-submit-btn");
          var origText = btn ? btn.innerHTML : "Submit";
          var msgBox = form.querySelector(".cfp-form-feedback");
          if (msgBox) { msgBox.style.display = "none"; msgBox.innerHTML = ""; }

          if (btn) {
            btn.disabled = true;
            btn.style.opacity = "0.7";
            btn.innerHTML = '<span style="display:inline-block">⏳</span> 提交中...';
          }

          try {
            var srcInput = form.querySelector('input[name="source_url"]');
            if (srcInput && !srcInput.value) {
              srcInput.value = window.location.href;
            }

            var formData = new FormData(form);
            var payload = {};
            formData.forEach(function(val, key) {
              if (Object.prototype.hasOwnProperty.call(payload, key)) {
                if (Array.isArray(payload[key])) {
                  payload[key].push(val);
                } else {
                  payload[key] = [payload[key], val];
                }
              } else {
                payload[key] = val;
              }
            });

            var res = await fetch(form.action, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify(payload)
            });
            var data = await res.json().catch(function() { return {}; });

            if (res.ok && data.ok) {
              var container = form.closest(".cfp-form-container") || form;
              var successMsg = data.message || "Thank you! Your submission has been received.";
              container.innerHTML = '<div class="cfp-form-success-card" style="text-align:center;padding:2.5rem 1.5rem;background:oklch(0.97 0.03 140);color:oklch(0.3 0.1 140);border-radius:8px;border:1px solid oklch(0.85 0.08 140)"><div style="font-size:2.5rem;margin-bottom:.75rem">✅</div><h4 style="margin:0 0 .5rem;font-size:1.2rem;font-weight:700">' + successMsg + '</h4><p style="margin:0 0 1.25rem;font-size:.875rem;opacity:.9">已成功提交，我们将尽快与您取得联系。</p><button type="button" class="btn outline sm" onclick="location.reload()" style="padding:.4rem 1.1rem;border-radius:6px;cursor:pointer">再次填写</button></div>';
            } else {
              if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.innerHTML = origText; }
              if (msgBox) {
                msgBox.style.display = "block";
                msgBox.style.padding = ".75rem 1rem";
                msgBox.style.marginBottom = "1rem";
                msgBox.style.borderRadius = "6px";
                msgBox.style.background = "oklch(0.96 0.05 25)";
                msgBox.style.color = "oklch(0.4 0.18 25)";
                msgBox.style.border = "1px solid oklch(0.88 0.1 25)";
                msgBox.style.fontSize = ".875rem";
                msgBox.innerHTML = "⚠️ " + (data.error || "提交失败，请检查输入或稍后重试。");
              }
            }
          } catch (err) {
            if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.innerHTML = origText; }
            if (msgBox) {
              msgBox.style.display = "block";
              msgBox.style.padding = ".75rem 1rem";
              msgBox.style.marginBottom = "1rem";
              msgBox.style.borderRadius = "6px";
              msgBox.style.background = "oklch(0.96 0.05 25)";
              msgBox.style.color = "oklch(0.4 0.18 25)";
              msgBox.style.border = "1px solid oklch(0.88 0.1 25)";
              msgBox.style.fontSize = ".875rem";
              msgBox.innerHTML = "⚠️ 网络异常，提交未完成：" + err.message;
            }
          }
        });
      })();
      </script>
    </div>
  `;
}

async function tableExists(env: Env, tableName: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
    ).bind(tableName).first<any>();
    return !!row?.name;
  } catch {
    return false;
  }
}

interface FormWithMeta {
  form: any;
  formsTable: string;
  submissionsTable: string;
}

async function loadFormWithMeta(env: Env, siteId: string, slug: string, altName?: string): Promise<FormWithMeta | null> {
  const normAlt = String(altName || "").trim();
  // 1. Check theme_table_defs for owner of 'forms'
  try {
    const d = await env.DB.prepare(
      "SELECT table_name, owner_type, owner_name FROM theme_table_defs WHERE site_id=? AND logical_name='forms' LIMIT 1"
    ).bind(siteId).first<any>();
    if (d?.table_name) {
      const fTable = String(d.table_name);
      if (await tableExists(env, fTable)) {
        const row = await env.DB.prepare(`SELECT * FROM ${fTable} WHERE site_id=? AND (slug=? OR id=? OR (? != '' AND name=?)) LIMIT 1`)
          .bind(siteId, slug, slug, normAlt, normAlt).first<any>();
        if (row) {
          let sTable = "plugin_forms_submissions";
          const sDef = await env.DB.prepare(
            "SELECT table_name FROM theme_table_defs WHERE site_id=? AND logical_name='submissions' AND owner_type=? AND owner_name=? LIMIT 1"
          ).bind(siteId, d.owner_type, d.owner_name).first<any>();
          if (sDef?.table_name && (await tableExists(env, String(sDef.table_name)))) {
            sTable = String(sDef.table_name);
          }
          return { form: row, formsTable: fTable, submissionsTable: sTable };
        }
      }
    }
  } catch {}

  // 2. Direct check known pairs
  const pairs = [
    { forms: "plugin_cfpress_forms_forms", submissions: "plugin_cfpress_forms_submissions" },
    { forms: "plugin_forms_forms", submissions: "plugin_forms_submissions" },
  ];

  for (const p of pairs) {
    if (await tableExists(env, p.forms)) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM ${p.forms} WHERE site_id=? AND (slug=? OR id=? OR (? != '' AND name=?)) LIMIT 1`)
          .bind(siteId, slug, slug, normAlt, normAlt).first<any>();
        if (row) {
          return { form: row, formsTable: p.forms, submissionsTable: p.submissions };
        }
      } catch {}
    }
  }

  return null;
}

async function findDefaultSiteForm(env: Env, siteId: string): Promise<FormWithMeta | null> {
  const pairs = [
    { forms: "plugin_forms_forms", submissions: "plugin_forms_submissions" },
    { forms: "plugin_cfpress_forms_forms", submissions: "plugin_cfpress_forms_submissions" },
  ];
  for (const p of pairs) {
    if (await tableExists(env, p.forms)) {
      try {
        const rows = await env.DB.prepare(`SELECT * FROM ${p.forms} WHERE site_id=? AND status='published' LIMIT 2`)
          .bind(siteId).all<any>();
        const list = (rows.results as any[]) || [];
        if (list.length === 1) {
          return { form: list[0], formsTable: p.forms, submissionsTable: p.submissions };
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Handles the shortcode [form id="contact"] or [cfpress-form id="contact"]
 */
export async function handleFormShortcode(ctx: { env: Env; siteId?: string }, payload: any): Promise<any> {
  const env = ctx.env;
  const siteId = ctx.siteId;
  if (!siteId) return "";

  const attrs = payload.attrs || {};
  let slug = String(attrs.id || attrs.slug || payload.body || "").trim();
  slug = slug.replace(/&quot;/g, '"').replace(/^["']|["']$/g, "").trim();

  try {
    let meta = slug ? await loadFormWithMeta(env, siteId, slug, slug) : null;
    if (!meta) {
      meta = await findDefaultSiteForm(env, siteId);
    }

    if (!meta) {
      return `<div class="cfp-form-error" style="color:#64748b;padding:1rem;background:#f8fafc;border-radius:6px;font-size:.875rem">Form ${slug ? `[${esc(slug)}]` : ""} not found or unpublished.</div>`;
    }

    const form = meta.form;
    const initialHtml = renderFormHtml(form, siteId);
    // Allow hooks to filter/augment form html
    const finalHtml = await applyFilters("formRender", { env, siteId }, { form, html: initialHtml });
    return typeof finalHtml === "string" ? finalHtml : finalHtml?.html || initialHtml;
  } catch (err: any) {
    return `<div class="cfp-form-error" style="color:red;font-size:.85rem">Error loading form: ${esc(err.message)}</div>`;
  }
}

/**
 * Handles public form submissions from both AJAX/JSON and traditional HTML form POSTs.
 */
export async function processPublicFormSubmission(
  env: Env,
  siteId: string,
  request: Request,
  body: Record<string, any>
): Promise<{ ok: boolean; status: number; message?: string; error?: string; redirect?: string }> {
  const formSlug = String(body.form_slug || body.form_id || "").trim();
  if (!formSlug) {
    return { ok: false, status: 400, error: "Missing required parameter: form_slug" };
  }

  // 1. Anti-spam Honeypot Check
  if (body._cfp_hp && String(body._cfp_hp).trim().length > 0) {
    // Silently succeed to trick spam bots without storing payload
    return { ok: true, status: 200, message: "Thank you for your submission!" };
  }

  // 2. Load Form Definition & Paired Submissions Table
  const meta = await loadFormWithMeta(env, siteId, formSlug);

  if (!meta) {
    return { ok: false, status: 404, error: `Form "${formSlug}" not found.` };
  }

  const form = meta.form;
  const subTable = meta.submissionsTable;

  let fields: FormFieldDef[] = [];
  try {
    fields = JSON.parse(form.schema_json || form.fields_schema || "[]");
  } catch {
    fields = [];
  }

  let settings: FormSettings = {};
  try {
    settings = JSON.parse(form.settings_json || form.settings_schema || "{}");
  } catch {
    settings = {};
  }

  // 3. Validate Submitted Fields
  const payloadData: Record<string, any> = {};
  const validationErrors: Record<string, string> = {};

  for (const field of fields) {
    if (field.type === "hidden") {
      payloadData[field.key] = body[field.key] ?? field.default_value ?? "";
      continue;
    }

    const rawVal = body[field.key];
    const strVal = typeof rawVal === "string" ? rawVal.trim() : rawVal;

    // Required check
    if (field.required) {
      if (strVal === undefined || strVal === null || strVal === "") {
        validationErrors[field.key] = `${field.label} is required.`;
        continue;
      }
    }

    // Email format check
    if (field.type === "email" && strVal) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
        validationErrors[field.key] = "Please enter a valid email address.";
      }
    }

    payloadData[field.key] = strVal;
  }

  if (Object.keys(validationErrors).length > 0) {
    return {
      ok: false,
      status: 422,
      error: Object.values(validationErrors).join("; "),
    };
  }

  // 4. Save Submission to Database
  const submissionId = `sub_${await randomId()}`;
  const nowTs = now();
  const sourceUrl = String(body.source_url || request.headers.get("referer") || "");
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";

  // Hash IP address for privacy compliance
  let ipHash = "";
  if (ip) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
      ipHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    } catch {
      ipHash = "anon";
    }
  }

  let saved = false;
  try {
    await env.DB.prepare(
      `INSERT INTO ${subTable} (id, site_id, slug, lang_group, form_slug, payload, ip_hash, user_agent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      submissionId,
      siteId,
      submissionId,
      submissionId,
      formSlug,
      JSON.stringify(payloadData),
      ipHash,
      String(request.headers.get("user-agent") || ""),
      "unread",
      nowTs,
      nowTs
    ).run();
    saved = true;
  } catch (err: any) {
    const altCandidates = ["plugin_cfpress_forms_submissions", "plugin_forms_submissions"].filter((t) => t !== subTable);
    for (const alt of altCandidates) {
      try {
        await env.DB.prepare(
          `INSERT INTO ${alt} (id, site_id, slug, lang_group, form_slug, payload, ip_hash, user_agent, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          submissionId,
          siteId,
          submissionId,
          submissionId,
          formSlug,
          JSON.stringify(payloadData),
          ipHash,
          String(request.headers.get("user-agent") || ""),
          "unread",
          nowTs,
          nowTs
        ).run();
        saved = true;
        break;
      } catch {}
    }
  }

  if (!saved) {
    return { ok: false, status: 500, error: "Failed to record submission." };
  }

  // 5. Fire Lifecycle Hook & Notifications
  try {
    await doAction("formSubmit", { env, siteId, request }, {
      form,
      submissionId,
      data: payloadData,
      sourceUrl,
      submittedAt: nowTs,
    });
  } catch (err) {
    console.error("[CFPress Forms] formSubmit hook error:", err);
  }

  const successMessage = settings.success_message || "Thank you! Your submission has been received.";
  return {
    ok: true,
    status: 200,
    message: successMessage,
    redirect: settings.redirect_url,
  };
}

/**
 * Render Form widget instance into HTML.
 */
export async function renderFormWidget(env: Env, siteId: string, w: any): Promise<string | null> {
  let cfg: any = {};
  try { cfg = JSON.parse(String(w.config || "{}")); } catch {}
  const title = w.title ? `<h6 class="widget-title">${esc(String(w.title))}</h6>` : "";
  const slot = esc(String(w.sidebar || "sidebar"));
  const wid = esc(String(w.id || ""));

  let formSlug = String(cfg.form_slug || cfg.form_id || cfg.slug || "").trim();
  if (!formSlug && String(w.widget_type).startsWith("plugin.form.")) {
    formSlug = String(w.widget_type).replace(/^plugin\.form\./, "").trim();
  }
  if (!formSlug && cfg.id && cfg.id !== "embedded") {
    formSlug = String(cfg.id).trim();
  }
  if (!formSlug && w.id && w.id !== "embedded") {
    formSlug = String(w.id).trim();
  }
  const altName = String(w.title || "").trim();

  try {
    let meta = formSlug ? await loadFormWithMeta(env, siteId, formSlug, altName) : null;
    if (!meta && altName) {
      meta = await loadFormWithMeta(env, siteId, altName, altName);
    }
    if (!meta) {
      meta = await findDefaultSiteForm(env, siteId);
    }
    if (!meta) {
      const hint = formSlug || altName;
      return `<div class="cfp-form-error" style="padding:1rem;border:1px dashed #cbd5e1;border-radius:6px;color:#64748b;font-size:.875rem">Form ${hint ? `[${esc(hint)}]` : ""} not found or unpublished.</div>`;
    }
    const formHtml = renderFormHtml(meta.form, siteId);
    return `<section class="widget widget-form" data-slot="${slot}" data-widget="${wid}">${title}${formHtml}</section>`;
  } catch (err: any) {
    return `<div class="cfp-form-error" style="color:red;font-size:.85rem">Error loading form: ${esc(err?.message || err)}</div>`;
  }
}

/**
 * Discover available form items for widget selection.
 */
export async function listFormWidgetItems(env: Env, siteId: string): Promise<Array<{ type: string; id: string; name: string; plugin: string }>> {
  const items: Array<{ type: string; id: string; name: string; plugin: string }> = [];
  try {
    let formsTable: string | null = null;
    const tdef = await env.DB.prepare(
      "SELECT table_name FROM theme_table_defs WHERE site_id=? AND logical_name='forms' LIMIT 1"
    ).bind(siteId).first<any>();
    if (tdef?.table_name && (await tableExists(env, String(tdef.table_name)))) {
      formsTable = String(tdef.table_name);
    } else {
      for (const t of ["plugin_forms_forms", "plugin_cfpress_forms_forms"]) {
        if (await tableExists(env, t)) {
          formsTable = t;
          break;
        }
      }
    }
    if (formsTable) {
      const rows = await env.DB.prepare(
        `SELECT id, slug, name FROM ${formsTable} WHERE site_id=? AND (status='published' OR status='active' OR status IS NULL) ORDER BY name`
      ).bind(siteId).all();
      for (const f of (rows.results as any[]) ?? []) {
        items.push({
          type: "plugin.form",
          id: String(f.slug || f.id),
          name: String(f.name || f.slug || "Form"),
          plugin: "forms",
        });
      }
    }
  } catch {}
  return items;
}
