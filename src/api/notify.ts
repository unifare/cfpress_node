/**
 * Notification System & Channels API Routes (src/api/notify.ts)
 */

import { Env, SessionUser } from "../shared/types";
import { jsonBody, ok } from "../shared/repo";
import { NotificationService } from "../platform/notification";
import { EmailService } from "../platform/email";

export async function dispatchNotifyAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // --- Channels ---
  if (path === "notify/channels" && method === "GET") {
    const channels = await NotificationService.getChannels(env, siteId);
    return ok({ channels });
  }

  if (path === "notify/channels" && method === "POST") {
    const body = await jsonBody(request);
    if (!body?.channel) return ok({ error: "渠道代码不能为空" }, 400);
    await NotificationService.saveChannel(env, siteId, body.channel, Boolean(body.enabled), body.config || {});
    return ok({ success: true, message: `渠道「${body.channel}」配置已保存` });
  }

  if (path === "notify/channels/test" && method === "POST") {
    const body = await jsonBody(request);
    if (!body?.channel) return ok({ error: "渠道代码不能为空" }, 400);
    try {
      const res = await NotificationService.testChannel(env, siteId, body.channel, body.to);
      return ok(res);
    } catch (err: any) {
      return ok({ error: err?.message || "测试失败" }, 400);
    }
  }

  // --- Rules ---
  if (path === "notify/rules" && method === "GET") {
    const rules = await NotificationService.getRules(env, siteId);
    return ok({ rules });
  }

  if (path === "notify/rules" && method === "POST") {
    const body = await jsonBody(request);
    const ruleId = await NotificationService.saveRule(env, siteId, body.rule || {}, body.actions || []);
    return ok({ success: true, ruleId, message: "通知规则已保存" });
  }

  if (path.startsWith("notify/rules/") && method === "DELETE") {
    const ruleId = path.slice("notify/rules/".length);
    await NotificationService.deleteRule(env, siteId, ruleId);
    return ok({ success: true, message: "规则已删除" });
  }

  if (path === "notify/rules/seed" && method === "POST") {
    await NotificationService.seedDefaultRules(env, siteId);
    return ok({ success: true, message: "内置通知规则已恢复" });
  }

  // --- In-App Notifications ---
  if (path === "notify/inbox" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const data = await NotificationService.getInAppNotifications(env, siteId, { status, limit, offset });
    return ok(data);
  }

  if (path === "notify/inbox/read" && method === "POST") {
    const body = await jsonBody(request);
    await NotificationService.markInAppRead(env, siteId, body?.ids);
    return ok({ success: true, message: "已标记为已读" });
  }

  if (path.startsWith("notify/inbox/") && method === "DELETE") {
    const id = path.slice("notify/inbox/".length);
    await NotificationService.deleteInAppNotification(env, siteId, id);
    return ok({ success: true, message: "通知已删除" });
  }

  // --- Delivery Logs & Queue ---
  if (path === "notify/logs" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const logs = await NotificationService.getDeliveryLogs(env, siteId, { status, limit, offset });
    return ok({ logs });
  }

  if (path === "notify/queue/drain" && method === "POST") {
    const res = await NotificationService.drainQueue(env, siteId, 20);
    return ok(res);
  }

  // --- Direct Email Service Test ---
  if (path === "email/test" && method === "POST") {
    const body = await jsonBody(request);
    if (!body?.to) return ok({ error: "请输入接收测试邮件的目标邮箱" }, 400);
    try {
      const res = await EmailService.testConnection(env, siteId, body.to, body.config);
      return ok(res);
    } catch (err: any) {
      return ok({ error: err?.message || "邮件发送失败" }, 400);
    }
  }

  return null;
}
