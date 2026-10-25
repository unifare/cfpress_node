import { Env } from "./types";
import { randomId } from "./crypto";
import { getDb, adminActivity } from "./db";

export { getDb };

let _currentIp: string | null = null;

export function setCurrentIp(ip: string | null) {
  _currentIp = ip;
}

export function runWithIp<T>(ip: string, fn: () => T): T {
  const prev = _currentIp;
  _currentIp = ip;
  try {
    return fn();
  } finally {
    _currentIp = prev;
  }
}

export function currentIp(): string | null {
  return _currentIp;
}

export function getClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "127.0.0.1";
}

export async function jsonBody(request: Request): Promise<any> {
  try { return await request.json(); } catch { return {}; }
}

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function now() { return Math.floor(Date.now() / 1000); }

export async function activity(
  env: Env,
  userId: string | null,
  action: string,
  type?: string,
  id?: string,
  meta?: unknown,
  ip?: string
) {
  const resolvedIp = ip ?? currentIp() ?? (meta && typeof meta === "object" && "ip" in meta ? String((meta as any).ip) : null);
  try {
    await getDb(env).insert(adminActivity).values({
      id: await randomId(),
      user_id: userId,
      action,
      entity_type: type ?? null,
      entity_id: id ?? null,
      meta: meta ? JSON.stringify(meta) : null,
      ip: resolvedIp,
      created_at: now(),
    });
  } catch {
    await env.DB.prepare(
      "INSERT INTO admin_activity (id, user_id, action, entity_type, entity_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(await randomId(), userId, action, type ?? null, id ?? null, meta ? JSON.stringify(meta) : null, now()).run();
  }
}
