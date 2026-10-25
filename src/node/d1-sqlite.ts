import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal D1Database compatibility layer over SQLite.
 * Compatible with Node.js 22.5+ built-in `node:sqlite` (DatabaseSync)
 * or `better-sqlite3`.
 */

export interface SQLiteDriver {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): { changes: number; lastInsertRowid?: number | bigint };
  };
  exec(sql: string): void;
  close?(): void;
}

export interface D1PreparedStatement {
  bind(...args: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }>;
  run<T = any>(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }>;
  _sql: string;
  _params: any[];
}

export interface NodeD1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = any>(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(sql: string): Promise<{ success: boolean }>;
  close(): void;
}

export function createD1(sqlite: SQLiteDriver): NodeD1Database {
  function prepare(sql: string): D1PreparedStatement {
    const st = { _sql: sql, _params: [] as any[] };
    const api: D1PreparedStatement = {
      _sql: sql,
      _params: st._params,
      bind(...args: any[]) {
        // Flatten if first arg is an array
        st._params = (args.length === 1 && Array.isArray(args[0])) ? [...args[0]] : [...args];
        api._params = st._params;
        return api;
      },
      async first<T = any>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(st._sql);
        const row = stmt.get(...st._params);
        if (!row) return null;
        if (colName !== undefined) {
          return (row[colName] !== undefined ? row[colName] : null) as T;
        }
        return row as T;
      },
      async all<T = any>() {
        const stmt = sqlite.prepare(st._sql);
        const rows = stmt.all(...st._params);
        return {
          results: rows as T[],
          success: true,
          meta: {},
        };
      },
      async run<T = any>() {
        const stmt = sqlite.prepare(st._sql);
        const res = stmt.run(...st._params);
        return {
          success: true,
          meta: {
            changes: Number(res.changes || 0),
            last_row_id: Number(res.lastInsertRowid || 0),
          },
        };
      },
    };
    return api;
  }

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const st of statements) {
          results.push(await st.run());
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        try { sqlite.exec("ROLLBACK"); } catch {}
        throw err;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { success: true };
    },
    close() {
      if (typeof sqlite.close === "function") {
        sqlite.close();
      }
    },
  };
}

/**
 * Apply pending SQL migrations from content/migrations directory.
 */
export async function applyMigrations(d1: NodeD1Database, migrationsDir: string) {
  // Ensure migration tracking table exists
  await d1.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRows = await d1.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
  const appliedSet = new Set(appliedRows.results.map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`[D1 Migration] Applying ${file}...`);
    // Split and execute statements or exec entire migration script
    await d1.exec(sql);
    await d1.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(file).run();
    appliedSet.add(file);
    console.log(`[D1 Migration] Applied ${file}`);
  }
}

/**
 * Initialize a SQLite database instance.
 * Automatically selects Node 22 built-in `node:sqlite` or fallback to `better-sqlite3`.
 */
export function openSQLite(filePath: string): SQLiteDriver {
  // 1. Try node:sqlite (Node 22.5+)
  try {
    const { DatabaseSync } = (process as any).getBuiltinModule ? (process as any).getBuiltinModule("node:sqlite") : require("node:sqlite");
    if (DatabaseSync) {
      return new DatabaseSync(filePath);
    }
  } catch {}

  // 2. Try better-sqlite3
  try {
    const Database = require("better-sqlite3");
    return new Database(filePath);
  } catch (err) {
    throw new Error(
      `Unable to initialize SQLite database. Neither built-in 'node:sqlite' nor 'better-sqlite3' is available.\n` +
      `Node.js version is ${process.version}. Please use Node.js >= 22.5.0 or install 'better-sqlite3'.`
    );
  }
}
