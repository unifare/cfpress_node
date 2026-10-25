/**
 * Screen: AI & API Keys — Developer & AI Agent open platform console.
 *
 * Provides:
 *   1. OpenAPI 3.1 live gateway status & schema links.
 *   2. Complete AI Agent Skill documentation & one-click full Markdown export.
 *   3. Machine-to-machine API key creation, site/scope boundaries & revocation.
 *   4. Categorized API quick reference (Posts, Batch, Taxonomies, Media, Tables, Settings)
 *      with one-click code copy for cURL / Agent integration.
 *   5. Full English and Chinese (zh-CN) localization via t().
 */
import { api, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { closestEl, alertDialog, confirmDialog, emptyRow, esc, fmtDate, fmtRelative, openDialog, toast } from "../../ui.js";
import { t } from "../i18n.js";

/** Generates the full dynamic Markdown Skill document for copy-paste into AI Agents. */
function generateAgentSkillMarkdown(origin, site) {
  return `# CFPress Headless CMS — REST API Agent Skill

You are an expert AI assistant integrating with CFPress Headless CMS. Use this skill to query, publish, update, batch-process, and manage content, taxonomies, media, and custom tables.

## 1. Authentication & Base URL
- **Base URL**: \`${origin}/api/v1\`
- **OpenAPI 3.1 Spec**: \`${origin}/api/v1/openapi.json\`
- **Header**: \`Authorization: Bearer <API_KEY>\`
- **Tenant Site**: CFPress is multi-tenant. Always append \`?site=${site}\` (default site is \`default\`).

## 2. Main API Capabilities & Examples

### 2.1 Identity & Overview
- Check Identity:
  \`curl -X GET "${origin}/api/v1/auth/me" -H "Authorization: Bearer YOUR_API_KEY"\`
- Site Statistics:
  \`curl -X GET "${origin}/api/v1/stats?site=${site}" -H "Authorization: Bearer YOUR_API_KEY"\`

### 2.2 Posts & Pages CRUD
- List Posts:
  \`curl -X GET "${origin}/api/v1/posts?site=${site}&status=publish&limit=10" -H "Authorization: Bearer YOUR_API_KEY"\`
- Create Post:
  \`curl -X POST "${origin}/api/v1/posts?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"title":"Post Title","slug":"post-slug","content":"<p>Content HTML</p>","status":"publish","tags":["AI","Tech"]}'\`
- Update Post:
  \`curl -X PUT "${origin}/api/v1/posts/{id}?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"title":"Updated Title"}'\`
- Delete Post:
  \`curl -X DELETE "${origin}/api/v1/posts/{id}?site=${site}" -H "Authorization: Bearer YOUR_API_KEY"\`
- Create Static Page:
  \`curl -X POST "${origin}/api/v1/pages?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"title":"About Us","slug":"about","content":"<h1>About</h1>","status":"publish","template":"default"}'\`

### 2.3 Batch Content Operations (Posts / Pages)
- Bulk Status Change (published / draft / scheduled / private):
  \`curl -X POST "${origin}/api/v1/posts/batch?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"action":"status","ids":["pst_1","pst_2"],"status":"published"}'\`
- Bulk Delete:
  \`curl -X POST "${origin}/api/v1/posts/batch?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"action":"delete","ids":["pst_1","pst_2"]}'\`
- Bulk Set Category:
  \`curl -X POST "${origin}/api/v1/posts/batch?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"action":"category","ids":["pst_1","pst_2"],"category_id":"category-slug-or-id"}'\`

### 2.4 Taxonomies (Categories & Tags)
- List Categories/Tags:
  \`curl -X GET "${origin}/api/v1/taxonomies/category/terms?site=${site}" -H "Authorization: Bearer YOUR_API_KEY"\`
- Create Term:
  \`curl -X POST "${origin}/api/v1/taxonomies/category/terms?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"name":"AI Tech","slug":"ai-tech","description":"Articles about AI"}'\`

### 2.5 Media Library (Cloudflare R2)
- List Assets:
  \`curl -X GET "${origin}/api/v1/media?site=${site}&limit=20" -H "Authorization: Bearer YOUR_API_KEY"\`
- Upload File (multipart/form-data):
  \`curl -X POST "${origin}/api/v1/media?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -F "file=@image.png" -F "alt_text=Hero Banner"\`

### 2.6 Theme Custom Data Tables
- Query Rows:
  \`curl -X GET "${origin}/api/v1/tables/{logical}?site=${site}&limit=50" -H "Authorization: Bearer YOUR_API_KEY"\`
- Insert Row:
  \`curl -X POST "${origin}/api/v1/tables/{logical}?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"slug":"item-1","name":"Item Name"}'\`

### 2.7 Site Settings
- Read Settings:
  \`curl -X GET "${origin}/api/v1/settings?site=${site}" -H "Authorization: Bearer YOUR_API_KEY"\`
- Save Settings:
  \`curl -X POST "${origin}/api/v1/settings?site=${site}" -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"site.title":"My New Title","site.tagline":"Updated Tagline"}'\`
`;
}

/** Generates the full dynamic Markdown Skill document for CFPress Theme Development by AI Agents. */
function generateThemeDevSkillMarkdown(origin) {
  return `# CFPress Theme Development — AI Agent Skill

You are an expert Frontend Developer and CMS Architect specializing in creating custom themes for CFPress Headless CMS. Use this skill to design, implement, and package fully-functional, responsive themes that strictly comply with CFPress architectural contracts.

## 1. Overview & Theme Package Structure
A CFPress theme is completely self-contained in a standard ZIP archive (no server-side compilation or node build step required).
The directory structure inside the ZIP (or theme folder) MUST be:
\`\`\`text
<theme-name>/
├── theme.json              # [REQUIRED] Theme manifest declaring capabilities, templates, routes, tables, and menus
├── templates/              # [REQUIRED] HTML templates executed by the zero-eval template engine
│   ├── parts/
│   │   ├── layout.html     # Base layout defining the content slot: {{@section "content"}}
│   │   ├── header.html     # Reusable header component: included via {{@include "parts/header"}}
│   │   └── footer.html     # Reusable footer component: included via {{@include "parts/footer"}}
│   ├── index.html          # Homepage & post archives
│   ├── single.html         # Single post detail view
│   ├── page.html           # Single static page view
│   ├── archive.html        # Category/tag/taxonomy term archive
│   └── 404.html            # 404 Not Found error template
├── assets/                 # [OPTIONAL] Static assets (CSS, JS, WebP/SVG images, fonts)
│   ├── style.css           # Frontend stylesheet
│   └── main.js             # Client-side scripts
└── langs/                  # [REQUIRED if locales declared] UI localization for admin menus & settings
    ├── en.json             # Flat JSON dictionary with "theme.<theme-name>.<key>" keys
    └── zh-CN.json
\`\`\`

## 2. Manifest (\`theme.json\`) Contract & Rules
The \`theme.json\` file is validated on theme upload/activation. Any invalid declaration causes installation rejection.

### Minimal Valid Example
\`\`\`json
{
  "name": "my-theme",
  "title": "My Custom Theme",
  "version": "1.0.0",
  "description": "Clean and responsive theme for CFPress",
  "author": "Your Name",
  "license": "MIT",
  "template_engine": "default",
  "supports": ["blocks", "menus", "widgets"],
  "locales": ["en", "zh-CN"],
  "templates": ["index", "single", "page", "archive", "404"],
  "parts": ["layout", "header", "footer"],
  "routes": [
    {
      "path": "/products",
      "template": "archive",
      "resolve": { "table": "product" },
      "query": { "as": "products" }
    },
    {
      "path": "/products/:slug",
      "template": "single",
      "resolve": { "table": "product", "by": "slug" }
    }
  ],
  "tables": [
    {
      "name": "product",
      "label": "Products",
      "translatable": ["name", "description"],
      "fields": [
        { "key": "name", "type": "text", "label": "Product Name" },
        { "key": "price", "type": "number", "label": "Price ($)" },
        { "key": "description", "type": "longtext", "label": "Description" }
      ]
    }
  ],
  "adminMenus": [
    {
      "id": "products-menu",
      "label": "Products",
      "icon": "box",
      "screen": "table-list",
      "args": { "table": "product" }
    }
  ],
  "settings": [
    { "key": "tagline", "label": "Custom Tagline", "type": "text", "default": "Welcome to our store" }
  ]
}
\`\`\`

### Critical Manifest Rules
1. **\`name\`**: Must match \`^[a-z0-9]+(-[a-z0-9]+)*$\` and match the theme directory / zip name.
2. **\`templates[]\`**: Every declared template name MUST exist at \`templates/<name>.html\`.
3. **\`routes[].resolve\`**: Must declare EITHER \`"table": "<table_name>"\` OR \`"type": "<post_type>"\`, never both, never neither.
4. **\`routes[].resolve.by\`**: Must be \`"slug"\` or \`"id"\`.
5. **\`query.as\`**: Must be a valid JavaScript identifier (\`[A-Za-z_$][A-Za-z0-9_$]*\`). **NEVER use hyphens** (e.g. use \`"products"\`, NOT \`"product-items"\`), otherwise the template tokenizer treats it as a subtraction expression.

## 3. Custom Business Tables (\`tables[]\`) Rules
Themes can declare isolated database tables without writing any SQL or backend code:
- **Only 6 allowed field types**: \`"text"\`, \`"longtext"\`, \`"number"\`, \`"boolean"\`, \`"date"\`, \`"datetime"\`.
- **Reserved Column Names (FORBIDDEN in fields)**: \`id\`, \`site_id\`, \`slug\`, \`lang_group\`, \`status\`, \`created_at\`, \`updated_at\`. The platform automatically creates and manages these.
- **Translatable Columns Rule (Strict)**:
  - Every \`"text"\` and \`"longtext"\` field MUST be listed in \`translatable: [...]\`.
  - \`"number"\`, \`"boolean"\`, \`"date"\`, and \`"datetime"\` fields MUST NEVER be in \`translatable\`.
- **Automatic Admin Screen**: When declaring \`adminMenus[]\` with \`"screen": "table-list"\` and \`"args": { "table": "<table_name>" }\`, the platform automatically renders search, pagination, create, and edit forms.

## 4. Zero-Eval Template Engine Syntax & Strict Rules
The template engine is pure, safe, and interprets tokens without executing code (\`eval\`).

### 4.1 Master Layout & Section Slot (Most Critical Pitfall!)
- In parent/layout template (\`templates/parts/layout.html\`):
  Use \`{{@section "content"}}\` with **NO CLOSING TAG**. It defines a placeholder slot.
- In child/page template (\`templates/index.html\`):
  Must extend layout and provide closing tag:
  \`\`\`html
  {{@extends "parts/layout"}}
  {{@section "content"}}
    <main>
      <h1>{{site.title}}</h1>
    </main>
  {{/section}}
  \`\`\`
  **CRITICAL**: The closing tag MUST be \`{{/section}}\`. DO NOT write \`{{/@section}}\`. If \`{{/section}}\` is missing, the template will render an empty page with HTTP 200!

### 4.2 Helper Call Syntax
- Helper functions MUST be called with parentheses: \`{{len(posts)}}\`, \`{{default(val, fallback)}}\`, \`{{number(price)}}\`.
- Calling \`{{len posts}}\` will throw a syntax error (\`Trailing tokens in expression\`).
- Built-in helpers: \`len\`, \`default\`, \`lower\`, \`upper\`, \`truncate\`, \`join\`, \`number\`, \`date\`, \`contains\`.

### 4.3 Template Context Variables
- \`site\`: \`title\`, \`description\`, \`robots\`, \`locale\`
- \`page\`: \`title\`, \`description\`, \`path\`, \`kind\`, \`document_title\`
- \`locale\` / \`locales\`: Current locale code and list of all supported locales
- \`menu.primary\`: Primary navigation items (\`[{ title, url, target }]\`)
- \`post\`: The current article or page object (\`post.title\`, \`post.html\`, \`post.meta\`, \`post.created_at\`)
- \`posts\`: Array of posts on archive/index pages
- \`theme\`: \`name\`, \`version\`, \`title\`, \`settings\` (e.g. \`{{theme.settings.tagline}}\`)

### 4.4 Data Query Directive (\`@query\`)
Fetch posts or custom table rows directly in templates:
\`\`\`html
{{@query type="post" limit=6 order="created_at desc" as="latest_posts"}}
  <div class="grid">
    {{#each latest_posts}}
      <article>
        <h3><a href="{{this.url}}">{{this.title}}</a></h3>
      </article>
    {{/each}}
  </div>
{{/query}}
\`\`\`

### 4.5 Static Assets Path
Static assets in the \`assets/\` folder are routed at \`/themes/<theme-name>/assets/<file-path>\`.
Example:
\`\`\`html
<link rel="stylesheet" href="/themes/my-theme/assets/style.css">
<script src="/themes/my-theme/assets/main.js" defer></script>
\`\`\`

## 5. UI Localization (\`langs/\`)
If \`locales\` are declared in \`theme.json\`, provide flat JSON dictionaries:
- \`langs/en.json\`:
  \`\`\`json
  {
    "theme.my-theme.products": "Products",
    "theme.my-theme.buy_now": "Buy Now"
  }
  \`\`\`
- \`langs/zh-CN.json\`:
  \`\`\`json
  {
    "theme.my-theme.products": "产品展示",
    "theme.my-theme.buy_now": "立即购买"
  }
  \`\`\`

## 6. Theme Packaging & Distribution
1. Build the zip archive containing \`theme.json\`, \`templates/\`, \`assets/\`, and \`langs/\` directly at the root of the archive:
   \`\`\`bash
   cd my-theme/
   zip -r ../my-theme.zip theme.json templates assets langs
   \`\`\`
2. Upload via CFPress Admin:
   Navigate to **Appearance > Themes > Upload Theme**, select \`my-theme.zip\`, and click **Activate**.
   CFPress will automatically create database tables, register admin menus, sync routes, and render your theme immediately!
`;
}

const API_V1_PREFIX = "" + "/api/v1";

function codeCard(title, method, relativePath, snippet) {
  const fullPath = `${API_V1_PREFIX}${relativePath}`;
  const methodBg = {
    GET: "#0284c7",
    POST: "#16a34a",
    PUT: "#d97706",
    PATCH: "#7c3aed",
    DELETE: "#dc2626",
  }[method] || "var(--primary)";

  return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:.75rem">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;background:var(--accent);border-bottom:1px solid var(--border);gap:.5rem">
        <div style="display:flex;align-items:center;gap:.5rem;min-width:0">
          <span style="display:inline-block;padding:.15rem .45rem;border-radius:var(--radius);font-size:.7rem;font-weight:700;color:#fff;background:${methodBg};flex-shrink:0">${esc(method)}</span>
          <span style="font-family:monospace;font-size:.75rem;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fullPath)}</span>
          <span style="color:var(--foreground);font-size:.8rem;font-weight:600;white-space:nowrap">— ${esc(title)}</span>
        </div>
        <button class="btn outline sm" data-action="copy-code" data-code="${esc(snippet)}" style="height:1.6rem;padding:0 .5rem;font-size:.75rem;flex-shrink:0;gap:.25rem">
          ${icon("copy", 'style="width:.875rem;height:.875rem"')}${esc(t("core.apiKeys.copyCode", "Copy"))}
        </button>
      </div>
      <pre style="margin:0;padding:.75rem .85rem;background:transparent;overflow-x:auto;font-size:.78rem;line-height:1.42;color:var(--foreground)"><code>${esc(snippet)}</code></pre>
    </div>
  `;
}

export default async function apiKeys(c) {
  let keys = [];
  try {
    const res = await api("auth/api-keys");
    const rawKeys = Array.isArray(res?.items) ? res.items : Array.isArray(res?.keys) ? res.keys : [];
    keys = rawKeys.filter((k) => k.status !== "revoked");
  } catch {
    keys = [];
  }

  const activeSiteId = state.site || "default";
  const openApiUrl = `${window.CFP_ADMIN_BASE ? window.CFP_ADMIN_BASE.replace(/\/admin.*$/, "") : ""}/api/v1/openapi.json`;
  const hostOrigin = (typeof location !== "undefined" && location.origin) ? location.origin : "http://localhost";

  const rows = keys.length === 0
    ? emptyRow(6, t("core.apiKeys.noKeys", "No API keys created yet."))
    : keys.map((k) => {
        const sitesList = Array.isArray(k.sites) && !k.sites.includes("*") ? k.sites.join(", ") : t("core.apiKeys.allSites", "All sites (*)");
        const scopesList = Array.isArray(k.scopes) && !k.scopes.includes("*") ? k.scopes.join(", ") : t("core.apiKeys.allPermissions", "Full access (*)");
        return `
        <tr>
          <td style="font-weight:600">
            <div style="display:flex;align-items:center;gap:.5rem">
              ${icon("key-round")}
              <span>${esc(k.name)}</span>
            </div>
          </td>
          <td><code style="font-size:.85rem;background:var(--accent);padding:.2rem .4rem;border-radius:var(--radius)">${esc(k.key_prefix || k.keyPrefix)}...</code></td>
          <td><span class="badge outline">${esc(sitesList)}</span></td>
          <td><span class="badge secondary">${esc(scopesList)}</span></td>
          <td>${esc(fmtDate(k.created_at || k.createdAt))}</td>
          <td>${esc(k.last_used_at ? fmtRelative(k.last_used_at) : t("core.apiKeys.neverUsed", "Never"))}</td>
          <td style="text-align:right">
            <button class="btn outline sm danger" data-action="revoke-api-key" data-id="${esc(k.id)}" data-name="${esc(k.name)}">
              ${icon("trash")}${esc(t("core.action.revoke", "Revoke"))}
            </button>
          </td>
        </tr>`;
      }).join("");

  c.innerHTML = `${pageHead({
    title: t("core.apiKeys.title", "AI & API Keys"),
    sub: t("core.apiKeys.sub", "Create API keys for AI assistants, agents, or remote scripts to access CFPress APIs."),
    crumbs: [{ label: t("core.nav.tools", "Tools") }, { label: t("core.apiKeys.title", "AI & API Keys") }],
  })}

  <div style="display:flex;flex-direction:column;gap:1.5rem">
    <!-- Top Open Gateway Status Banner -->
    <div class="panel" style="background:var(--card);border:1px solid var(--border)">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem">
        <div style="display:flex;align-items:center;gap:.75rem">
          <div style="width:2.5rem;height:2.5rem;border-radius:var(--radius);background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center">
            ${icon("sparkles")}
          </div>
          <div>
            <div style="font-weight:600;font-size:1rem;display:flex;align-items:center;gap:.5rem">
              <span>${esc(t("core.apiKeys.gatewayTitle", "OpenAPI 3.1 REST API Gateway"))}</span>
              <span class="badge success">${esc(t("core.apiKeys.statusActive", "Live & Ready"))}</span>
            </div>
            <div class="muted text-sm" style="margin-top:.25rem">
              ${esc(t("core.apiKeys.gatewayDesc", "Standardized REST API with Bearer token authentication. Ready for Cursor, Claude, GPTs, and Dify integrations."))}
            </div>
          </div>
        </div>

        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn outline sm" data-action="copy-openapi-url" data-url="${esc(openApiUrl)}">
            ${icon("copy")}${esc(t("core.apiKeys.copyUrl", "Copy OpenAPI URL"))}
          </button>
          <a class="btn outline sm" href="${openApiUrl}" target="_blank" rel="noopener">
            ${icon("external")}${esc(t("core.apiKeys.viewOpenApi", "View OpenAPI Spec"))}
          </a>
        </div>
      </div>
    </div>

    <!-- AI Agent Skill Showcase Card (One-click full Markdown copy) -->
    <div class="panel" style="background:linear-gradient(135deg, var(--card) 0%, var(--accent) 100%);border:1px solid var(--border);position:relative">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1.25rem">
        <div style="max-width:42rem">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
            <span style="color:var(--primary)">${icon("code")}</span>
            <h2 style="font-size:1.05rem;font-weight:700;margin:0">${esc(t("core.apiKeys.skillBannerTitle", "AI Agent Skill & Integration Guide"))}</h2>
          </div>
          <p class="muted text-sm" style="margin:0;line-height:1.5">
            ${esc(t("core.apiKeys.skillBannerDesc", "One-click copy the comprehensive Agent Skill document to integrate CFPress with Cursor (.cursorrules), Claude Projects, Windsurf, or Dify."))}
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <button class="btn primary" data-action="copy-skill" data-origin="${esc(hostOrigin)}" data-site="${esc(activeSiteId)}" style="box-shadow:0 2px 8px rgba(0,0,0,0.08);gap:.4rem">
            ${icon("sparkles")}${esc(t("core.apiKeys.copySkillBtn", "Copy REST API Skill"))}
          </button>
          <button class="btn outline" data-action="copy-theme-skill" data-origin="${esc(hostOrigin)}" style="box-shadow:0 2px 8px rgba(0,0,0,0.08);gap:.4rem;background:var(--card)">
            ${icon("palette")}${esc(t("core.apiKeys.copyThemeSkillBtn", "Copy Theme Dev Skill"))}
          </button>
        </div>
      </div>

      <!-- Two Quick Skill Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(18rem, 1fr));gap:1rem;margin-top:1.25rem">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:.85rem 1rem;display:flex;flex-direction:column;justify-content:space-between;gap:.5rem">
          <div>
            <div style="display:flex;align-items:center;gap:.45rem;font-weight:600;font-size:.9rem;color:var(--foreground)">
              ${icon("code")}${esc(t("core.apiKeys.skillRestTitle", "REST API Integration Skill"))}
            </div>
            <div class="muted text-sm" style="margin-top:.25rem;line-height:1.45">
              ${esc(t("core.apiKeys.skillRestDesc", "Equip agents with posts CRUD, batch publishing, media upload, taxonomy management, and custom tables."))}
            </div>
          </div>
          <div style="margin-top:.25rem">
            <button class="btn outline sm" data-action="copy-skill" data-origin="${esc(hostOrigin)}" data-site="${esc(activeSiteId)}" style="width:100%;justify-content:center;gap:.35rem">
              ${icon("copy")}${esc(t("core.apiKeys.copySkillBtn", "Copy REST API Skill"))}
            </button>
          </div>
        </div>

        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:.85rem 1rem;display:flex;flex-direction:column;justify-content:space-between;gap:.5rem">
          <div>
            <div style="display:flex;align-items:center;gap:.45rem;font-weight:600;font-size:.9rem;color:var(--foreground)">
              ${icon("palette")}${esc(t("core.apiKeys.skillThemeTitle", "Theme Development Skill"))}
            </div>
            <div class="muted text-sm" style="margin-top:.25rem;line-height:1.45">
              ${esc(t("core.apiKeys.skillThemeDesc", "Equip agents with theme architecture, theme.json contract, safe template engine rules, custom tables, and ZIP packaging."))}
            </div>
          </div>
          <div style="margin-top:.25rem">
            <button class="btn outline sm" data-action="copy-theme-skill" data-origin="${esc(hostOrigin)}" style="width:100%;justify-content:center;gap:.35rem">
              ${icon("copy")}${esc(t("core.apiKeys.copyThemeSkillBtn", "Copy Theme Dev Skill"))}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- API Keys Management Table -->
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div>
          <h2 style="font-size:1rem;font-weight:600;margin:0 0 .25rem">${esc(t("core.apiKeys.tableTitle", "Active API Keys"))}</h2>
          <div class="muted text-sm">${esc(t("core.apiKeys.tableSub", "Manage programmatic access tokens and scope restrictions."))}&nbsp;(${esc(keys.length)} ${esc(t("core.apiKeys.totalKeys", "total"))})</div>
        </div>
        <button class="btn primary" data-action="new-api-key">
          ${icon("plus")}${esc(t("core.apiKeys.createBtn", "Create Key"))}
        </button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${esc(t("core.apiKeys.name", "Name"))}</th>
              <th>${esc(t("core.apiKeys.prefix", "Prefix"))}</th>
              <th>${esc(t("core.apiKeys.sites", "Allowed Sites"))}</th>
              <th>${esc(t("core.apiKeys.scopes", "Scopes"))}</th>
              <th>${esc(t("core.apiKeys.created", "Created"))}</th>
              <th>${esc(t("core.apiKeys.lastUsed", "Last used"))}</th>
              <th style="width:5rem;text-align:right">${esc(t("core.action.actions", "Actions"))}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Categorized Core Feature Endpoints & Interactive Snippets -->
    <div class="panel">
      <div style="margin-bottom:1.25rem">
        <h2 style="font-size:1rem;font-weight:600;margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem">
          ${icon("sparkles")}${esc(t("core.apiKeys.skillsTitle", "Core Feature Endpoints & Code Examples"))}
        </h2>
        <div class="muted text-sm">
          ${esc(t("core.apiKeys.skillsSub", "Tested cURL commands with real-time site scope and headers. Click any snippet to copy."))}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(28rem, 1fr));gap:1.25rem">
        <!-- Group 1: Posts & Pages -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("file-text")}${esc(t("core.apiKeys.tabPosts", "Posts & Pages"))}
          </h3>
          ${codeCard(
            "List Posts",
            "GET",
            `/posts?site=${activeSiteId}&status=publish`,
            `curl -X GET "${hostOrigin}/api/v1/posts?site=${activeSiteId}&status=publish&limit=10" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
          ${codeCard(
            "Create Post",
            "POST",
            `/posts?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/posts?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"New Article","slug":"new-article","content":"<p>Content</p>","status":"publish","tags":["AI"]}'`
          )}
          ${codeCard(
            "Create Page",
            "POST",
            `/pages?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/pages?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"About Us","slug":"about","content":"<h1>About</h1>","status":"publish","template":"default"}'`
          )}
        </div>

        <!-- Group 2: Batch Operations -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("layers")}${esc(t("core.apiKeys.tabBatch", "Batch Operations"))}
          </h3>
          ${codeCard(
            "Batch Update Status",
            "POST",
            `/posts/batch?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/posts/batch?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"status","ids":["pst_1","pst_2"],"status":"published"}'`
          )}
          ${codeCard(
            "Batch Delete Posts",
            "POST",
            `/posts/batch?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/posts/batch?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"delete","ids":["pst_1","pst_2"]}'`
          )}
          ${codeCard(
            "Batch Set Category",
            "POST",
            `/posts/batch?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/posts/batch?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"category","ids":["pst_1","pst_2"],"category_id":"news"}'`
          )}
        </div>

        <!-- Group 3: Taxonomies & Terms -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("route")}${esc(t("core.apiKeys.tabTerms", "Categories & Tags"))}
          </h3>
          ${codeCard(
            "List Categories",
            "GET",
            `/taxonomies/category/terms?site=${activeSiteId}`,
            `curl -X GET "${hostOrigin}/api/v1/taxonomies/category/terms?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
          ${codeCard(
            "Create Category",
            "POST",
            `/taxonomies/category/terms?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/taxonomies/category/terms?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"AI Trends","slug":"ai-trends","description":"AI news & trends"}'`
          )}
        </div>

        <!-- Group 4: Media Library -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("image")}${esc(t("core.apiKeys.tabMedia", "Media Library"))}
          </h3>
          ${codeCard(
            "Upload Image to R2",
            "POST",
            `/media?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/media?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -F "file=@banner.webp" \\\n  -F "alt_text=Hero Banner"`
          )}
          ${codeCard(
            "List Media Files",
            "GET",
            `/media?site=${activeSiteId}`,
            `curl -X GET "${hostOrigin}/api/v1/media?site=${activeSiteId}&limit=20" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
        </div>

        <!-- Group 5: Theme Custom Tables -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("palette")}${esc(t("core.apiKeys.tabTables", "Custom Tables"))}
          </h3>
          ${codeCard(
            "Query Custom Table",
            "GET",
            `/tables/{logical}?site=${activeSiteId}`,
            `curl -X GET "${hostOrigin}/api/v1/tables/books?site=${activeSiteId}&limit=20" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
          ${codeCard(
            "Insert Row",
            "POST",
            `/tables/{logical}?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/tables/books?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"slug":"book-1","title":"Book Title","rating":5}'`
          )}
        </div>

        <!-- Group 6: Settings & Stats -->
        <div>
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem;color:var(--primary);display:flex;align-items:center;gap:.35rem">
            ${icon("settings")}${esc(t("core.apiKeys.tabSettings", "Settings & Stats"))}
          </h3>
          ${codeCard(
            "Verify Auth Me",
            "GET",
            "/auth/me",
            `curl -X GET "${hostOrigin}/api/v1/auth/me" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
          ${codeCard(
            "Site Stats",
            "GET",
            `/stats?site=${activeSiteId}`,
            `curl -X GET "${hostOrigin}/api/v1/stats?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY"`
          )}
          ${codeCard(
            "Update Settings",
            "POST",
            `/settings?site=${activeSiteId}`,
            `curl -X POST "${hostOrigin}/api/v1/settings?site=${activeSiteId}" \\\n  -H "Authorization: Bearer cfp_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"site.title":"My Site","site.tagline":"Next-gen CMS"}'`
          )}
        </div>
      </div>
    </div>

    <!-- AI Agent Quick Guides (Cursor / Dify / Claude) -->
    <div class="panel">
      <h3 style="font-size:.95rem;font-weight:600;margin-bottom:.75rem;display:flex;align-items:center;gap:.5rem">
        ${icon("sparkles")}${esc(t("core.apiKeys.agentGuideTitle", "AI Agent Setup Guides"))}
      </h3>
      <ul style="padding-left:1.25rem;font-size:.875rem;color:var(--muted-foreground);display:flex;flex-direction:column;gap:.6rem;line-height:1.4">
        <li>
          <strong style="color:var(--foreground)">Cursor / Windsurf (.cursorrules):</strong><br>
          ${esc(t("core.apiKeys.cursorHint", "Paste the copied Skill or OpenAPI URL into your .cursorrules or prompt to give Cursor full control over articles and media."))}
        </li>
        <li>
          <strong style="color:var(--foreground)">Dify / FastGPT Custom Tool:</strong><br>
          ${esc(t("core.apiKeys.difyHint", "Import /api/v1/openapi.json in Dify Custom Tools, select Bearer authentication, and your AI workflow can publish posts automatically."))}
        </li>
        <li>
          <strong style="color:var(--foreground)">Custom GPTs / Claude Projects:</strong><br>
          ${esc(t("core.apiKeys.gptsHint", "Paste OpenAPI schema into Custom GPT Actions. Use Bearer Auth with your generated API key."))}
        </li>
      </ul>
    </div>
  </div>`;
}

document.addEventListener("click", async (e) => {
  const btn = closestEl(e, "[data-action]");
  if (!btn) return;

  if (btn.dataset.action === "copy-openapi-url") {
    const url = btn.dataset.url || "";
    try {
      await navigator.clipboard.writeText(url);
      toast(t("core.apiKeys.copiedToast", "Copied to clipboard!"));
    } catch {
      prompt(t("core.apiKeys.copyManual", "Copy to clipboard:"), url);
    }
    return;
  }

  if (btn.dataset.action === "copy-skill") {
    const origin = btn.dataset.origin || (typeof location !== "undefined" && location.origin ? location.origin : "http://localhost");
    const site = btn.dataset.site || state.site || "default";
    const skillMarkdown = generateAgentSkillMarkdown(origin, site);
    try {
      await navigator.clipboard.writeText(skillMarkdown);
      toast(t("core.apiKeys.skillCopied", "Complete Agent Skill copied to clipboard!"));
    } catch {
      prompt(t("core.apiKeys.copyManual", "Copy to clipboard:"), skillMarkdown);
    }
    return;
  }

  if (btn.dataset.action === "copy-theme-skill") {
    const origin = btn.dataset.origin || (typeof location !== "undefined" && location.origin ? location.origin : "http://localhost");
    const skillMarkdown = generateThemeDevSkillMarkdown(origin);
    try {
      await navigator.clipboard.writeText(skillMarkdown);
      toast(t("core.apiKeys.themeSkillCopied", "Theme Development Agent Skill copied to clipboard!"));
    } catch {
      prompt(t("core.apiKeys.copyManual", "Copy to clipboard:"), skillMarkdown);
    }
    return;
  }

  if (btn.dataset.action === "copy-code") {
    const code = btn.dataset.code || "";
    try {
      await navigator.clipboard.writeText(code);
      toast(t("core.apiKeys.codeCopied", "Code snippet copied to clipboard!"));
    } catch {
      prompt(t("core.apiKeys.copyManual", "Copy to clipboard:"), code);
    }
    return;
  }

  if (btn.dataset.action === "new-api-key") {
    const siteOptions = [
      { value: "*", label: t("core.apiKeys.allSites", "All sites (*)") },
      ...state.sites.map((s) => ({ value: s.id, label: `${s.name || s.id} (${s.id})` })),
    ];

    const scopeOptions = [
      { value: "*", label: t("core.apiKeys.allPermissions", "Full access (*)") },
      { value: "posts.read", label: t("core.apiKeys.scopeReadPosts", "Read Posts Only (posts.read)") },
      { value: "posts.write", label: t("core.apiKeys.scopeWritePosts", "Write & Publish Posts (posts.write)") },
    ];

    const vals = await openDialog({
      title: t("core.apiKeys.createTitle", "Create API Key"),
      description: t("core.apiKeys.createSub", "Generate an API Key for an external AI Agent or integration."),
      fields: [
        { name: "name", label: t("core.apiKeys.keyName", "Key name"), placeholder: "e.g. Cursor / Claude / Dify", required: true },
        { name: "site", label: t("core.apiKeys.siteScope", "Site Scope"), type: "select", options: siteOptions, value: "*" },
        { name: "scope", label: t("core.apiKeys.permissionScope", "Permissions"), type: "select", options: scopeOptions, value: "*" },
      ],
      confirmLabel: t("core.action.create", "Create"),
    });
    if (!vals || !vals.name) return;

    try {
      const sites = vals.site === "*" ? ["*"] : [vals.site];
      const scopes = vals.scope === "*" ? ["*"] : [vals.scope];

      const res = await api("auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vals.name, sites, scopes }),
      });
      if (res.error) {
        await alertDialog({ title: t("core.apiKeys.createTitle", "Create API Key"), description: res.error });
        return;
      }
      const token = res.token || res.key?.token || "";
      await openDialog({
        title: t("core.apiKeys.createdTitle", "API Key Created"),
        description: t("core.apiKeys.createdHint", "Copy your API key now. You will not be able to see it again!"),
        confirmLabel: t("core.action.ok", "OK"),
        fields: [],
        bodyHtml: `
          <div style="margin:1rem 0">
            <input type="text" readonly value="${esc(token)}" id="new-token-val" style="width:100%;font-family:monospace;padding:.6rem .75rem;background:var(--accent);border:1px solid var(--border);border-radius:var(--radius);font-size:.9rem;user-select:all" onclick="this.select()">
          </div>
          <div class="muted text-sm" style="color:var(--destructive)">
            ${esc(t("core.apiKeys.warningSecret", "Keep this secret safe. Do not commit it to public repositories or expose it client-side."))}
          </div>
        `,
      });
      render();
    } catch (err) {
      await alertDialog({ title: t("core.apiKeys.createTitle", "Create API Key"), description: err.message });
    }
    return;
  }

  if (btn.dataset.action === "revoke-api-key") {
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    const ok = await confirmDialog({
      title: t("core.apiKeys.revokeTitle", "Revoke API Key"),
      description: t("core.apiKeys.revokeConfirm", `Are you sure you want to revoke the key "${name}"? Any agent using it will immediately lose access.`),
      confirmLabel: t("core.action.revoke", "Revoke"),
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await api(`auth/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.error) {
        await alertDialog({ title: t("core.apiKeys.revokeTitle", "Revoke API Key"), description: res.error });
        return;
      }
      toast(t("core.apiKeys.revokedToast", "API key revoked."));
      render();
    } catch (err) {
      await alertDialog({ title: t("core.apiKeys.revokeTitle", "Revoke API Key"), description: err.message });
    }
    return;
  }
});
