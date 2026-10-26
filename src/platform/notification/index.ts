/**
 * Built-in Notification Service (src/platform/notification/index.ts)
 *
 * Provides end-to-end event subscription, rule matching, recipient resolution,
 * async DB queuing, exponential backoff retries, and in-app message management.
 */

import { Env } from "../../shared/types";
import { randomId } from "../../shared/crypto";
import { now } from "../../shared/repo";
import { NOTIFICATION_CHANNELS, getChannelMeta, dispatchToChannel, DispatchMessage } from "./channels";
import { addAction } from "../hooks";

export const RETRY_DELAYS_SEC = [0, 10, 60, 300, 1800]; // immediate, 10s, 1m, 5m, 30m
export const MAX_ATTEMPTS = RETRY_DELAYS_SEC.length;

export interface NotifyRule {
  id: string;
  site_id: string;
  name: string;
  event: string;
  priority: number;
  enabled: number;
  remark?: string;
  created_at: number;
  updated_at: number;
  actions?: NotifyAction[];
}

export interface NotifyAction {
  id: string;
  site_id: string;
  rule_id: string;
  channel: string;
  recipient_type: string; // 'admin' | 'user' | 'url' | 'all'
  recipient_target?: string;
  template_title?: string;
  template_body?: string;
  enabled: number;
}

export class NotificationService {
  private static isSubscribed = false;

  /**
   * Boot global listener once: listens to system:hookFired and automatically
   * routes events to the NotificationService rules engine.
   */
  static boot(): void {
    if (this.isSubscribed) return;
    this.isSubscribed = true;

    addAction("system:hookFired", async (ctx, payload) => {
      if (!ctx.env || !ctx.siteId || !payload || !payload.hookName) return;
      try {
        await this.onEvent(ctx.env, ctx.siteId, payload.hookName, payload.data || {}, ctx);
      } catch (err) {
        console.error(`[Notification] Failed handling event "${payload.hookName}":`, err);
      }
    }, 10, "system:notification");
  }

  // ==========================================================================
  // Channels Management
  // ==========================================================================

  static async getChannels(env: Env, siteId: string) {
    const rows = await env.DB.prepare(
      "SELECT channel, enabled, config FROM sys_notify_channels WHERE site_id = ?"
    )
      .bind(siteId)
      .all<{ channel: string; enabled: number; config: string }>();

    const map = new Map<string, { enabled: boolean; config: Record<string, any> }>();
    for (const r of rows.results || []) {
      try {
        map.set(r.channel, {
          enabled: Boolean(r.enabled),
          config: JSON.parse(r.config || "{}"),
        });
      } catch {
        map.set(r.channel, { enabled: Boolean(r.enabled), config: {} });
      }
    }

    return NOTIFICATION_CHANNELS.map((meta) => {
      const saved = map.get(meta.code);
      return {
        ...meta,
        enabled: meta.builtin ? true : Boolean(saved?.enabled),
        config: saved?.config || {},
      };
    });
  }

  static async saveChannel(
    env: Env,
    siteId: string,
    channel: string,
    enabled: boolean,
    config: Record<string, any>
  ): Promise<void> {
    const timestamp = now();
    const configStr = JSON.stringify(config || {});
    await env.DB.prepare(`
      INSERT INTO sys_notify_channels (site_id, channel, enabled, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (site_id, channel) DO UPDATE SET
        enabled = excluded.enabled,
        config = excluded.config,
        updated_at = excluded.updated_at
    `)
      .bind(siteId, channel, enabled ? 1 : 0, configStr, timestamp, timestamp)
      .run();
  }

