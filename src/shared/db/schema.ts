/**
 * Drizzle ORM schema for all 52 CFPress platform tables (`PLATFORM_SCHEMA`).
 *
 * Every table declared in `src/extensions/contract/schema.ts` has a typed
 * Drizzle table definition here matching the migration stream
 * (`content/migrations/`) and is registered in `PLATFORM_DRIZZLE_TABLES`.
 */

import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const adminActivity = sqliteTable("admin_activity", {
  id: text("id").primaryKey(),
  user_id: text("user_id"),
  action: text("action").notNull(),
  entity_type: text("entity_type"),
  entity_id: text("entity_id"),
  meta: text("meta"),
  created_at: integer("created_at").notNull(),
  ip: text("ip"),
});

export const adminMenuRegistry = sqliteTable("admin_menu_registry", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  owner_type: text("owner_type").notNull(),
  owner_name: text("owner_name").notNull(),
  menu_id: text("menu_id").notNull(),
  label: text("label").notNull(),
  icon: text("icon"),
  screen: text("screen").notNull(),
  args_json: text("args_json").notNull().default("{}"),
  capability: text("capability"),
  sort_order: integer("sort_order").notNull().default(50),
  enabled: integer("enabled").notNull().default(1),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  label_key: text("label_key"),
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  expires_at: integer("expires_at").notNull(),
  created_at: integer("created_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  key_prefix: text("key_prefix").notNull(),
  key_hash: text("key_hash").notNull(),
  scopes: text("scopes").notNull().default('["*"]'),
  sites: text("sites").notNull().default('["*"]'),
  status: text("status").notNull().default("active"),
  expires_at: integer("expires_at"),
  last_used_at: integer("last_used_at"),
  created_at: integer("created_at").notNull(),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  post_id: text("post_id").notNull(),
  parent_id: text("parent_id"),
  author_member_id: text("author_member_id"),
  author_name: text("author_name").notNull().default(""),
  author_email: text("author_email").notNull().default(""),
  author_url: text("author_url").notNull().default(""),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  ip_hash: text("ip_hash").notNull().default(""),
  user_agent: text("user_agent").notNull().default(""),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const contentCacheVersions = sqliteTable("content_cache_versions", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  updated_at: integer("updated_at").notNull(),
});

export const customWidgetTypes = sqliteTable("custom_widget_types", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default(""),
  template: text("template").notNull().default(""),
  schema_json: text("schema_json").notNull().default("[]"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const extensionCapabilities = sqliteTable(
  "extension_capabilities",
  {
    extension_type: text("extension_type").notNull(),
    extension_name: text("extension_name").notNull(),
    capability: text("capability").notNull(),
    enabled: integer("enabled").notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.extension_type, t.extension_name, t.capability] }),
  })
);

export const extensionVersions = sqliteTable("extension_versions", {
  id: text("id").primaryKey(),
  extension_type: text("extension_type").notNull(),
  extension_name: text("extension_name").notNull(),
  version: text("version").notNull(),
  package_key: text("package_key").notNull(),
  checksum: text("checksum").notNull(),
  manifest: text("manifest").notNull(),
  installed_at: integer("installed_at").notNull(),
});

export const fieldDefs = sqliteTable("field_defs", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  meta_key: text("meta_key").notNull(),
  label: text("label").notNull(),
  field_type: text("field_type").notNull(),
  post_types: text("post_types").notNull(),
  required: integer("required").notNull().default(0),
  default_value: text("default_value"),
  sort_order: integer("sort_order").notNull().default(0),
  declared_by_theme: text("declared_by_theme"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const i18nOverrides = sqliteTable(
  "i18n_overrides",
  {
    site_id: text("site_id").notNull(),
    locale: text("locale").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.locale, t.key] }),
  })
);

