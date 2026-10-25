---
name: cfpress-theme-dev
description: Complete theme development skill for CFPress Headless CMS. Covers theme directory structure, theme.json manifest contracts, zero-eval template engine syntax, custom tables (tables[]), admin menus (adminMenus[]), UI localization (langs/), and ZIP packaging standards.
---

# CFPress Theme Development — AI Agent Skill

You are an expert Frontend Developer and CMS Architect specializing in creating custom themes for CFPress Headless CMS. Use this skill to design, implement, and package fully-functional, beautiful, responsive themes that strictly comply with CFPress architectural contracts.

---

## 1. Overview & Theme Package Structure
A CFPress theme is completely self-contained in a standard ZIP archive (no server-side compilation or node build step required).
The directory structure inside the ZIP (or theme folder) MUST be:
```text
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
```

---

## 2. Manifest (`theme.json`) Contract & Rules
The `theme.json` file is validated on theme upload/activation. Any invalid declaration causes installation rejection.

### Minimal Valid Example
```json
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
```

### Critical Manifest Rules
1. **`name`**: Must match `^[a-z0-9]+(-[a-z0-9]+)*$` and match the theme directory / zip name.
2. **`templates[]`**: Every declared template name MUST exist at `templates/<name>.html`.
3. **`routes[].resolve`**: Must declare EITHER `"table": "<table_name>"` OR `"type": "<post_type>"`, never both, never neither.
4. **`routes[].resolve.by`**: Must be `"slug"` or `"id"`.
5. **`query.as`**: Must be a valid JavaScript identifier (`[A-Za-z_$][A-Za-z0-9_$]*`). **NEVER use hyphens** (e.g. use `"products"`, NOT `"product-items"`), otherwise the template tokenizer treats it as a subtraction expression.

---

## 3. Custom Business Tables (`tables[]`) Rules
Themes can declare isolated database tables without writing any SQL or backend code:
- **Only 6 allowed field types**: `"text"`, `"longtext"`, `"number"`, `"boolean"`, `"date"`, `"datetime"`.
- **Reserved Column Names (FORBIDDEN in fields)**: `id`, `site_id`, `slug`, `lang_group`, `status`, `created_at`, `updated_at`. The platform automatically creates and manages these.
- **Translatable Columns Rule (Strict)**:
  - Every `"text"` and `"longtext"` field MUST be listed in `translatable: [...]`.
  - `"number"`, `"boolean"`, `"date"`, and `"datetime"` fields MUST NEVER be in `translatable`.
- **Automatic Admin Screen**: When declaring `adminMenus[]` with `"screen": "table-list"` and `"args": { "table": "<table_name>" }`, the platform automatically renders search, pagination, create, and edit forms.

---

## 4. Zero-Eval Template Engine Syntax & Strict Rules
The template engine is pure, safe, and interprets tokens without executing code (`eval`).

### 4.1 Master Layout & Section Slot (Most Critical Pitfall!)
- In parent/layout template (`templates/parts/layout.html`):
  Use `{{@section "content"}}` with **NO CLOSING TAG**. It defines a placeholder slot.
- In child/page template (`templates/index.html`):
  Must extend layout and provide closing tag:
  ```html
  {{@extends "parts/layout"}}
  {{@section "content"}}
    <main>
      <h1>{{site.title}}</h1>
    </main>
  {{/section}}
  ```
  **CRITICAL**: The closing tag MUST be `{{/section}}`. DO NOT write `{{/@section}}`. If `{{/section}}` is missing, the template will render an empty page with HTTP 200!

### 4.2 Helper Call Syntax
- Helper functions MUST be called with parentheses: `{{len(posts)}}`, `{{default(val, fallback)}}`, `{{number(price)}}`.
- Calling `{{len posts}}` will throw a syntax error (`Trailing tokens in expression`).
- Built-in helpers: `len`, `default`, `lower`, `upper`, `truncate`, `join`, `number`, `date`, `contains`.

### 4.3 Template Context Variables
- `site`: `title`, `description`, `robots`, `locale`
- `page`: `title`, `description`, `path`, `kind`, `document_title`
- `locale` / `locales`: Current locale code and list of all supported locales
- `menu.primary`: Primary navigation items (`[{ title, url, target }]`)
- `post`: The current article or page object (`post.title`, `post.html`, `post.meta`, `post.created_at`)
- `posts`: Array of posts on archive/index pages
- `theme`: `name`, `version`, `title`, `settings` (e.g. `{{theme.settings.tagline}}`)

### 4.4 Data Query Directive (`@query`)
Fetch posts or custom table rows directly in templates:
```html
{{@query type="post" limit=6 order="created_at desc" as="latest_posts"}}
  <div class="grid">
    {{#each latest_posts}}
      <article>
        <h3><a href="{{this.url}}">{{this.title}}</a></h3>
      </article>
    {{/each}}
  </div>
{{/query}}
```

### 4.5 Static Assets Path
Static assets in the `assets/` folder are routed at `/themes/<theme-name>/assets/<file-path>`.
Example:
```html
<link rel="stylesheet" href="/themes/my-theme/assets/style.css">
<script src="/themes/my-theme/assets/main.js" defer></script>
```

---

## 5. UI Localization (`langs/`)
If `locales` are declared in `theme.json`, provide flat JSON dictionaries:
- `langs/en.json`:
  ```json
  {
    "theme.my-theme.products": "Products",
    "theme.my-theme.buy_now": "Buy Now"
  }
  ```
- `langs/zh-CN.json`:
  ```json
  {
    "theme.my-theme.products": "产品展示",
    "theme.my-theme.buy_now": "立即购买"
  }
  ```

---

## 6. Theme Packaging & Distribution
1. Build the zip archive containing `theme.json`, `templates/`, `assets/`, and `langs/` directly at the root of the archive:
   ```bash
   cd my-theme/
   zip -r ../my-theme.zip theme.json templates assets langs
   ```
2. Upload via CFPress Admin:
   Navigate to **Appearance > Themes > Upload Theme**, select `my-theme.zip`, and click **Activate**.
   CFPress will automatically create database tables, register admin menus, sync routes, and render your theme immediately!
