/**
 * Hook Inspector & Testing API Routes (src/api/hooks.ts)
 */

import { Env, SessionUser } from "../shared/types";
import { jsonBody, ok } from "../shared/repo";
import {
  getAllHooksCatalog,
  getHookLogs,
  clearHookLogs,
  getCallLogs,
  clearCallLogs,
  triggerHookManually,
} from "../platform/hooks";

export async function dispatchHooksAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "hooks/list" && method === "GET") {
    return ok(getAllHooksCatalog());
  }

  if (path === "hooks/logs" && method === "GET") {
    const filter = url.searchParams.get("filter") || undefined;
    return ok({ logs: getHookLogs(filter) });
  }

  if (path === "hooks/clear-logs" && method === "POST") {
    clearHookLogs();
    return ok({ success: true, message: "Hook 日志已清空" });
  }

  if (path === "hooks/calls" && method === "GET") {
    return ok({ calls: getCallLogs() });
  }

  if (path === "hooks/clear-calls" && method === "POST") {
    clearCallLogs();
    return ok({ success: true, message: "调用记录已清空" });
  }

  if (path === "hooks/trigger" && method === "POST") {
    const body = await jsonBody(request);
    const name = body?.name || body?.hookName;
    const type = body?.type || body?.hookType || "action";
    const data = body?.data ?? { triggeredBy: user.username, timestamp: new Date().toISOString() };

    if (!name) return ok({ error: "Hook 名称不能为空" }, 400);

    const res = await triggerHookManually(name, type, data, { env, siteId, user, request });
    return ok(res);
  }

  return null;
}