export const locales = sqliteTable("locales", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  is_default: integer("is_default").notNull().default(0),
  native_name: text("native_name").notNull().default(""),
  direction: text("direction").notNull().default("ltr"),
  enabled: integer("enabled").notNull().default(1),
  sort_order: integer("sort_order").notNull().default(0),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  first_at: integer("first_at").notNull(),
  blocked_until: integer("blocked_until").notNull().default(0),
});

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  object_key: text("object_key").notNull(),
  filename: text("filename").notNull(),
  mime_type: text("mime_type").notNull(),
  size: integer("size").notNull().default(0),
  alt_text: text("alt_text"),
  title: text("title"),
  width: integer("width"),
  height: integer("height"),
  created_at: integer("created_at").notNull(),
  site_id: text("site_id").notNull().default("default"),
  uploaded_by: text("uploaded_by"),
  storage: text("storage").notNull().default("r2"),
  remote_url: text("remote_url"),
  remote_delete_url: text("remote_delete_url"),
});

export const memberSessions = sqliteTable("member_sessions", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  member_id: text("member_id").notNull(),
  expires_at: integer("expires_at").notNull(),
  created_at: integer("created_at").notNull(),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  username: text("username").notNull(),
  email: text("email"),
  display_name: text("display_name").notNull().default(""),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull().default("subscriber"),
  status: text("status").notNull().default("active"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const menuItems = sqliteTable(
  "menu_items",
  {
    site_id: text("site_id").notNull(),
    id: text("id").notNull(),
    menu_id: text("menu_id").notNull(),
    parent_id: text("parent_id"),
    title: text("title").notNull(),
    url: text("url").notNull(),
    target: text("target"),
    sort_order: integer("sort_order").notNull().default(0),
    locale: text("locale").notNull().default(""),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.id] }),
  })
);

export const menus = sqliteTable(
  "menus",
  {
    site_id: text("site_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    location: text("location"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.id] }),
  })
);

export const notificationLog = sqliteTable("notification_log", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  plugin_name: text("plugin_name").notNull(),
  channel: text("channel").notNull(),
  dedup_key: text("dedup_key"),
  title: text("title"),
  content: text("content").notNull(),
  payload: text("payload"),
  ok: integer("ok").notNull().default(0),
  error: text("error"),
  created_at: integer("created_at").notNull(),
});

export const platformSettings = sqliteTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  autoload: integer("autoload").notNull().default(1),
});

export const pluginInstalls = sqliteTable("plugin_installs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull(),
  enabled: integer("enabled").notNull().default(0),
  manifest: text("manifest").notNull(),
  installed_at: integer("installed_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const pluginSettingDefs = sqliteTable(
  "plugin_setting_defs",
  {
    plugin_name: text("plugin_name").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    default_value: text("default_value"),
    options: text("options"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.plugin_name, t.key] }),
  })
);

export const pluginSettings = sqliteTable(
  "plugin_settings",
  {
    plugin_id: text("plugin_id").notNull(),
    key: text("key").notNull(),
    value: text("value"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.plugin_id, t.key] }),
  })
);

export const postAutosaves = sqliteTable(
  "post_autosaves",
  {
    post_id: text("post_id").notNull(),
    user_id: text("user_id").notNull(),
    locale: text("locale").notNull(),
    title: text("title").notNull().default(""),
    excerpt: text("excerpt").notNull().default(""),
    content: text("content").notNull().default(""),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.post_id, t.user_id, t.locale] }),
  })
);

export const postMeta = sqliteTable(
  "post_meta",
  {
    post_id: text("post_id").notNull(),
    meta_key: text("meta_key").notNull(),
    locale: text("locale").notNull().default(""),
    meta_value: text("meta_value"),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.post_id, t.meta_key, t.locale] }),
  })
);

export const postRevisions = sqliteTable("post_revisions", {
  id: text("id").primaryKey(),
  post_id: text("post_id").notNull(),
  author_id: text("author_id").notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  locale: text("locale").notNull(),
  created_at: integer("created_at").notNull(),
});

export const postTranslations = sqliteTable("post_translations", {
  id: text("id").primaryKey(),
  post_id: text("post_id").notNull(),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  slug: text("slug").notNull().default(""),
});

