---
name: cfpress-api
description: Complete REST API integration skill for CFPress Headless CMS. Covers authentication (Bearer API Keys), site scoping, posts & pages CRUD and batch operations, taxonomies & terms (categories/tags), media upload & asset management, custom theme tables, and site settings.
---

# CFPress REST API Agent Skill

This skill provides comprehensive instructions, endpoint specifications, and code patterns for AI Agents (Cursor, Claude, Windsurf, Dify, GPTs, Copilot) and external automation scripts to interact with a CFPress Headless CMS instance.

---

## 1. Core Architecture & Standards

### 1.1 Base URL
All API v1 endpoints are served relative to the gateway root:
```text
https://<your-cfpress-host>/api/v1
```
The live machine-readable OpenAPI 3.1 specification is always accessible at:
```text
https://<your-cfpress-host>/api/v1/openapi.json
```

### 1.2 Authentication
CFPress supports two authentication mechanisms:
1. **Machine-to-Machine API Keys (Recommended for Agents)**:
   Pass the API key in the HTTP `Authorization` header:
   ```http
   Authorization: Bearer cfp_live_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
   API keys can be generated in the Admin UI under **Tools → AI & API Keys** (`/admin/#/api-keys`). Keys can be scoped to specific sites or granted full permissions (`*`).

2. **Session Cookies (Browser / Admin SPA)**:
   When called from an authenticated browser session, the `cfp_admin_token` cookie is automatically validated.

### 1.3 Multi-Tenant Site Scoping (`?site=`)
CFPress is a multi-tenant platform. Every site has a unique string ID (the primary default site is `"default"`).
- **Rule**: Content, media, taxonomies, and custom tables are tenant-isolated.
- **Usage**: Always append `?site=<site_id>` to query parameters when making API requests. If omitted, the server defaults to `"default"`.
  ```http
  GET /api/v1/posts?site=default
  ```

### 1.4 Multi-Language & Translation Groups
- **Locale parameter**: Pass `?locale=zh-CN` or `?locale=en` to filter or create localized content.
- **Translation Group (`lang_group`)**: Different language versions of the same article or page share a common `lang_group` identifier.

---

## 2. API Endpoints Catalog

### 2.1 Identity & Statistics

#### `GET /api/v1/auth/me`
Verify current authentication identity, assigned role, capabilities, and accessible sites.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/auth/me" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```
- **Response `200 OK`**:
  ```json
  {
    "user": {
      "id": "usr_abc123",
      "username": "editor",
      "role": "admin",
      "sites": ["default", "blog"]
    }
  }
  ```

#### `GET /api/v1/stats?site={site}`
Fetch metrics including total post counts, pages, media, drafts, and recent revisions.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/stats?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```
- **Response `200 OK`**:
  ```json
  {
    "posts": 42,
    "pages": 6,
    "media": 128,
    "drafts": 3,
    "latest": [...]
  }
  ```

---

### 2.2 Posts Management (Articles)

#### `GET /api/v1/posts?site={site}`
List posts with filtering and pagination.
- **Query Parameters**:
  - `site` (string): Site ID (default `"default"`).
  - `status` (string, optional): `"publish"` | `"draft"` | `"future"` | `"trash"`.
  - `locale` (string, optional): Language code (e.g., `"zh-CN"`, `"en"`).
  - `page` (integer, default `1`): Page number.
  - `limit` (integer, default `20`): Items per page.
  - `type` (string, default `"post"`): Post type.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/posts?site=default&status=publish&limit=10" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

#### `POST /api/v1/posts?site={site}`
Create or publish a new article.
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "title": "Getting Started with AI Agents in CFPress",
    "slug": "getting-started-ai-agents",
    "content": "<p>Learn how to connect your automated agents to CFPress...</p>",
    "excerpt": "A comprehensive guide on headless agent workflows.",
    "status": "publish",
    "locale": "en",
    "terms": ["tech-news"],
    "tags": ["AI", "Cloudflare", "Headless CMS"],
    "meta": {
      "featured_image": "https://<your-host>/media/banner.webp",
      "reading_time": "5"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST "https://<your-host>/api/v1/posts?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Automated Post",
      "slug": "automated-post",
      "content": "<p>Published directly via Agent API.</p>",
      "status": "publish"
    }'
  ```

#### `GET /api/v1/posts/{id}?site={site}`
Fetch full details of a specific post, including translations, custom meta, and assigned taxonomy terms.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/posts/pst_12345?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

