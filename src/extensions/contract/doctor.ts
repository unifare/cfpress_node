/**
 * Extension inspection and pre-flight doctor engine.
 *
 * Provides structured diagnostic reports (Errors, Warnings, Infos) for themes and
 * plugins, validating both the manifest contract (declarations, namespaces, schema,
 * translatable prose) and physical package file existence (templates, parts, custom
 * views, language coverage, and 404/screenshot presence).
 */

import {
  ALLOWED_ADMIN_SCREENS,
  ALLOWED_FIELD_TYPES,
  ALLOWED_TABLE_FIELD_TYPES,
  IDENT_RE,
  LOCALE_CODE_RE,
  RESERVED_COLUMNS,
  TABLE_ADMIN_SCREENS,
  TABLE_NAME_RE,
  isProseFieldType,
  validExtensionName,
  validTemplateName,
  validVersion,
} from "./manifest";
import { BUNDLED_THEMES } from "../../shared/bundled";

export type DiagnosticLevel = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: string;
  level: DiagnosticLevel;
  message: string;
  file?: string;
  path?: string;
  suggestion?: string;
}

export interface InspectionReport {
  valid: boolean;
  score: number;
  extensionType: "theme" | "plugin";
  name: string;
  title: string;
  version: string;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  diagnostics: DiagnosticItem[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeFilesMap(
  files?: Record<string, Uint8Array | string> | Map<string, Uint8Array | string>
): { fileSet: Set<string>; readText: (path: string) => string | null } {
  if (!files) {
    return {
      fileSet: new Set<string>(),
      readText: () => null,
    };
  }
  const fileSet = new Set<string>();
  const textCache = new Map<string, string>();
  const entries: [string, Uint8Array | string][] =
    files instanceof Map ? Array.from(files.entries()) : Object.entries(files);

  for (const [p, v] of entries) {
    const norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
    fileSet.add(norm);
    if (typeof v === "string") {
      textCache.set(norm, v);
    }
  }

  const readText = (path: string): string | null => {
    const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (textCache.has(norm)) return textCache.get(norm)!;
    const raw =
      files instanceof Map
        ? (files.get(norm) ?? files.get(path))
        : (files[norm] ?? files[path]);
    if (!raw) return null;
    if (typeof raw === "string") {
      textCache.set(norm, raw);
      return raw;
    }
    try {
      const decoded = new TextDecoder().decode(raw);
      textCache.set(norm, decoded);
      return decoded;
    } catch {
      return null;
    }
  };

  return { fileSet, readText };
}

export interface InspectOptions {
  /** If true, checks upload-specific constraints such as prohibiting clashing with bundled theme names. Default false. */
  isUpload?: boolean;
  /** Whether the target extension is a confirmed bundled system extension. */
  isBundled?: boolean;
}

/**
 * Inspect an extension manifest and optional package files.
 * Returns a comprehensive, non-throwing InspectionReport.
 */
export function inspectExtension(
  manifestRaw: unknown,
  extensionType: "theme" | "plugin",
  filesMap?: Record<string, Uint8Array | string> | Map<string, Uint8Array | string>,
  options?: InspectOptions
): InspectionReport {
  const diagnostics: DiagnosticItem[] = [];

  const add = (
    level: DiagnosticLevel,
    code: string,
    message: string,
    opts?: { file?: string; path?: string; suggestion?: string }
  ) => {
    diagnostics.push({
      code,
      level,
      message,
      file: opts?.file,
      path: opts?.path,
      suggestion: opts?.suggestion,
    });
  };

  if (!manifestRaw || typeof manifestRaw !== "object" || Array.isArray(manifestRaw)) {
    add("error", "CHK_MANIFEST_OBJECT", "Manifest must be a JSON object", {
      file: extensionType === "theme" ? "theme.json" : "plugin.json",
      suggestion: "Provide a valid JSON object in theme.json or plugin.json",
    });
    return {
      valid: false,
      score: 0,
      extensionType,
      name: "",
      title: "",
      version: "",
      summary: { errors: 1, warnings: 0, infos: 0 },
      diagnostics,
    };
  }

  const m = manifestRaw as Record<string, any>;
  const name = String(m.name || "").trim();
  const title = String(m.title || "").trim();
  const version = String(m.version || "").trim();

  // 1. Basic Identifiers & Reserved Names
  if (!name) {
    add("error", "CHK_NAME_REQUIRED", "Manifest missing required field: name", {
      path: "name",
      suggestion: "Add an identifier for the extension, e.g. \"my-theme\"",
    });
  } else if (!validExtensionName(name)) {
    add("error", "CHK_NAME_FORMAT", `Invalid extension name "${name}". Must be 2-64 characters matching /^[a-z0-9][a-z0-9-_]{1,63}$/`, {
      path: "name",
      suggestion: "Use lowercase letters, numbers, hyphens or underscores",
    });
  } else if (extensionType === "theme" && (BUNDLED_THEMES as readonly string[]).includes(name)) {
    if (options?.isUpload) {
      add("error", "CHK_NAME_BUNDLED_CONFLICT", `Theme name "${name}" conflicts with a bundled system theme (ships with the product; upload your variant under a different name)`, {
        path: "name",
        suggestion: "Choose a custom identifier like \"my-custom-theme\"",
      });
    } else {
      add("info", "INF_BUNDLED_THEME", `Theme "${name}" is an official bundled theme shipped with CFPress core`, {
        path: "name",
      });
    }
  }

  if (!title) {
    add("warning", "CHK_TITLE_MISSING", "Manifest missing \"title\", falling back to identifier", {
      path: "title",
      suggestion: "Provide a human-readable title for admin display",
    });
  }

  if (!version) {
    add("warning", "CHK_VERSION_MISSING", "Manifest missing \"version\", defaulting to 1.0.0", {
      path: "version",
      suggestion: "Specify a semantic version such as \"1.0.0\"",
    });
  } else if (!validVersion(version)) {
    add("error", "CHK_VERSION_FORMAT", `Invalid version "${version}". Expected semver (e.g. 1.0.0)`, {
      path: "version",
      suggestion: "Use SemVer format (e.g., 1.0.0 or 1.0.0-beta.1)",
    });
  }

  // 2. Physical File Tree & Package Checks
  const { fileSet, readText } = normalizeFilesMap(filesMap);
  const hasFiles = fileSet.size > 0;

  if (hasFiles) {
    const manifestFileName = extensionType === "theme" ? "theme.json" : "plugin.json";
    if (!fileSet.has(manifestFileName)) {
      add("error", "CHK_MISSING_MANIFEST_FILE", `Package zip must contain "${manifestFileName}" in root`, {
        file: manifestFileName,
      });
    }

    // Check directory traversal
    for (const f of fileSet) {
      if (f.startsWith("/") || f.includes("..") || f.includes("\\") || f.includes("\0")) {
        add("error", "CHK_PATH_TRAVERSAL", `Illegal file path detected in package: "${f}"`, {
          file: f,
          suggestion: "Remove directory traversal characters and backslashes",
        });
      }
    }
  }

  // 3. Theme-specific checks
  if (extensionType === "theme") {
    // 3.1 templates & parts physical existence
    if (hasFiles) {
      if (!fileSet.has("templates/index.html") && !fileSet.has("templates/home.html") && !fileSet.has("index.html")) {
        add("error", "CHK_MISSING_ENTRY_TEMPLATE", "Theme package must contain at least templates/index.html as fallback", {
          file: "templates/index.html",
          suggestion: "Create templates/index.html as the primary fallback template",
        });
      }

      if (!fileSet.has("templates/404.html") && !fileSet.has("404.html")) {
        add("warning", "CHK_MISSING_404", "Theme does not provide a dedicated templates/404.html", {
          file: "templates/404.html",
          suggestion: "Add a 404 template to offer branded not-found pages",
        });
      }

      if (!fileSet.has("screenshot.png") && !fileSet.has("screenshot.jpg") && !fileSet.has("assets/screenshot.png")) {
        add("info", "CHK_MISSING_SCREENSHOT", "Theme has no screenshot.png for visual preview in the admin themes panel", {
          file: "screenshot.png",
          suggestion: "Include a 1200x900 screenshot.png at package root",
        });
      }
    }

    // Declared templates vs files
    if (Array.isArray(m.templates)) {
      for (const t of m.templates) {
        if (!validTemplateName(t)) {
          add("error", "CHK_INVALID_TEMPLATE_DECL", `Invalid template declaration "${t}"`, {
            path: "templates",
          });
        } else if (hasFiles) {
          const expected = `templates/${t}.html`;
          if (!fileSet.has(expected) && !fileSet.has(`${t}.html`)) {
            add("warning", "CHK_TEMPLATE_FILE_MISSING", `Declared template "${t}" not found in templates/${t}.html`, {
              path: "templates",
              file: expected,
              suggestion: `Create file "${expected}" or remove "${t}" from templates[] in theme.json`,
            });
          }
        }
      }
    }

    // Declared parts vs files
    if (Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (!validTemplateName(p)) {
          add("error", "CHK_INVALID_PART_DECL", `Invalid part declaration "${p}"`, {
            path: "parts",
          });
        } else if (hasFiles) {
          const expected1 = `templates/parts/${p}.html`;
          const expected2 = `parts/${p}.html`;
          if (!fileSet.has(expected1) && !fileSet.has(expected2)) {
            add("warning", "CHK_PART_FILE_MISSING", `Declared part "${p}" not found at "${expected1}"`, {
              path: "parts",
              file: expected1,
              suggestion: `Create file "${expected1}" or remove "${p}" from parts[]`,
            });
          }
        }
      }
    }
  }

  // 4. AdminMenus Checks (Rule 11 & Custom View existence)
  const declaredTables = new Set<string>();
  if (Array.isArray(m.tables)) {
    for (const t of m.tables) {
      if (t && typeof t === "object" && t.name) declaredTables.add(String(t.name));
    }
  }

  if (Array.isArray(m.adminMenus)) {
    const keyRe = new RegExp(`^${extensionType}\\.${escapeRegExp(name)}\\.[^\\s]+$`);
    const seenMenuIds = new Set<string>();

    for (const menu of m.adminMenus) {
      if (!menu || typeof menu !== "object") continue;
      const mid = String(menu.id || "");
      if (!mid || !IDENT_RE.test(mid)) {
        add("error", "CHK_MENU_ID_INVALID", `Invalid admin menu id: "${mid}"`, {
          path: `adminMenus[${mid}]`,
        });
        continue;
      }
      if (seenMenuIds.has(mid)) {
        add("error", "CHK_MENU_ID_DUPLICATE", `Duplicate admin menu id: "${mid}"`, {
          path: `adminMenus[${mid}]`,
        });
      }
      seenMenuIds.add(mid);

      // Rule 11 check
      if (menu.label_key) {
        if (typeof menu.label_key !== "string" || !keyRe.test(menu.label_key)) {
          add(
            "error",
            "CHK_MENU_LABEL_KEY_NAMESPACE",
            `adminMenu "${mid}": label_key "${menu.label_key}" must match "${extensionType}.${name}.<key>" (Rule 11)`,
            {
              path: `adminMenus[${mid}].label_key`,
              suggestion: `Change label_key to "${extensionType}.${name}.${menu.label_key.split(".").pop() || mid}"`,
            }
          );
        }
      }

      const screen = String(menu.screen || "");
      if (screen === "custom") {
        const view = String(menu.args?.view || "");
        if (!view) {
          add("error", "CHK_MENU_CUSTOM_NO_VIEW", `adminMenu "${mid}": custom screen requires args.view`, {
            path: `adminMenus[${mid}].args.view`,
          });
        } else if (hasFiles && !fileSet.has(view.replace(/^\/+/, ""))) {
          add("error", "CHK_MENU_CUSTOM_VIEW_NOT_FOUND", `adminMenu "${mid}": args.view "${view}" does not exist in package`, {
            path: `adminMenus[${mid}].args.view`,
            file: view,
            suggestion: `Add template file "${view}" to package`,
          });
        }
      } else if ((TABLE_ADMIN_SCREENS as readonly string[]).includes(screen)) {
        const tbl = String(menu.args?.table || "");
        if (!tbl) {
          add("error", "CHK_MENU_TABLE_MISSING", `adminMenu "${mid}": screen "${screen}" requires args.table`, {
            path: `adminMenus[${mid}].args.table`,
          });
        } else if (!declaredTables.has(tbl)) {
          add("error", "CHK_MENU_TABLE_UNDECLARED", `adminMenu "${mid}": references table "${tbl}" not in tables[]`, {
            path: `adminMenus[${mid}].args.table`,
            suggestion: `Declare "${tbl}" in manifest tables[] or correct table name`,
          });
        }
      } else if (!(ALLOWED_ADMIN_SCREENS as readonly string[]).includes(screen)) {
        add("warning", "CHK_MENU_UNSUPPORTED_SCREEN", `adminMenu "${mid}": unrecognized screen "${screen}"`, {
          path: `adminMenus[${mid}].screen`,
        });
      }
    }
  }

  // 5. Tables & translatable checks (Rule 41)
  if (Array.isArray(m.tables)) {
    for (const t of m.tables) {
      if (!t || typeof t !== "object") continue;
      const tname = String(t.name || "");
      if (!TABLE_NAME_RE.test(tname)) {
        add("error", "CHK_TABLE_NAME_INVALID", `Invalid table name "${tname}"`, {
          path: `tables[${tname}]`,
        });
        continue;
      }
      const translatableList = Array.isArray(t.translatable)
        ? t.translatable
        : (Array.isArray(t.language?.translatable) ? t.language.translatable : []);
      const translatableSet = new Set(translatableList.map(String));
      if (Array.isArray(t.fields)) {
        for (const f of t.fields) {
          const fkey = String(f?.key || f?.name || "");
          const ftype = String(f?.type || "text");
          if ((RESERVED_COLUMNS as readonly string[]).includes(fkey as any)) {
            add("error", "CHK_TABLE_RESERVED_COLUMN", `table "${tname}": field "${fkey}" collides with platform column`, {
              path: `tables[${tname}].fields[${fkey}]`,
            });
          }
          if (!(ALLOWED_TABLE_FIELD_TYPES as readonly string[]).includes(ftype as any)) {
            add("error", "CHK_TABLE_FIELD_TYPE", `table "${tname}": unsupported field type "${ftype}"`, {
              path: `tables[${tname}].fields[${fkey}].type`,
            });
          }
          if (isProseFieldType(ftype) && !translatableSet.has(fkey)) {
            add(
              "error",
              "CHK_TABLE_PROSE_NOT_TRANSLATABLE",
              `table "${tname}": field "${fkey}" is type "${ftype}" (prose) and must be listed in translatable (Rule 41)`,
              {
                path: `tables[${tname}].translatable`,
                suggestion: `Add "${fkey}" to tables[].translatable`,
              }
            );
          }
          if (!isProseFieldType(ftype) && translatableSet.has(fkey)) {
            add(
              "error",
              "CHK_TABLE_NEUTRAL_TRANSLATABLE",
              `table "${tname}": field "${fkey}" is language-neutral (${ftype}) and must NOT be in translatable`,
              {
                path: `tables[${tname}].translatable`,
                suggestion: `Remove "${fkey}" from tables[].translatable`,
              }
            );
          }
        }
      }
    }
  }

  // 6. Language coverage & dictionaries
  if (Array.isArray(m.locales)) {
    for (const loc of m.locales) {
      if (!LOCALE_CODE_RE.test(String(loc))) {
        add("error", "CHK_LOCALE_FORMAT", `Invalid locale code "${loc}"`, {
          path: `locales[${loc}]`,
        });
      } else if (hasFiles) {
        const langPath = `langs/${loc}.json`;
        if (!fileSet.has(langPath)) {
          add("warning", "CHK_LOCALE_FILE_MISSING", `Declared locale "${loc}" has no dictionary at "${langPath}"`, {
            file: langPath,
            suggestion: `Add ${langPath} containing strings for locale "${loc}"`,
          });
        }
      }
    }
  }

  // Check dictionary keys for adminMenus
  if (hasFiles && Array.isArray(m.adminMenus)) {
    for (const f of fileSet) {
      if (f.startsWith("langs/") && f.endsWith(".json")) {
        const content = readText(f);
        if (content) {
          try {
            const pack = JSON.parse(content);
            for (const menu of m.adminMenus) {
              if (menu?.label_key && typeof menu.label_key === "string") {
                if (!pack[menu.label_key]) {
                  add(
                    "warning",
                    "CHK_MENU_TRANSLATION_MISSING",
                    `Dictionary "${f}" missing translation for menu key "${menu.label_key}"`,
                    {
                      file: f,
                      path: menu.label_key,
                      suggestion: `Add "${menu.label_key}": "${menu.label || menu.id}" to ${f}`,
                    }
                  );
                }
              }
            }
          } catch {
            add("error", "CHK_INVALID_LANG_JSON", `Language file "${f}" contains invalid JSON syntax`, {
              file: f,
            });
          }
        }
      }
    }
  }

  // 7. Light Template Syntax Pre-flight
  if (hasFiles) {
    for (const f of fileSet) {
      if (f.startsWith("templates/") && f.endsWith(".html")) {
        const tpl = readText(f);
        if (tpl) {
          // Check unclosed double braces
          const opens = (tpl.match(/\{\{/g) || []).length;
          const closes = (tpl.match(/\}\}/g) || []).length;
          if (opens !== closes) {
            add(
              "warning",
              "CHK_TPL_UNCLOSED_BRACES",
              `Template "${f}" has unbalanced double braces: ${opens} '{{' vs ${closes} '}}'`,
              {
                file: f,
                suggestion: "Check for unclosed {{ tags in template",
              }
            );
          }
        }
      }
    }
  }

  // Summary and Health Score calculation
  const errorCount = diagnostics.filter((d) => d.level === "error").length;
  const warnCount = diagnostics.filter((d) => d.level === "warning").length;
  const infoCount = diagnostics.filter((d) => d.level === "info").length;

  let score = 100 - errorCount * 25 - warnCount * 5 - infoCount * 1;
  if (score < 0) score = 0;
  if (errorCount > 0 && score > 60) score = 50; // Cap score if critical errors exist

  return {
    valid: errorCount === 0,
    score,
    extensionType,
    name,
    title: title || name,
    version: version || "1.0.0",
    summary: {
      errors: errorCount,
      warnings: warnCount,
      infos: infoCount,
    },
    diagnostics,
  };
}