export const postTypes = sqliteTable(
  "post_types",
  {
    site_id: text("site_id").notNull(),
    name: text("name").notNull(),
    label: text("label").notNull(),
    singular_label: text("singular_label").notNull(),
    plural_label: text("plural_label").notNull(),
    supports: text("supports").notNull(),
    has_archive: integer("has_archive").notNull().default(1),
    rewrite_slug: text("rewrite_slug").notNull(),
    declared_by_theme: text("declared_by_theme"),
    active: integer("active").notNull().default(1),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.name] }),
  })
);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  author_id: text("author_id").notNull(),
  type: text("type").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  lang_group: text("lang_group").notNull().default(""),
  author_member_id: text("author_member_id"),
  template: text("template").notNull().default(""),
});

export const redirects = sqliteTable("redirects", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  status: integer("status").notNull().default(301),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const rewrites = sqliteTable("rewrites", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  from_path: text("from_path").notNull(),
  to_path: text("to_path").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    enabled: integer("enabled").notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.permission] }),
  })
);

export const scheduledPosts = sqliteTable("scheduled_posts", {
  post_id: text("post_id").primaryKey(),
  publish_at: integer("publish_at").notNull(),
  processed_at: integer("processed_at"),
});

export const seoMeta = sqliteTable("seo_meta", {
  id: text("id").primaryKey(),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id").notNull(),
  locale: text("locale").notNull(),
  title: text("title"),
  description: text("description"),
  canonical: text("canonical"),
  robots: text("robots"),
  og_image: text("og_image"),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  autoload: integer("autoload").notNull().default(1),
});

export const shortcodes = sqliteTable("shortcodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  config: text("config").notNull().default("{}"),
});

export const siteLocales = sqliteTable(
  "site_locales",
  {
    site_id: text("site_id").notNull(),
    code: text("code").notNull(),
    is_default: integer("is_default").notNull().default(0),
    enabled: integer("enabled").notNull().default(1),
    sort_order: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.code] }),
  })
);

export const siteSnapshots = sqliteTable("site_snapshots", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  name: text("name").notNull(),
  trigger_type: text("trigger_type").notNull().default("manual"),
  summary: text("summary").notNull().default("{}"),
  data: text("data").notNull().default("{}"),
  created_at: integer("created_at").notNull(),
});

export const siteUsers = sqliteTable("site_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email"),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull().default("author"),
  status: text("status").notNull().default("active"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  ui_lang: text("ui_lang"),
  menu_prefs: text("menu_prefs"),
});

export const siteUsersSites = sqliteTable(
  "site_users_sites",
  {
    user_id: text("user_id").notNull(),
    site_id: text("site_id").notNull(),
    role: text("role").notNull().default("author"),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.site_id] }),
  })
);

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host"),
  path_prefix: text("path_prefix").notNull().default("/"),
  is_default: integer("is_default").notNull().default(0),
  status: text("status").notNull().default("active"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const taxonomies = sqliteTable(
  "taxonomies",
  {
    site_id: text("site_id").notNull(),
    name: text("name").notNull(),
    label: text("label").notNull(),
    post_types: text("post_types").notNull(),
    hierarchical: integer("hierarchical").notNull().default(0),
    declared_by_theme: text("declared_by_theme"),
    active: integer("active").notNull().default(1),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.site_id, t.name] }),
  })
);

export const termRelationships = sqliteTable(
  "term_relationships",
  {
    term_id: text("term_id").notNull(),
    post_id: text("post_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.term_id, t.post_id] }),
  })
);

export const terms = sqliteTable("terms", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  taxonomy: text("taxonomy").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  parent_id: text("parent_id"),
  count: integer("count").notNull().default(0),
  locale: text("locale").notNull(),
  lang_group: text("lang_group").notNull().default(""),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  declared_by_theme: text("declared_by_theme"),
});

