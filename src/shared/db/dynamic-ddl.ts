/**
 * Multi-dialect dynamic DDL & introspection for extension-owned tables
 * (`theme_{owner}_{table}`, `plugin_{owner}_{table}`, and `{table}_i18n`).
 *
 * Supports `"sqlite"` (default), `"postgres"`, and `"mysql"` dialects so
 * runtime table creation (`syncOwnerTables` / `refreshThemeTableI18n`) is not
 * tied to SQLite-only syntax.
 */

export type SqlDialect = "sqlite" | "postgres" | "mysql";

export interface DynamicFieldSpec {
  key: string;
  type: string;
  label?: string;
  required?: boolean;
}

const FIELD_SQL_BY_DIALECT: Record<SqlDialect, Record<string, string>> = {
  sqlite: {
    text: "TEXT",
    longtext: "TEXT",
    number: "REAL",
    boolean: "INTEGER",
    date: "TEXT",
    datetime: "INTEGER",
  },
  postgres: {
    text: "TEXT",
    longtext: "TEXT",
    number: "DOUBLE PRECISION",
    boolean: "INTEGER",
    date: "TEXT",
    datetime: "BIGINT",
  },
  mysql: {
    text: "VARCHAR(255)",
    longtext: "LONGTEXT",
    number: "DOUBLE",
    boolean: "TINYINT(1)",
    date: "VARCHAR(64)",
    datetime: "BIGINT",
  },
};

export function resolveDialect(env?: { DB_DIALECT?: string }): SqlDialect {
  const raw = String(env?.DB_DIALECT ?? "sqlite").toLowerCase();
  if (raw === "postgres" || raw === "postgresql" || raw === "pg") return "postgres";
  if (raw === "mysql" || raw === "mariadb") return "mysql";
  return "sqlite";
}

export function fieldSqlType(type: string, dialect: SqlDialect = "sqlite"): string {
  const map = FIELD_SQL_BY_DIALECT[dialect] ?? FIELD_SQL_BY_DIALECT.sqlite;
  return map[type] ?? map.text;
}

export function mainTableDdl(
  tableName: string,
  fields: DynamicFieldSpec[],
  dialect: SqlDialect = "sqlite"
): string {
  const idType = dialect === "mysql" ? "VARCHAR(191)" : "TEXT";
  const tsType = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const cols: string[] = [
    `id ${idType} PRIMARY KEY`,
    `site_id ${idType} NOT NULL`,
    `slug ${idType} NOT NULL`,
    `lang_group ${idType} NOT NULL`,
    ...fields.map((f) => `${f.key} ${fieldSqlType(f.type, dialect)}`),
    `status ${idType} NOT NULL DEFAULT 'draft'`,
    `created_at ${tsType} NOT NULL`,
    `updated_at ${tsType} NOT NULL`,
    "UNIQUE(site_id, slug)",
  ];
  return `CREATE TABLE IF NOT EXISTS ${tableName} (${cols.join(", ")})`;
}

export function i18nTableDdl(
  tableName: string,
  translatable: string[],
  dialect: SqlDialect = "sqlite"
): string {
  const keyType = dialect === "mysql" ? "VARCHAR(191)" : "TEXT";
  const proseType = dialect === "mysql" ? "LONGTEXT" : "TEXT";
  const tsType = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const cols: string[] = [
    `row_id ${keyType} NOT NULL`,
    `locale ${keyType} NOT NULL`,
    ...translatable.map((k) => `${k} ${proseType}`),
    `created_at ${tsType} NOT NULL`,
    `updated_at ${tsType} NOT NULL`,
    "PRIMARY KEY (row_id, locale)",
  ];
  return `CREATE TABLE IF NOT EXISTS ${tableName} (${cols.join(", ")})`;
}

export function alterAddColumnDdl(
  tableName: string,
  column: string,
  sqlType: string
): string {
  return `ALTER TABLE ${tableName} ADD COLUMN ${column} ${sqlType}`;
}

export async function existingColumnsForDialect(
  env: { DB: D1Database; DB_DIALECT?: string },
  tableName: string
): Promise<string[]> {
  const dialect = resolveDialect(env);
  try {
    if (dialect === "postgres" || dialect === "mysql") {
      const r = await env.DB.prepare(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?"
      )
        .bind(tableName)
        .all();
      return ((r.results as any[]) ?? []).map((c) => String(c.name ?? c.column_name));
    }
    const r = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
    return ((r.results as any[]) ?? []).map((c) => String(c.name));
  } catch {
    return [];
  }
}

export async function tableExistsForDialect(
  env: { DB: D1Database; DB_DIALECT?: string },
  tableName: string
): Promise<boolean> {
  const dialect = resolveDialect(env);
  try {
    if (dialect === "postgres" || dialect === "mysql") {
      const r = await env.DB.prepare(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_name = ?"
      )
        .bind(tableName)
        .first<any>();
      return !!r;
    }
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    )
      .bind(tableName)
      .first<any>();
    return !!r;
  } catch {
    return false;
  }
}
