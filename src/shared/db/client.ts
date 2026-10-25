/**
 * Drizzle ORM database client factory (`getDb(env)`).
 *
 * Wraps the active database driver (`env.DB`) in a typed Drizzle ORM instance
 * backed by `PLATFORM_DRIZZLE_TABLES` (`src/shared/db/schema.ts`), caching one
 * Drizzle instance per driver via a WeakMap so repeated `getDb(env)` calls
 * within a request are zero-allocation.
 */

import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

export type DrizzleDb = SqliteRemoteDatabase<typeof schema>;

const dbCache = new WeakMap<object, DrizzleDb>();

export function createDrizzleClient(driver: D1Database): DrizzleDb {
  return drizzle(
    async (sql, params, method) => {
      const stmt = params.length > 0 ? driver.prepare(sql).bind(...params) : driver.prepare(sql);
      if (method === "run") {
        await stmt.run();
        return { rows: [] };
      }
      const res = await stmt.all<Record<string, unknown>>();
      const list = Array.isArray(res?.results) ? res.results : [];
      if (method === "get") {
        const first = list[0];
        return { rows: (first ? Object.values(first) : undefined) as any };
      }
      return {
        rows: list.map((row: Record<string, unknown>) => Object.values(row)),
      };
    },
    async (queries) => {
      const out: { rows: any[] }[] = [];
      for (const q of queries) {
        const stmt = q.params.length > 0 ? driver.prepare(q.sql).bind(...q.params) : driver.prepare(q.sql);
        if (q.method === "run") {
          await stmt.run();
          out.push({ rows: [] });
        } else {
          const res = await stmt.all<Record<string, unknown>>();
          const list = Array.isArray(res?.results) ? res.results : [];
          if (q.method === "get") {
            const first = list[0];
            out.push({ rows: (first ? Object.values(first) : undefined) as any });
          } else {
            out.push({ rows: list.map((row: Record<string, unknown>) => Object.values(row)) });
          }
        }
      }
      return out;
    },
    { schema }
  );
}

export function getDb(env: { DB: D1Database; db?: DrizzleDb }): DrizzleDb {
  if (env.db) return env.db;
  const key = env.DB as unknown as object;
  if (key && typeof key === "object") {
    const cached = dbCache.get(key);
    if (cached) return cached;
    const instance = createDrizzleClient(env.DB);
    dbCache.set(key, instance);
    return instance;
  }
  return createDrizzleClient(env.DB);
}