  static async testChannel(
    env: Env,
    siteId: string,
    channel: string,
    to?: string
  ): Promise<{ success: boolean; msg: string }> {
    const channels = await this.getChannels(env, siteId);
    const target = channels.find((c) => c.code === channel);
    if (!target) throw new Error(`未找到渠道 "${channel}"`);

    const msg: DispatchMessage = {
      siteId,
      recipient: to || target.config?.smtp_user || target.config?.chat_id,
      title: "【CFPress】通知渠道连通性测试",
      content: `这是一条测试通知。渠道「${target.name}」配置正确，已成功与 CFPress 建立连接！\n发送时间: ${new Date().toLocaleString()}`,
      url: `https://cfpress.org`,
      payload: { test: true },
    };

    const res = await dispatchToChannel(env, channel, target.config, msg);
    if (!res.success) {
      throw new Error(`测试失败: ${res.error}`);
    }
    return { success: true, msg: `渠道「${target.name}」测试消息发送成功！` };
  }

  // ==========================================================================
  // Rules & Actions Management
  // ==========================================================================

  static async getRules(env: Env, siteId: string): Promise<NotifyRule[]> {
    const rules = await env.DB.prepare(
      "SELECT * FROM sys_notify_rules WHERE site_id = ? ORDER BY priority ASC, created_at DESC"
    )
      .bind(siteId)
      .all<NotifyRule>();

    const actions = await env.DB.prepare(
      "SELECT * FROM sys_notify_actions WHERE site_id = ? ORDER BY created_at ASC"
    )
      .bind(siteId)
      .all<NotifyAction>();

    const actionMap = new Map<string, NotifyAction[]>();
    for (const a of actions.results || []) {
      const list = actionMap.get(a.rule_id) || [];
      list.push(a);
      actionMap.set(a.rule_id, list);
    }

    return (rules.results || []).map((r) => ({
      ...r,
      actions: actionMap.get(r.id) || [],
    }));
  }

