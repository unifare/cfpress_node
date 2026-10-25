// Multi-dialect SQL placeholder normalization and async database driver adapters
// for SQLite, PostgreSQL, and MySQL.

import type { SqlDialect } from "./dynamic-ddl";

export interface AsyncSqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number;
  lastInsertId?: number;
}

export interface AsyncSqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<AsyncSqlQueryResult<T>>;
}

// Converts positional `?` placeholders to `$1, $2, ...` for PostgreSQL while
// ignoring `?` inside string literals, quoted identifiers, and SQL comments.
export function normalizeSqlPlaceholders(
  sql: string,
  dialect: SqlDialect = "sqlite"
): string {
  if (dialect !== "postgres") return sql;
  let out = "";
  let i = 0;
  let paramIndex = 0;
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += c;
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c === "*" && next === "/") {
        out += "*" + "/";
        inBlockComment = false;
        i += 2;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (quote) {
      out += c;
      if (c === quote) {
        if (next === quote) {
          out += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }

    if (c === "-" && next === "-") {
      out += "--";
      inLineComment = true;
      i += 2;
      continue;
    }

    if (c === "/" && next === "*") {
      out += "/" + "*";
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      i++;
      continue;
    }

    if (c === "?") {
      paramIndex++;
      out += `$${paramIndex}`;
      i++;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

// Wraps a PostgreSQL (`pg.Pool` / `pg.Client`) connection into an AsyncSqlExecutor.
export function createPostgresExecutor(pgClient: {
  query(text: string, values?: unknown[]): Promise<{ rows?: any[]; rowCount?: number | null }>;
}): AsyncSqlExecutor {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await pgClient.query(sql, params);
      return {
        rows: (res.rows ?? []) as T[],
        rowCount: Number(res.rowCount ?? 0),
        lastInsertId: 0,
      };
    },
  };
}

// Wraps a MySQL (`mysql2/promise`) pool/connection into an AsyncSqlExecutor.
export function createMysqlExecutor(mysqlClient: {
  execute(sql: string, values?: unknown[]): Promise<[any, any]>;
}): AsyncSqlExecutor {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const [rowsOrHeader] = await mysqlClient.execute(sql, params);
      if (Array.isArray(rowsOrHeader)) {
        return {
          rows: rowsOrHeader as T[],
          rowCount: rowsOrHeader.length,
          lastInsertId: 0,
        };
      }
      return {
        rows: [] as T[],
        rowCount: Number(rowsOrHeader?.affectedRows ?? 0),
        lastInsertId: Number(rowsOrHeader?.insertId ?? 0),
      };
    },
  };
}

// Wraps any AsyncSqlExecutor (PostgreSQL / MySQL) into the unified D1Database
// interface so both Drizzle ORM (`getDb(env)`) and prepared statements run seamlessly.
export function createAsyncDatabaseAdapter(
  executor: AsyncSqlExecutor,
  dialect: SqlDialect
): D1Database {
  function prepare(rawSql: string): D1PreparedStatement {
    const normalizedSql = normalizeSqlPlaceholders(rawSql, dialect);
    let boundParams: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        boundParams =
          values.length === 1 && Array.isArray(values[0])
            ? [...values[0]]
            : [...values];
        return stmt;
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const res = await executor.query<Record<string, unknown>>(
          normalizedSql,
          boundParams
        );
        const row = res.rows[0];
        if (!row) return null;
        if (colName !== undefined) {
          return (row[colName] !== undefined ? row[colName] : null) as T;
        }
        return row as unknown as T;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const res = await executor.query<T>(normalizedSql, boundParams);
        return {
          results: res.rows,
          success: true,
          meta: {
            changes: res.rowCount ?? 0,
            last_row_id: res.lastInsertId ?? 0,
          },
        };
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const res = await executor.query<T>(normalizedSql, boundParams);
        return {
          results: res.rows,
          success: true,
          meta: {
            changes: res.rowCount ?? 0,
            last_row_id: res.lastInsertId ?? 0,
          },
        };
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const res = await executor.query<Record<string, unknown>>(
          normalizedSql,
          boundParams
        );
        return res.rows.map((r) => Object.values(r)) as unknown as T[];
      },
    };
    return stmt;
  }

  return {
    prepare,
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      await executor.query("BEGIN");
      try {
        const results: D1Result<T>[] = [];
        for (const st of statements) {
          results.push(await st.run<T>());
        }
        await executor.query("COMMIT");
        return results;
      } catch (err) {
        try {
          await executor.query("ROLLBACK");
        } catch {}
        throw err;
      }
    },
    async exec(sql: string) {
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of statements) {
        await executor.query(normalizeSqlPlaceholders(s, dialect));
      }
      return { count: statements.length, duration: 0 };
    },
  };
}