export const themeBlocks = sqliteTable("theme_blocks", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  template: text("template").notNull(),
  declared_by_theme: text("declared_by_theme").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const themeFiles = sqliteTable("theme_files", {
  id: text("id").primaryKey(),
  theme_name: text("theme_name").notNull(),
  theme_version: text("theme_version").notNull(),
  file_path: text("file_path").notNull(),
  content_type: text("content_type").notNull(),
  content: text("content").notNull(),
  is_binary: integer("is_binary").notNull().default(0),
  size_bytes: integer("size_bytes").notNull().default(0),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const themeInstalls = sqliteTable("theme_installs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull(),
  active: integer("active").notNull().default(0),
  manifest: text("manifest").notNull(),
  installed_at: integer("installed_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const themeRoutes = sqliteTable("theme_routes", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  path: text("path").notNull(),
  template: text("template").notNull(),
  query_json: text("query_json"),
  resolve_json: text("resolve_json"),
  sort_order: integer("sort_order").notNull().default(0),
  declared_by_theme: text("declared_by_theme").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
  title: text("title"),
});

export const themeSettingDefs = sqliteTable(
  "theme_setting_defs",
  {
    theme_name: text("theme_name").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    default_value: text("default_value"),
    options: text("options"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.theme_name, t.key] }),
  })
);

export const themeSettings = sqliteTable(
  "theme_settings",
  {
    theme_name: text("theme_name").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.theme_name, t.key] }),
  })
);

export const themeTableDefs = sqliteTable("theme_table_defs", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull(),
  owner_type: text("owner_type").notNull().default("theme"),
  owner_name: text("owner_name").notNull(),
  logical_name: text("logical_name").notNull(),
  table_name: text("table_name").notNull(),
  i18n_table: text("i18n_table"),
  translatable: text("translatable").notNull().default("[]"),
  fields_json: text("fields_json").notNull().default("[]"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const widgetInstances = sqliteTable("widget_instances", {
  id: text("id").primaryKey(),
  site_id: text("site_id").notNull().default("default"),
  sidebar: text("sidebar").notNull(),
  widget_type: text("widget_type").notNull(),
  title: text("title").notNull().default(""),
  config: text("config").notNull().default("{}"),
  sort_order: integer("sort_order").notNull().default(0),
  enabled: integer("enabled").notNull().default(1),
  locale: text("locale").notNull().default(""),
});

/**
 * Canonical map of SQL table name -> Drizzle table definition for all 52
 * platform tables in `PLATFORM_SCHEMA`.
 */
export const PLATFORM_DRIZZLE_TABLES = {
  admin_activity: adminActivity,
  admin_menu_registry: adminMenuRegistry,
  admin_sessions: adminSessions,
  api_keys: apiKeys,
  comments,
  content_cache_versions: contentCacheVersions,
  custom_widget_types: customWidgetTypes,
  extension_capabilities: extensionCapabilities,
  extension_versions: extensionVersions,
  field_defs: fieldDefs,
  i18n_overrides: i18nOverrides,
  locales,
  login_attempts: loginAttempts,
  media_files: mediaFiles,
  member_sessions: memberSessions,
  members,
  menu_items: menuItems,
  menus,
  notification_log: notificationLog,
  platform_settings: platformSettings,
  plugin_installs: pluginInstalls,
  plugin_setting_defs: pluginSettingDefs,
  plugin_settings: pluginSettings,
  post_autosaves: postAutosaves,
  post_meta: postMeta,
  post_revisions: postRevisions,
  post_translations: postTranslations,
  post_types: postTypes,
  posts,
  redirects,
  rewrites,
  role_permissions: rolePermissions,
  scheduled_posts: scheduledPosts,
  seo_meta: seoMeta,
  settings,
  shortcodes,
  site_locales: siteLocales,
  site_snapshots: siteSnapshots,
  site_users: siteUsers,
  site_users_sites: siteUsersSites,
  sites,
  taxonomies,
  term_relationships: termRelationships,
  terms,
  theme_blocks: themeBlocks,
  theme_files: themeFiles,
  theme_installs: themeInstalls,
  theme_routes: themeRoutes,
  theme_setting_defs: themeSettingDefs,
  theme_settings: themeSettings,
  theme_table_defs: themeTableDefs,
  widget_instances: widgetInstances,
} as const;