  static async saveRule(
    env: Env,
    siteId: string,
    rule: Partial<NotifyRule>,
    actions: Partial<NotifyAction>[] = []
  ): Promise<string> {
    const ruleId = rule.id || `rule_${randomId()}`;
    const timestamp = now();

    await env.DB.prepare(`
      INSERT INTO sys_notify_rules (id, site_id, name, event, priority, enabled, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        event = excluded.event,
        priority = excluded.priority,
        enabled = excluded.enabled,
        remark = excluded.remark,
        updated_at = excluded.updated_at
    `)
      .bind(
        ruleId,
        siteId,
        rule.name || "未命名规则",
        rule.event || "*",
        rule.priority ?? 10,
        rule.enabled ?? 1,
        rule.remark || "",
        timestamp,
        timestamp
      )
      .run();

    // Replace actions for this rule
    await env.DB.prepare("DELETE FROM sys_notify_actions WHERE site_id = ? AND rule_id = ?")
      .bind(siteId, ruleId)
      .run();

    for (const act of actions) {
      const actionId = act.id || `act_${randomId()}`;
      await env.DB.prepare(`
        INSERT INTO sys_notify_actions (id, site_id, rule_id, channel, recipient_type, recipient_target, template_title, template_body, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          actionId,
          siteId,
          ruleId,
          act.channel || "inapp",
          act.recipient_type || "admin",
          act.recipient_target || "",
          act.template_title || "",
          act.template_body || "",
          act.enabled ?? 1,
          timestamp
        )
        .run();
    }

    return ruleId;
  }

  static async deleteRule(env: Env, siteId: string, ruleId: string): Promise<void> {
    await env.DB.prepare("DELETE FROM sys_notify_actions WHERE site_id = ? AND rule_id = ?")
      .bind(siteId, ruleId)
      .run();
    await env.DB.prepare("DELETE FROM sys_notify_rules WHERE site_id = ? AND id = ?")
      .bind(siteId, ruleId)
      .run();
  }

  static async seedDefaultRules(env: Env, siteId: string): Promise<void> {
    const defaults = [
      {
        name: "新文章发布提醒",
        event: "post:afterCreate",
        remark: "发布新文章后通知站长与管理员",
        actions: [
          {
            channel: "inapp",
            recipient_type: "admin",
            template_title: "新文章发布: {{title}}",
            template_body: "文章已成功创建，作者: {{author}}，查看分类: {{category}}",
          },
        ],
      },
      {
        name: "用户登录安全提醒",
        event: "user:login",
        remark: "管理员登录系统安全提醒",
        actions: [
          {
            channel: "inapp",
            recipient_type: "admin",
            template_title: "用户登录提醒: {{username}}",
            template_body: "用户 {{username}} 于 {{time}} 从 IP: {{ip}} 登录系统",
          },
        ],
      },
      {
        name: "新评论审核提醒",
        event: "comment:beforeCreate",
        remark: "收到访客新评论",
        actions: [
          {
            channel: "inapp",
            recipient_type: "admin",
            template_title: "新评论提醒: {{author}}",
            template_body: "访客 {{author}} 提交了新评论：{{content}}",
          },
        ],
      },
    ];

    for (const d of defaults) {
      await this.saveRule(env, siteId, { name: d.name, event: d.event, remark: d.remark, enabled: 1 }, d.actions);
    }
  }

  // ==========================================================================
  // Event Matching, Template Engine & Enqueue
  // ==========================================================================

  static async onEvent(env: Env, siteId: string, event: string, payload: any = {}, ctx: any = {}): Promise<void> {
    if (!event) return;

    // Fetch enabled rules matching this event (supports exact match or wildcard like 'post:*')
    const allRules = await this.getRules(env, siteId);
    const matchedRules = allRules.filter((r) => {
      if (!r.enabled) return false;
      if (r.event === event || r.event === "*") return true;
      if (r.event.endsWith(":*")) {
        const prefix = r.event.slice(0, -1);
        return event.startsWith(prefix);
      }
      return false;
    });

    if (matchedRules.length === 0) return;

    // Load active channels
    const channels = await this.getChannels(env, siteId);
    const channelMap = new Map(channels.map((c) => [c.code, c]));

    const timestamp = now();

    for (const rule of matchedRules) {
      for (const action of rule.actions || []) {
        if (!action.enabled) continue;
        const ch = channelMap.get(action.channel);
        if (!ch || (!ch.enabled && !ch.builtin)) continue;

        // Render templates
        const title = this.renderTemplate(action.template_title || `系统通知: ${event}`, payload);
        const content = this.renderTemplate(action.template_body || JSON.stringify(payload, null, 2), payload);

        if (action.channel === "inapp") {
          // Write directly to in-app notifications
          const notifId = `inapp_${randomId()}`;
          await env.DB.prepare(`
            INSERT INTO sys_inapp_notifications (id, site_id, user_id, role, event, title, content, url, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)
          `)
            .bind(
              notifId,
              siteId,
              payload.userId || null,
              action.recipient_type || "admin",
              event,
              title,
              content,
              payload.url || null,
              timestamp
            )
            .run();
        } else {
          // Enqueue to sys_notify_queue
          const queueId = `q_${randomId()}`;
          await env.DB.prepare(`
            INSERT INTO sys_notify_queue (id, site_id, rule_id, action_id, event, channel, recipient, title, content, payload, status, attempts, next_attempt_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)
          `)
            .bind(
              queueId,
              siteId,
              rule.id,
              action.id,
              event,
              action.channel,
              action.recipient_target || payload.recipient || "",
              title,
              content,
              JSON.stringify(payload),
              timestamp,
              timestamp
            )
            .run();
        }
      }
    }

    // Immediately trigger a drain attempt
    this.drainQueue(env, siteId).catch(() => {});
  }

  private static renderTemplate(tpl: string, data: Record<string, any>): string {
    return tpl.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key) => {
      const parts = key.split(".");
      let val = data;
      for (const p of parts) {
        val = val?.[p];
      }
      return val !== undefined && val !== null ? String(val) : "";
    });
  }

  // ==========================================================================
  // Queue Drain & Exponential Backoff Worker
  // ==========================================================================

  static async drainQueue(env: Env, siteId: string, limit = 10): Promise<{ processed: number; sent: number; failed: number }> {
    const timestamp = now();
    const rows = await env.DB.prepare(`
      SELECT * FROM sys_notify_queue
      WHERE site_id = ? AND status = 'queued' AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC
      LIMIT ?
    `)
      .bind(siteId, timestamp, limit)
      .all<any>();

    const items = rows.results || [];
    if (items.length === 0) return { processed: 0, sent: 0, failed: 0 };

    const channels = await this.getChannels(env, siteId);
    const channelMap = new Map(channels.map((c) => [c.code, c]));

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      const ch = channelMap.get(item.channel);
      let error = "";
      let success = false;

      if (!ch || (!ch.enabled && !ch.builtin)) {
        error = `渠道 ${item.channel} 未启用`;
      } else {
        let payloadObj = {};
        try {
          payloadObj = JSON.parse(item.payload || "{}");
        } catch {}

        const res = await dispatchToChannel(env, item.channel, ch.config, {
          siteId,
          recipient: item.recipient,
          title: item.title,
          content: item.content,
          payload: payloadObj,
        });
        success = res.success;
        if (!success) error = res.error || "投递失败";
      }

      if (success) {
        sent++;
        await env.DB.prepare(`
          UPDATE sys_notify_queue
          SET status = 'sent', sent_at = ?, error = NULL
          WHERE id = ? AND site_id = ?
        `)
          .bind(now(), item.id, siteId)
          .run();
      } else {
        const nextAttempts = (item.attempts || 0) + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          failed++;
          await env.DB.prepare(`
            UPDATE sys_notify_queue
            SET status = 'failed', attempts = ?, error = ?
            WHERE id = ? AND site_id = ?
          `)
            .bind(nextAttempts, error, item.id, siteId)
            .run();
        } else {
          const delaySec = RETRY_DELAYS_SEC[nextAttempts] || 300;
          const nextAttemptAt = now() + delaySec;
          await env.DB.prepare(`
            UPDATE sys_notify_queue
            SET attempts = ?, next_attempt_at = ?, error = ?
            WHERE id = ? AND site_id = ?
          `)
            .bind(nextAttempts, nextAttemptAt, error, item.id, siteId)
            .run();
        }
      }
    }

    return { processed: items.length, sent, failed };
  }

  // ==========================================================================
  // In-App Notifications Center
  // ==========================================================================

  static async getInAppNotifications(
    env: Env,
    siteId: string,
    options: { status?: string; limit?: number; offset?: number } = {}
  ) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let sql = "SELECT * FROM sys_inapp_notifications WHERE site_id = ?";
    const params: any[] = [siteId];

    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = await env.DB.prepare(sql).bind(...params).all<any>();

    const unreadCountRow = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM sys_inapp_notifications WHERE site_id = ? AND status = 'unread'"
    )
      .bind(siteId)
      .first<{ cnt: number }>();

    return {
      notifications: rows.results || [],
      unreadCount: unreadCountRow?.cnt || 0,
    };
  }

  static async markInAppRead(env: Env, siteId: string, ids?: string[]): Promise<void> {
    const timestamp = now();
    if (!ids || ids.length === 0) {
      await env.DB.prepare(
        "UPDATE sys_inapp_notifications SET status = 'read', read_at = ? WHERE site_id = ? AND status = 'unread'"
      )
        .bind(timestamp, siteId)
        .run();
    } else {
      for (const id of ids) {
        await env.DB.prepare(
          "UPDATE sys_inapp_notifications SET status = 'read', read_at = ? WHERE site_id = ? AND id = ?"
        )
          .bind(timestamp, siteId, id)
          .run();
      }
    }
  }

  static async deleteInAppNotification(env: Env, siteId: string, id: string): Promise<void> {
    await env.DB.prepare("DELETE FROM sys_inapp_notifications WHERE site_id = ? AND id = ?")
      .bind(siteId, id)
      .run();
  }

  // ==========================================================================
  // Delivery Logs
  // ==========================================================================

  static async getDeliveryLogs(
    env: Env,
    siteId: string,
    options: { status?: string; limit?: number; offset?: number } = {}
  ) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let sql = "SELECT * FROM sys_notify_queue WHERE site_id = ?";
    const params: any[] = [siteId];

    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = await env.DB.prepare(sql).bind(...params).all<any>();
    return rows.results || [];
  }
}
