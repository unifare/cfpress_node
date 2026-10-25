# CFPress REST API Agent Skill & Documentation

> Complete developer and AI Agent guide for integrating with the CFPress Headless CMS REST API.
> Compatible with Cursor (.cursorrules), Claude Projects, Windsurf, Dify Tools, OpenAI GPT Actions, and custom automations.

*Note: For the official AI Agent Skill definition, see [.agents/skills/cfpress-api/SKILL.md](file:///.agents/skills/cfpress-api/SKILL.md).*

---

## 1. Quick Start

### 1.1 Base URL & OpenAPI Specification
- **Gateway Base**: `https://<your-host>/api/v1`
- **Live OpenAPI 3.1 Spec**: `https://<your-host>/api/v1/openapi.json`

### 1.2 Authentication
All requests must include the API Key in the `Authorization` header:
```http
Authorization: Bearer cfp_live_xxxxxxxxxxxxxxxxxxxxxxxx
```
*API keys can be generated with custom site scopes and permission rules in the CFPress Admin UI under **Tools → AI & API Keys** (`/#/api-keys`).*

### 1.3 Tenant Site Scoping
CFPress is multi-tenant. Always specify the target site using the `?site=` query parameter (defaults to `default`):
```bash
curl -X GET "https://<your-host>/api/v1/posts?site=default" \
  -H "Authorization: Bearer cfp_live_YOUR_KEY"
```

---

## 2. API Endpoints Reference

### 2.1 Identity & Stats
- `GET /api/v1/auth/me`: Verify identity, permissions, and allowed sites.
- `GET /api/v1/stats?site={site}`: Site overview, metrics, post/page counts.

### 2.2 Posts (Articles)
- `GET /api/v1/posts?site={site}`: List posts with pagination, type, status, and locale filters.
- `POST /api/v1/posts?site={site}`: Create and publish posts (supports title, slug, content HTML/markdown, status, tags, category terms, and custom meta).
- `GET /api/v1/posts/{id}?site={site}`: Get single post by ID.
- `PUT /api/v1/posts/{id}?site={site}`: Update post fields.
- `DELETE /api/v1/posts/{id}?site={site}`: Delete post.

### 2.3 Pages (Static Pages)
- `GET /api/v1/pages?site={site}`: List static pages.
- `POST /api/v1/pages?site={site}`: Create static page (supports template assignment: `default`, `none`, etc.).
- `GET /api/v1/pages/{id}?site={site}`: Get page by ID.
- `PUT /api/v1/pages/{id}?site={site}`: Update page.
- `DELETE /api/v1/pages/{id}?site={site}`: Delete page.

### 2.4 Batch Operations
- `POST /api/v1/posts/batch?site={site}`: Bulk operate on up to 100 posts.
  - Action `status`: `{"action": "status", "ids": ["..."], "status": "published"}`
  - Action `category`: `{"action": "category", "ids": ["..."], "category_id": "tech"}`
  - Action `delete`: `{"action": "delete", "ids": ["..."]}`
- `POST /api/v1/pages/batch?site={site}`: Same bulk operations for pages.

### 2.5 Taxonomies (Categories & Tags)
- `GET /api/v1/taxonomies?site={site}`: List active taxonomies.
- `GET /api/v1/taxonomies/{taxonomy}/terms?site={site}`: List terms.
- `POST /api/v1/taxonomies/{taxonomy}/terms?site={site}`: Create term with locale support.
- `PUT /api/v1/taxonomies/{taxonomy}/terms/{id}?site={site}`: Update term.
- `DELETE /api/v1/taxonomies/{taxonomy}/terms/{id}?site={site}`: Delete term.

### 2.6 Media Assets
- `GET /api/v1/media?site={site}`: List media files in R2 storage.
- `POST /api/v1/media?site={site}`: Upload media (`multipart/form-data` with `file` and `alt_text`).
- `PATCH /api/v1/media/{id}?site={site}`: Update alt text or metadata.
- `DELETE /api/v1/media/{id}?site={site}`: Delete file from R2 and database.

### 2.7 Custom Theme Tables
- `GET /api/v1/tables/{logical}?site={site}`: Query custom table rows (e.g. books, music, links).
- `POST /api/v1/tables/{logical}?site={site}`: Insert row.
- `GET /api/v1/tables/{logical}/{slug}?site={site}`: Query row by slug.
- `PUT /api/v1/tables/{logical}/{slug}?site={site}`: Update row.
- `DELETE /api/v1/tables/{logical}/{slug}?site={site}`: Delete row.

### 2.8 Site Settings & Themes
- `GET /api/v1/settings?site={site}`: Read settings.
- `POST /api/v1/settings?site={site}`: Batch update site settings.
- `GET /api/v1/extensions/themes?site={site}`: List themes.
- `POST /api/v1/extensions/themes/{name}/activate?site={site}`: Activate theme.