#### `PUT /api/v1/posts/{id}?site={site}`
Update fields of an existing post.
- **Request Body**: (any subset of fields)
  ```json
  {
    "title": "Updated Title",
    "content": "<p>Refined content.</p>",
    "status": "publish"
  }
  ```

#### `DELETE /api/v1/posts/{id}?site={site}`
Delete a post and its associated metadata.
- **Example cURL**:
  ```bash
  curl -X DELETE "https://<your-host>/api/v1/posts/pst_12345?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

---

### 2.3 Pages Management

#### `GET /api/v1/pages?site={site}`
List standalone static pages.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/pages?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

#### `POST /api/v1/pages?site={site}`
Create a static page.
- **Request Body**:
  ```json
  {
    "title": "About Our Team",
    "slug": "about",
    "content": "<h1>About Us</h1><p>Welcome to our site...</p>",
    "status": "publish",
    "template": "default"
  }
  ```
  *(Note: `template` can be `"none"` for raw unstyled HTML or a theme template name such as `"default"`, `"page"`, `"contact"`).*

#### `PUT /api/v1/pages/{id}?site={site}`
Update page content, template, or status.

#### `DELETE /api/v1/pages/{id}?site={site}`
Delete a static page.

---

### 2.4 Batch Content Operations

CFPress supports high-efficiency batch processing for multiple items simultaneously.

#### `POST /api/v1/posts/batch?site={site}` or `POST /api/v1/pages/batch?site={site}`
Perform bulk changes on up to 100 items at once.

1. **Batch Status Update** (`action: "status"`):
   ```json
   {
     "action": "status",
     "ids": ["pst_001", "pst_002", "pst_003"],
     "status": "published"
   }
   ```
   *(Allowed statuses: `"published"`, `"draft"`, `"scheduled"`, `"private"`).*

2. **Batch Category Assignment** (`action: "category"`):
   ```json
   {
     "action": "category",
     "ids": ["pst_001", "pst_002"],
     "category_id": "category-slug-or-id"
   }
   ```

3. **Batch Deletion** (`action: "delete"`):
   ```json
   {
     "action": "delete",
     "ids": ["pst_001", "pst_002"]
   }
   ```

- **Example cURL**:
  ```bash
  curl -X POST "https://<your-host>/api/v1/posts/batch?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "action": "status",
      "ids": ["pst_abc", "pst_def"],
      "status": "draft"
    }'
  ```

---

### 2.5 Taxonomies & Terms (Categories & Tags)

#### `GET /api/v1/taxonomies?site={site}`
List declared taxonomies (e.g. `category`, `post_tag`).

#### `GET /api/v1/taxonomies/{taxonomy}/terms?site={site}`
List terms under a taxonomy (e.g., `/taxonomies/category/terms` or `/taxonomies/post_tag/terms`).
- **Query Parameters**:
  - `site` (string): Site ID.
  - `locale` (string, optional): Language code.

#### `POST /api/v1/taxonomies/{taxonomy}/terms?site={site}`
Create a category or tag term.
- **Request Body**:
  ```json
  {
    "name": "Artificial Intelligence",
    "slug": "artificial-intelligence",
    "description": "News and tutorials regarding AI and LLM agents.",
    "locale": "en"
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST "https://<your-host>/api/v1/taxonomies/category/terms?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name": "Agent Tech", "slug": "agent-tech"}'
  ```

#### `PUT /api/v1/taxonomies/{taxonomy}/terms/{id}?site={site}`
Update term name, slug, or description.

#### `DELETE /api/v1/taxonomies/{taxonomy}/terms/{id}?site={site}`
Delete a term.

---

### 2.6 Media Assets Management

#### `GET /api/v1/media?site={site}`
List uploaded media files.
- **Query Parameters**: `site`, `page`, `limit`.

#### `POST /api/v1/media?site={site}`
Upload a media asset (image, document, audio) to Cloudflare R2 storage.
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: The binary file upload.
  - `alt_text`: Descriptive text for accessibility and SEO.
- **Example cURL**:
  ```bash
  curl -X POST "https://<your-host>/api/v1/media?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY" \
    -F "file=@/path/to/diagram.png" \
    -F "alt_text=System Architecture Diagram"
  ```
- **Response `201 Created`**:
  ```json
  {
    "id": "med_12345",
    "url": "https://<your-host>/media/diagram.png",
    "filename": "diagram.png",
    "mime_type": "image/png",
    "size": 45120
  }
  ```

#### `PATCH /api/v1/media/{id}?site={site}`
Update media metadata (e.g. `{"alt_text": "Updated caption"}`).

#### `DELETE /api/v1/media/{id}?site={site}`
Delete an asset from R2 storage and database.

---

### 2.7 Theme Custom Data Tables

Themes in CFPress can declare custom schema tables (e.g. `books`, `changelog`, `portfolio`, `links`). These tables automatically inherit multi-tenant isolation, localization, and REST API access.

#### `GET /api/v1/tables/{logical}?site={site}`
Query records from a theme custom table.
- **Query Parameters**:
  - `site` (string): Site ID.
  - `locale` (string, optional): Language code.
  - `limit` (integer, default `50`): Max records.
  - `offset` (integer, default `0`): Pagination offset.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/tables/books?site=default&limit=10" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

#### `POST /api/v1/tables/{logical}?site={site}`
Insert a row into the custom table.
- **Request Body**: Key-value pairs corresponding to the table's schema.
  ```json
  {
    "slug": "designing-data-intensive-applications",
    "title": "Designing Data-Intensive Applications",
    "author": "Martin Kleppmann",
    "rating": 5
  }
  ```

#### `GET /api/v1/tables/{logical}/{slug}?site={site}`
Retrieve a row by its slug.

#### `PUT /api/v1/tables/{logical}/{slug}?site={site}`
Update row fields.

#### `DELETE /api/v1/tables/{logical}/{slug}?site={site}`
Delete a row from the custom table.

---

### 2.8 Site Settings & Themes

#### `GET /api/v1/settings?site={site}`
Read general, SEO, and presentation configuration.
- **Example cURL**:
  ```bash
  curl -X GET "https://<your-host>/api/v1/settings?site=default" \
    -H "Authorization: Bearer cfp_live_YOUR_KEY"
  ```

#### `POST /api/v1/settings?site={site}`
Update site configuration keys in batch.
- **Request Body**:
  ```json
  {
    "site.title": "AI Innovation Hub",
    "site.tagline": "Next-gen content platform",
    "seo.meta_description": "Powered by Cloudflare Workers and CFPress."
  }
  ```

#### `GET /api/v1/extensions/themes?site={site}`
List installed themes and identify which one is active.

#### `POST /api/v1/extensions/themes/{name}/activate?site={site}`
Activate a theme on the specified site.

---

## 3. Practical AI Agent Workflows

### 3.1 Automated Article Publishing Workflow
When an AI Agent is tasked with generating and publishing an article:
1. **Verify Identity & Site**:
   `GET /api/v1/auth/me` to ensure token validity.
2. **Upload Featured Image**:
   `POST /api/v1/media?site=default` (multipart/form-data) to obtain the image URL.
3. **Ensure Category Exists**:
   `GET /api/v1/taxonomies/category/terms?site=default`
   If the target category does not exist, call `POST /api/v1/taxonomies/category/terms?site=default`.
4. **Publish Post**:
   `POST /api/v1/posts?site=default` with title, slug, content HTML, tags array, terms array, and featured image meta.

### 3.2 Content Clean-up & Archiving Workflow
When an agent reviews old draft articles:
1. `GET /api/v1/posts?site=default&status=draft&limit=50`
2. Evaluate items according to user retention rules.
3. Bulk delete unwanted drafts with `POST /api/v1/posts/batch?site=default` using `{"action": "delete", "ids": [...]}`.

---

## 4. Error Codes & Handling Guide

| HTTP Status | Reason | Agent Recovery Action |
|:---|:---|:---|
| **`400 Bad Request`** | Missing required parameters or invalid JSON body | Check error payload message (e.g. `no ids provided`) and adjust request. |
| **`401 Unauthorized`** | Missing or invalid API key | Prompt user to check or regenerate API Key in Admin Console (`/admin/#/api-keys`). |
| **`403 Forbidden`** | Key lacks permissions or site scope | Ensure key was created with full access (`*`) or specific required scopes. |
| **`404 Not Found`** | Resource or endpoint does not exist | Verify path and resource ID; check if tenant `?site=` is correct. |
| **`500 Internal Error`** | Worker exception | Verify database migrations and Cloudflare D1 status. |

---
*Generated for CFPress Headless CMS Developer & AI Agent Ecosystem.*
