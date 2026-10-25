/**
 * The navigation-and-widgets domain: the nav bar's custom items, the widget
 * instances sites compose their sidebars from, and the menu-custom payload
 * normalisers both share.
 *
 * Extracted from `src/api/index.ts` (refactor plan §5, dispatcher pass 3).
 */
import { Env } from "../shared/types";
import { requirePermission } from "../platform/permissions";
import { bumpContentCache } from "../shared/cache";
import { randomId } from "../shared/crypto";
import { activity, jsonBody, now, ok } from "../shared/repo";
import { SessionUser } from "../shared/types";
import { requireSiteAccess } from "./core";
import { collectPluginWidgets } from "../extensions/plugin/runtime";
const MENU_CUSTOM_KEY = "admin.menu.custom";
const LABEL_LOCALE_RE = /^[A-Za-z0-9-]{2,10}$/;
const LABEL_MAX_LOCALES = 8;
const ITEM_KEY_RE = /^[A-Za-z0-9:_-]{1,120}$/;
const GROUP_ID_RE = /^[a-z][a-z0-9-]{0,59}$/;
const CORE_WIDGET_TYPES = new Set(["text", "html", "recent-posts", "menu", "search", "categories", "tag-cloud", "tags"]);


// placeholder: replaced by the batch-3 move

export async function dispatchNavAndWidgetRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  const resourceMatch = path.match(/^(locales|redirects|rewrites|plugins|themes|menus|menu_items)$/);
  if (resourceMatch && method === "GET") return genericTable(env, resourceMatch[1], url, siteId);

  if (path === "menus" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM menus WHERE site_id=? ORDER BY name").bind(siteId).all();
    return ok({ items: rows.results, site: siteId });
  }
  if (path === "menus" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const id = b.id || `menu_${await randomId()}`;
    await env.DB.prepare(
      "INSERT INTO menus (id,site_id,name,location,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(site_id,id) DO UPDATE SET name=excluded.name,location=excluded.location,updated_at=excluded.updated_at"
    ).bind(id, siteId, String(b.name || "Menu"), b.location || "header", now(), now()).run();
    return ok({ id, site: siteId }, 201);
  }
  const mm = path.match(/^menus\/([^/]+)\/items$/);
  if (mm && method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM menu_items WHERE site_id=? AND menu_id=? ORDER BY sort_order,id").bind(siteId, mm[1]).all();
    return ok({ items: r.results, site: siteId });
  }
  if (mm && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const id = await randomId();
    await env.DB.prepare("INSERT INTO menu_items (id,site_id,menu_id,parent_id,title,url,target,sort_order,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id, siteId, mm[1], b.parent_id || null, String(b.title || ""), String(b.url || "#"), b.target || null, Number(b.sort_order || 0), b.locale || null, now(), now()).run();
    return ok({ id, site: siteId }, 201);
  }
  if (mm && method === "PUT") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    if (!Array.isArray(b.order)) return ok({ error: "order array required" }, 400);
    const ids = (b.order as unknown[]).map(String);
    const rows = await env.DB.prepare("SELECT id FROM menu_items WHERE site_id=? AND menu_id=?").bind(siteId, mm[1]).all();
    const known = new Set(((rows.results as any[]) ?? []).map(r => String(r.id)));
    if (ids.some(id => !known.has(id))) return ok({ error: "unknown item in order" }, 400);
    let n = 0;
    for (const id of ids) {
      await env.DB.prepare("UPDATE menu_items SET sort_order=?,updated_at=? WHERE site_id=? AND menu_id=? AND id=?").bind(n++, now(), siteId, mm[1], id).run();
    }
    await activity(env, user.id, "update", "menu_items", mm[1], { count: ids.length });
    return ok({ ok: true, count: ids.length });
  }
  const mdm = path.match(/^menus\/([^/]+)$/);
  if (mdm && method === "PUT") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const location = String(b.location || "").trim();
    if (!location) return ok({ error: "location required" }, 400);
    const r = await env.DB.prepare("UPDATE menus SET name=?,location=?,updated_at=? WHERE site_id=? AND id=?").bind(String(b.name || "Menu"), location, now(), siteId, mdm[1]).run();
    if (!r.meta.changes) return ok({ error: "menu not found" }, 404);
    await activity(env, user.id, "update", "menu", mdm[1]);
    return ok({ ok: true });
  }
  if (mdm && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    await env.DB.prepare("DELETE FROM menu_items WHERE site_id=? AND menu_id=?").bind(siteId, mdm[1]).run();
    const r = await env.DB.prepare("DELETE FROM menus WHERE site_id=? AND id=?").bind(siteId, mdm[1]).run();
    if (!r.meta.changes) return ok({ error: "menu not found" }, 404);
    await activity(env, user.id, "delete", "menu", mdm[1]);
    return ok({ ok: true });
  }
  const mim = path.match(/^menu_items\/([^/]+)$/);
  if (mim && method === "PUT") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const cur = await env.DB.prepare("SELECT id,menu_id,parent_id,title,url,target,locale FROM menu_items WHERE site_id=? AND id=?").bind(siteId, mim[1]).first<any>();
    if (!cur) return ok({ error: "item not found" }, 404);
    let parentId: string | null;
    if (b.parent_id === undefined) { parentId = cur.parent_id ?? null; }
    else {
      parentId = b.parent_id ? String(b.parent_id) : null;
      if (parentId) {
        if (parentId === mim[1]) return ok({ error: "item cannot be its own parent" }, 400);
        const p = await env.DB.prepare("SELECT parent_id FROM menu_items WHERE site_id=? AND menu_id=? AND id=?").bind(siteId, cur.menu_id, parentId).first<any>();
        if (!p) return ok({ error: "parent not in the same menu" }, 400);
        if (p.parent_id) return ok({ error: "nesting beyond one level is not supported" }, 400);
      }
    }
    await env.DB.prepare("UPDATE menu_items SET title=?,url=?,target=?,locale=?,parent_id=?,updated_at=? WHERE site_id=? AND id=?")
      .bind(b.title === undefined ? String(cur.title ?? "") : String(b.title), b.url === undefined ? String(cur.url ?? "#") : String(b.url), b.target === undefined ? (cur.target ?? null) : (b.target || null), b.locale === undefined ? (cur.locale ?? null) : (b.locale || null), parentId, now(), siteId, mim[1]).run();
    await activity(env, user.id, "update", "menu_item", mim[1]);
    return ok({ ok: true });
  }
  if (mim && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const r = await env.DB.prepare("DELETE FROM menu_items WHERE site_id=? AND id=?").bind(siteId, mim[1]).run();
    if (!r.meta.changes) return ok({ error: "item not found" }, 404);
    await env.DB.prepare("UPDATE menu_items SET parent_id=NULL WHERE site_id=? AND parent_id=?").bind(siteId, mim[1]).run();
    await activity(env, user.id, "delete", "menu_item", mim[1]);
    return ok({ ok: true });
  }

  // -- widgets ----------------------------------------------------------------
  if (path === "widgets/types" && method === "GET") {
    // 1. Core widget types
    const coreItems = [
      {
        type: "core.text",
        name: "Text",
        title: "Text",
        description: "Arbitrary text with auto-paragraphs",
        icon: "file-text",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "body", label: "Content", type: "textarea", required: true },
        ],
      },
      {
        type: "core.html",
        name: "Custom HTML",
        title: "Custom HTML",
        description: "Raw HTML / embed code",
        icon: "puzzle",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "body", label: "HTML Code", type: "textarea", required: true },
        ],
      },
      {
        type: "core.recent-posts",
        name: "Recent Posts",
        title: "Recent Posts",
        description: "List of recently published posts",
        icon: "layers",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "count", label: "Number of Posts", type: "number", default: 5, min: 1, max: 20 },
        ],
      },
      {
        type: "core.menu",
        name: "Navigation Menu",
        title: "Navigation Menu",
        description: "Display a site navigation menu",
        icon: "menu",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "menu_id", label: "Select Menu", type: "select", options: "menus", required: true },
        ],
      },
      {
        type: "core.search",
        name: "Search Bar",
        title: "Search Bar",
        description: "Interactive search box for site contents",
        icon: "search",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "placeholder", label: "Placeholder Text", type: "text", default: "Search..." },
        ],
      },
      {
        type: "core.categories",
        name: "Categories",
        title: "Categories",
        description: "List of post categories and archives",
        icon: "folder",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "show_count", label: "Show Post Count", type: "boolean", default: true },
        ],
      },
      {
        type: "core.tag-cloud",
        name: "Tag Cloud",
        title: "Tag Cloud",
        description: "Display popular tags or taxonomy terms as a cloud",
        icon: "tag",
        category: "core",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "taxonomy", label: "Taxonomy", type: "text", default: "tag" },
          { name: "count", label: "Number of Tags", type: "number", default: 30, min: 1, max: 100 },
          {
            name: "order_by",
            label: "Order By",
            type: "select",
            options: [
              { value: "count", label: "Popularity (Post count)" },
              { value: "name", label: "Name (Alphabetical)" },
            ],
            default: "count",
          },
        ],
      },
    ];

    // 2. Theme types (from active theme blocks or declared widgets)
    const themeItems: any[] = [];
    try {
      const themeBlocks = await env.DB.prepare(
        "SELECT * FROM theme_blocks WHERE site_id=? ORDER BY name"
      ).bind(siteId).all();
      for (const tb of (themeBlocks.results as any[]) ?? []) {
        themeItems.push({
          type: `theme.${tb.name}`,
          name: tb.title || tb.name,
          title: tb.title || tb.name,
          description: `Theme block template: ${tb.name}`,
          icon: "palette",
          category: "theme",
          fields: [{ name: "title", label: "Title", type: "text" }],
        });
      }
    } catch {}

    // 3. Plugin types — delegated to the extension layer so the API never
    // knows about individual plugin tables (e.g. plugin_forms_forms).
    const pluginItems = await collectPluginWidgets(env, siteId).catch(() => [] as any[]);


    // 4. Custom types (from custom_widget_types for this site)
    const customItems: any[] = [];
    try {
      const customs = await env.DB.prepare(
        "SELECT * FROM custom_widget_types WHERE site_id=? ORDER BY created_at DESC"
      ).bind(siteId).all();
      for (const row of (customs.results as any[]) ?? []) {
        let fields: any[] = [];
        try { fields = JSON.parse(String(row.schema_json || "[]")); } catch {}
        customItems.push({
          id: row.id,
          type: row.type,
          name: row.name,
          title: row.name,
          description: row.description || "",
          icon: row.icon || "puzzle",
          category: "custom",
          template: row.template || "",
          schema_json: row.schema_json || "[]",
          fields: Array.isArray(fields) && fields.length ? fields : [{ name: "title", label: "Title", type: "text" }],
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }
    } catch {}

    return ok({
      site: siteId,
      items: [...coreItems, ...themeItems, ...pluginItems, ...customItems],
    });
  }

  // Custom widget types CRUD
  if (path === "widgets/custom-types" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const name = String(b.name || "").trim();
    if (!name) return ok({ error: "Widget name is required" }, 400);

    let rawType = String(b.type || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!rawType) rawType = `custom_${await randomId().then((s) => s.slice(0, 6))}`;
    const type = rawType.startsWith("custom.") ? rawType : `custom.${rawType.replace(/^custom_/, "")}`;

    const description = String(b.description || "").trim();
    const iconName = String(b.icon || "puzzle").trim();
    const template = String(b.template || "").trim();
    const schema_json = typeof b.schema_json === "string" ? b.schema_json : JSON.stringify(b.fields || []);

    const existing = await env.DB.prepare("SELECT id FROM custom_widget_types WHERE site_id=? AND type=?").bind(siteId, type).first<any>();
    if (existing) return ok({ error: `Widget type '${type}' already exists` }, 409);

    const ts = now();
    const id = `cwt_${await randomId()}`;
    await env.DB.prepare(
      "INSERT INTO custom_widget_types (id, site_id, type, name, description, icon, template, schema_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, siteId, type, name, description, iconName, template, schema_json, ts, ts).run();

    await bumpContentCache(env, siteId);
    await activity(env, user.id, "create", "custom_widget_type", id);
    return ok({ ok: true, id, type, site: siteId }, 201);
  }

  const cwtMatch = path.match(/^widgets\/custom-types\/([^/]+)$/);
  if (cwtMatch && (method === "PUT" || method === "POST")) {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const cur = await env.DB.prepare("SELECT * FROM custom_widget_types WHERE site_id=? AND id=?").bind(siteId, cwtMatch[1]).first<any>();
    if (!cur) return ok({ error: "Custom widget type not found" }, 404);

    const b = await jsonBody(request);
    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    const description = b.description !== undefined ? String(b.description).trim() : cur.description;
    const iconName = b.icon !== undefined ? String(b.icon).trim() : cur.icon;
    const template = b.template !== undefined ? String(b.template) : cur.template;
    const schema_json = b.schema_json !== undefined
      ? (typeof b.schema_json === "string" ? b.schema_json : JSON.stringify(b.schema_json))
      : (b.fields !== undefined ? JSON.stringify(b.fields) : cur.schema_json);

    const ts = now();
    await env.DB.prepare(
      "UPDATE custom_widget_types SET name=?, description=?, icon=?, template=?, schema_json=?, updated_at=? WHERE site_id=? AND id=?"
    ).bind(name, description, iconName, template, schema_json, ts, siteId, cwtMatch[1]).run();

    await bumpContentCache(env, siteId);
    await activity(env, user.id, "update", "custom_widget_type", cwtMatch[1]);
    return ok({ ok: true, site: siteId });
  }

  if (cwtMatch && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const cur = await env.DB.prepare("SELECT * FROM custom_widget_types WHERE site_id=? AND id=?").bind(siteId, cwtMatch[1]).first<any>();
    if (!cur) return ok({ error: "Custom widget type not found" }, 404);

    await env.DB.prepare("DELETE FROM custom_widget_types WHERE site_id=? AND id=?").bind(siteId, cwtMatch[1]).run();
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "delete", "custom_widget_type", cwtMatch[1]);
    return ok({ ok: true, site: siteId });
  }

  if (path === "widgets" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM widget_instances WHERE site_id=? ORDER BY sidebar,sort_order,id").bind(siteId).all();
    return ok({ items: rows.results, site: siteId });
  }
  if (path === "widgets" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const type = String(b.widget_type || "text");
    if (!(await isWidgetTypeAllowed(siteId, env, type))) return ok({ error: `unknown or disallowed widget_type: ${type}` }, 400);
    let cfg: Record<string, unknown>;
    try { cfg = await normaliseWidgetConfig(siteId, env, type, b.config); } catch (e: any) { return ok({ error: e?.message || "invalid config" }, 400); }
    const id = await randomId();
    const sidebar = String(b.sidebar || "sidebar");
    let sortOrder: number;
    if (b.sort_order !== undefined && b.sort_order !== null && b.sort_order !== "" && !isNaN(Number(b.sort_order))) {
      sortOrder = Number(b.sort_order);
    } else {
      const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM widget_instances WHERE site_id=? AND sidebar=?")
        .bind(siteId, sidebar).first<any>();
      sortOrder = Number(maxRow?.max_order ?? 0) + 10;
    }
    await env.DB.prepare("INSERT INTO widget_instances (id,site_id,sidebar,widget_type,title,config,sort_order,enabled,locale) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, siteId, sidebar, type, String(b.title || ""), JSON.stringify(cfg), sortOrder, b.enabled === false ? 0 : 1, String(b.locale || "")).run();
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "create", "widget", id);
    return ok({ id, site: siteId, sort_order: sortOrder }, 201);
  }
  const wim = path.match(/^widgets\/([^/]+)$/);
  if (wim && method === "PUT") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const cur = await env.DB.prepare("SELECT * FROM widget_instances WHERE site_id=? AND id=?").bind(siteId, wim[1]).first<any>();
    if (!cur) return ok({ error: "widget not found" }, 404);
    const b = await jsonBody(request);
    const type = String(b.widget_type || cur.widget_type);
    if (!(await isWidgetTypeAllowed(siteId, env, type))) return ok({ error: `unknown or disallowed widget_type: ${type}` }, 400);
    let cfg: Record<string, unknown>;
    try { cfg = await normaliseWidgetConfig(siteId, env, type, b.config === undefined ? JSON.parse(String(cur.config || "{}")) : b.config); } catch (e: any) { return ok({ error: e?.message || "invalid config" }, 400); }
    await env.DB.prepare("UPDATE widget_instances SET sidebar=?,widget_type=?,title=?,config=?,sort_order=?,enabled=?,locale=? WHERE site_id=? AND id=?")
      .bind(String(b.sidebar || cur.sidebar), type, b.title === undefined ? String(cur.title ?? "") : String(b.title), JSON.stringify(cfg), b.sort_order === undefined ? Number(cur.sort_order || 0) : Number(b.sort_order), b.enabled === undefined ? Number(cur.enabled ?? 1) : (b.enabled ? 1 : 0), b.locale === undefined ? String(cur.locale || "") : String(b.locale || ""), siteId, wim[1]).run();
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "update", "widget", wim[1]);
    return ok({ ok: true });
  }
  if (wim && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const r = await env.DB.prepare("DELETE FROM widget_instances WHERE site_id=? AND id=?").bind(siteId, wim[1]).run();
    if (!r.meta.changes) return ok({ error: "widget not found" }, 404);
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "delete", "widget", wim[1]);
    return ok({ ok: true });
  }

  return null;
}

