/**
 * Notification Channels Registry & Dispatchers (src/platform/notification/channels.ts)
 *
 * Defines the standard channel schemas (form fields for admin configuration)
 * and message dispatch adapters (In-App, Email, Feishu, Telegram, WeCom, DingTalk, ServerChan, Webhook).
 */

import { Env } from "../../shared/types";
import { EmailService } from "../email";

export interface ChannelField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "select";
  placeholder?: string;
  options?: [string, string][];
}

export interface ChannelMeta {
  code: string;
  name: string;
  icon: string;
  type: "builtin" | "smtp" | "webhook";
  desc?: string;
  builtin?: boolean;
  fields: ChannelField[];
}

export const NOTIFICATION_CHANNELS: ChannelMeta[] = [
  {
    code: "inapp",
    name: "站内通知",
    icon: "bell",
    type: "builtin",
    desc: "系统内置站内通知中心，无须额外配置，新消息直达管理员与用户中心",
    builtin: true,
    fields: [],
  },
  {
    code: "mail",
    name: "邮箱服务",
    icon: "mail",
    type: "smtp",
    desc: "系统基础邮件服务，供通知、验证码、安全告警等全场景复用",
    fields: [
      { key: "smtp_host", label: "SMTP 主机", type: "text", placeholder: "smtp.example.com" },
      { key: "smtp_port", label: "端口", type: "number", placeholder: "465" },
      {
        key: "smtp_secure",
        label: "SSL 加密",
        type: "select",
        options: [
          ["1", "SSL / TLS (465)"],
          ["0", "STARTTLS (587)"],
        ],
      },
      { key: "smtp_user", label: "账号", type: "text", placeholder: "noreply@example.com" },
      { key: "smtp_pass", label: "密码 / 授权码", type: "password" },
      { key: "smtp_from", label: "发件人显示", type: "text", placeholder: "CFPress 系统通知 <noreply@example.com>" },
    ],
  },
  {
    code: "feishu",
    name: "飞书机器人",
    icon: "send",
    type: "webhook",
    desc: "飞书群自定义机器人 Webhook",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "text", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/..." },
      { key: "secret", label: "加签密钥（可选）", type: "password" },
    ],
  },
  {
    code: "telegram",
    name: "Telegram Bot",
    icon: "send",
    type: "webhook",
    desc: "Telegram 官方 Bot 推送",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", placeholder: "123456:ABC-..." },
      { key: "chat_id", label: "Chat ID", type: "text", placeholder: "-1001234567890" },
    ],
  },
  {
    code: "wecom",
    name: "企业微信",
    icon: "message-square",
    type: "webhook",
    desc: "企业微信群机器人 Webhook",
    fields: [
      { key: "webhook_url", label: "群机器人 Webhook", type: "text", placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." },
    ],
  },
  {
    code: "dingtalk",
    name: "钉钉机器人",
    icon: "message-circle",
    type: "webhook",
    desc: "钉钉群自定义机器人 Webhook",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "text", placeholder: "https://oapi.dingtalk.com/robot/send?access_token=..." },
      { key: "secret", label: "加签密钥（可选）", type: "password" },
    ],
  },
  {
    code: "serverchan",
    name: "Server酱",
    icon: "bell",
    type: "webhook",
    desc: "微信消息推送服务",
    fields: [
      { key: "sendkey", label: "SendKey", type: "password", placeholder: "SCT..." },
    ],
  },
  {
    code: "webhook",
    name: "通用 Webhook",
    icon: "globe",
    type: "webhook",
    desc: "通用 HTTP POST JSON 接口",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "text", placeholder: "https://api.example.com/webhook" },
      { key: "secret", label: "签名密钥或 Bearer Token", type: "password" },
    ],
  },
];

export function getChannelMeta(code: string): ChannelMeta | undefined {
  return NOTIFICATION_CHANNELS.find((c) => c.code === code);
}

// ============================================================================
// Channel Dispatch Implementations
// ============================================================================

export interface DispatchMessage {
  siteId: string;
  recipient?: string;
  title: string;
  content: string;
  url?: string;
  payload?: any;
}

export async function dispatchToChannel(
  env: Env,
  channelCode: string,
  config: Record<string, any>,
  msg: DispatchMessage
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (channelCode) {
      case "inapp": {
        // Handled directly into sys_inapp_notifications
        return { success: true };
      }

      case "mail": {
        const to = msg.recipient || config.smtp_user || config.smtp_from;
        if (!to) throw new Error("未指定接收邮箱地址");
        await EmailService.send(env, msg.siteId, {
          to,
          subject: msg.title,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #1f2937; margin-top: 0;">${msg.title}</h2>
              <div style="color: #374151; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${msg.content}</div>
              ${msg.url ? `<div style="margin-top: 20px;"><a href="${msg.url}" style="display: inline-block; padding: 8px 16px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 14px;">查看详情</a></div>` : ""}
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 12px 0;" />
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">来自 CFPress 系统通知 · 站点 ${msg.siteId}</p>
            </div>
          `,
          text: `${msg.title}\n\n${msg.content}\n${msg.url || ""}`,
        });
        return { success: true };
      }

      case "feishu": {
        const url = config.webhook_url;
        if (!url) throw new Error("飞书 Webhook URL 未配置");
        const body: any = {
          msg_type: "text",
          content: { text: `【${msg.title}】\n${msg.content}${msg.url ? `\n链接: ${msg.url}` : ""}` },
        };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      case "telegram": {
        const token = config.bot_token;
        const chatId = config.chat_id || msg.recipient;
        if (!token || !chatId) throw new Error("Telegram Bot Token 或 Chat ID 未配置");
        const text = `*${msg.title}*\n\n${msg.content}${msg.url ? `\n[查看详情](${msg.url})` : ""}`;
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      case "wecom": {
        const url = config.webhook_url;
        if (!url) throw new Error("企业微信 Webhook URL 未配置");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: `【${msg.title}】\n${msg.content}${msg.url ? `\n${msg.url}` : ""}` },
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      case "dingtalk": {
        const url = config.webhook_url;
        if (!url) throw new Error("钉钉 Webhook URL 未配置");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: `【${msg.title}】\n${msg.content}${msg.url ? `\n${msg.url}` : ""}` },
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      case "serverchan": {
        const sendkey = config.sendkey;
        if (!sendkey) throw new Error("Server酱 SendKey 未配置");
        const res = await fetch(`https://sctapi.ftqq.com/${sendkey}.send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: msg.title,
            desp: `${msg.content}${msg.url ? `\n\n[查看详情](${msg.url})` : ""}`,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      case "webhook": {
        const url = config.webhook_url;
        if (!url) throw new Error("Webhook URL 未配置");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.secret) {
          headers["Authorization"] = `Bearer ${config.secret}`;
        }
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event: msg.payload?.event || "notification",
            title: msg.title,
            content: msg.content,
            url: msg.url,
            siteId: msg.siteId,
            timestamp: new Date().toISOString(),
            payload: msg.payload,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return { success: true };
      }

      default:
        throw new Error(`未知通知渠道: ${channelCode}`);
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