async function isWidgetTypeAllowed(siteId: string, env: Env, type: string): Promise<boolean> {
  const norm = type.replace(/^core\./, "");
  if (CORE_WIDGET_TYPES.has(norm)) return true;
  if (type.startsWith("custom.")) {
    const row = await env.DB.prepare("SELECT id FROM custom_widget_types WHERE site_id=? AND type=?").bind(siteId, type).first<any>();
    return !!row;
  }
  if (type.startsWith("theme.") || type.startsWith("plugin.")) return true;
  return false;
}

async function normaliseWidgetConfig(siteId: string, env: Env, type: string, cfg: unknown): Promise<Record<string, unknown>> {
  const c = (cfg && typeof cfg === "object" && !Array.isArray(cfg)) ? cfg as Record<string, unknown> : {};
  const norm = type.replace(/^core\./, "");
  if (norm === "text" || norm === "html") return { body: String(c.body ?? "") };
  if (norm === "recent-posts") {
    const n = Math.round(Number(c.count ?? 5));
    if (!Number.isFinite(n) || n < 1 || n > 20) throw new Error("recent-posts count must be 1-20");
    return { count: n };
  }
  if (norm === "menu") {
    const menuId = String(c.menu_id ?? "");
    if (!menuId) throw new Error("menu widget needs menu_id");
    const m = await env.DB.prepare("SELECT id FROM menus WHERE site_id=? AND id=?").bind(siteId, menuId).first<any>();
    if (!m) throw new Error("menu_id does not exist on this site");
    return { menu_id: menuId };
  }
  if (norm === "search") {
    return { title: String(c.title ?? ""), placeholder: String(c.placeholder ?? "Search...") };
  }
  if (norm === "categories") {
    return { title: String(c.title ?? ""), show_count: c.show_count ? 1 : 0 };
  }
  if (norm === "tag-cloud" || norm === "tags") {
    const count = Math.min(100, Math.max(1, Math.round(Number(c.count ?? 30))));
    const taxonomy = String(c.taxonomy ?? "tag").trim() || "tag";
    const order_by = String(c.order_by ?? "count") === "name" ? "name" : "count";
    return { title: String(c.title ?? ""), count, taxonomy, order_by };
  }
  return c;
}

export async function dispatchAdminMenuCustomRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string
): Promise<Response | null> {
  // -- site-level admin menu customization (batch 5) ------------------------
  if (path === "admin-menus/custom" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=? AND key=?").bind(siteId, MENU_CUSTOM_KEY).first<any>();
    let parsed: any = {};
    try { parsed = row?.value ? JSON.parse(row.value) : {}; } catch { parsed = {}; }
    return ok({
      items: parsed.items && typeof parsed.items === "object" && !Array.isArray(parsed.items) ? parsed.items : {},
      groups: parsed.groups && typeof parsed.groups === "object" && !Array.isArray(parsed.groups) ? parsed.groups : {},
      can_manage: await requirePermission(env, user, "settings.manage", siteId),
    });
  }
  if (path === "admin-menus/custom" && method === "PUT") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    let blob: { items: Record<string, unknown>; groups: Record<string, unknown> };
    try {
      blob = normaliseMenuCustom(b);
    } catch (e: any) {
      return ok({ error: e?.message || "invalid menu customization" }, 400);
    }
    await env.DB.prepare("INSERT INTO settings(id,site_id,key,value,autoload) VALUES(?,?,?,?,1) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value")
      .bind(`admin-menu-custom-${siteId}`, siteId, MENU_CUSTOM_KEY, JSON.stringify(blob)).run();
    await activity(env, user.id, "update", "menu_custom", siteId, { items: Object.keys(blob.items).length, groups: Object.keys(blob.groups).length });
    return ok({ ok: true, ...blob });
  }
  if (path === "admin-menus/custom" && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    await env.DB.prepare("DELETE FROM settings WHERE site_id=? AND key=?").bind(siteId, MENU_CUSTOM_KEY).run();
    await activity(env, user.id, "delete", "menu_custom", siteId, {});
    return ok({ ok: true, items: {}, groups: {} });
  }

  return null;
}

function normaliseMenuCustomLabel(v: unknown, what: string): Record<string, string> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${what}: label must be an object of locale -> string`);
  const out: Record<string, string> = {};
  for (const [loc, val] of Object.entries(v as Record<string, unknown>).slice(0, LABEL_MAX_LOCALES)) {
    if (!LABEL_LOCALE_RE.test(loc)) throw new Error(`${what}: bad locale in label: ${loc}`);
    if (typeof val !== "string" || !val.trim()) throw new Error(`${what}: label for ${loc} must be a non-empty string`);
    if (val.length > 120) throw new Error(`${what}: label for ${loc} is longer than 120 characters`);
    out[loc] = val.trim();
  }
  return Object.keys(out).length ? out : null;
}

function normaliseMenuCustomOrder(v: unknown, what: string): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < -100000 || n > 100000) throw new Error(`${what}: order must be an integer`);
  return n;
}

/**
 * Normalize a PUT admin-menus/custom body into the storage blob. Throws with a
 * human-readable message on structural violations (the endpoint maps that to a
 * 400); unknown fields are dropped so the stored shape stays exactly what the
 * SPA consumes.
 */
function normaliseMenuCustom(b: unknown): { items: Record<string, unknown>; groups: Record<string, unknown> } {
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw new Error("body must be an object");
  const body = b as Record<string, unknown>;
  const rawItems = body.items ?? {};
  if (typeof rawItems !== "object" || Array.isArray(rawItems)) throw new Error("items must be an object");
  const itemKeys = Object.keys(rawItems as Record<string, unknown>);
  if (itemKeys.length > 200) throw new Error("too many item overrides (max 200)");
  const items: Record<string, unknown> = {};
  for (const key of itemKeys) {
    const what = `item ${key}`;
    if (!ITEM_KEY_RE.test(key)) throw new Error(`${what}: bad key`);
    const v = (rawItems as Record<string, unknown>)[key];
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${what}: must be an object`);
    const row = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const label = normaliseMenuCustomLabel(row.label, what);
    if (label) out.label = label;
    const order = normaliseMenuCustomOrder(row.order, what);
    if (order !== null) out.order = order;
    if (row.group !== undefined && row.group !== null) {
      if (typeof row.group !== "string" || !GROUP_ID_RE.test(row.group)) throw new Error(`${what}: bad group id`);
      out.group = row.group;
    }
    if (row.hidden !== undefined && row.hidden !== null) {
      if (typeof row.hidden !== "boolean") throw new Error(`${what}: hidden must be a boolean`);
      out.hidden = row.hidden;
    }
    if (Object.keys(out).length) items[key] = out;
  }
  const rawGroups = body.groups ?? {};
  if (typeof rawGroups !== "object" || Array.isArray(rawGroups)) throw new Error("groups must be an object");
  const groupKeys = Object.keys(rawGroups as Record<string, unknown>);
  if (groupKeys.length > 30) throw new Error("too many group overrides (max 30)");
  const groups: Record<string, unknown> = {};
  for (const id of groupKeys) {
    const what = `group ${id}`;
    if (!GROUP_ID_RE.test(id)) throw new Error(`${what}: bad group id`);
    const v = (rawGroups as Record<string, unknown>)[id];
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${what}: must be an object`);
    const row = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const label = normaliseMenuCustomLabel(row.label, what);
    if (label) out.label = label;
    const order = normaliseMenuCustomOrder(row.order, what);
    if (order !== null) out.order = order;
    if (Object.keys(out).length) groups[id] = out;
  }
  return { items, groups };
}

async function genericTable(env: Env, table: string, url: URL, siteId: string) {
  const allowed = new Set(["locales", "redirects", "rewrites", "plugins", "themes", "menus", "menu_items"]);
  if (!allowed.has(table)) return ok({ error: "Unsupported resource" }, 404);
  // Tables that carry site_id are filtered; global registries (plugins/themes)
  // are not, because an extension install is shared by every site.
  const scoped = new Set(["menus", "menu_items", "redirects", "rewrites"]);
  const sql = scoped.has(table)
    ? `SELECT * FROM ${table} WHERE site_id=? ORDER BY rowid DESC LIMIT 500`
    : `SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 500`;
  const rows = scoped.has(table)
    ? await env.DB.prepare(sql).bind(siteId).all()
    : await env.DB.prepare(sql).all();
  return ok({ items: rows.results, site: siteId });
}
