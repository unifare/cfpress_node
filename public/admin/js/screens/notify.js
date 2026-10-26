/**
 * Notification System Screen (public/admin/js/screens/notify.js)
 *
 * Provides a unified workstation for:
 * 1. Notification Rules (Event -> Conditions -> Actions)
 * 2. Notification Channels (In-App, Mail/SMTP, Feishu, Telegram, WeCom, DingTalk, ServerChan, Webhook)
 * 3. In-App Notification Center
 * 4. Asynchronous Delivery Logs & Queue status
 */

import { api, scoped, state } from "../state.js";
import { attr, esc, toast } from "../../ui.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { pageHead } from "../shell.js";

let activeTab = "rules";

export default async function notify(mount) {
  mount.innerHTML = `
    ${pageHead({
      title: t("core.notify.title", "Notification Center"),
      sub: t("core.notify.sub", "Configure notification rules, multi-channel dispatchers, in-app inbox and delivery queue."),
      actions: `
        <button class="btn btn-sm btn-outline" id="btn-seed-rules">${icon("sparkles")}<span>${esc(t("core.notify.restoreDefaults", "Restore Defaults"))}</span></button>
        <button class="btn btn-sm btn-primary" id="btn-create-rule">${icon("plus")}<span>${esc(t("core.notify.newRule", "New Rule"))}</span></button>
      `,
    })}

    <div class="notify-tabs-bar" style="display:flex;gap:8px;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem">
      <button class="btn btn-sm ${activeTab === "rules" ? "btn-primary" : "btn-ghost"}" data-tab="rules">${icon("sliders-horizontal")} <span>${esc(t("core.notify.tabRules", "Rules Engine"))}</span></button>
      <button class="btn btn-sm ${activeTab === "channels" ? "btn-primary" : "btn-ghost"}" data-tab="channels">${icon("send")} <span>${esc(t("core.notify.tabChannels", "Channels Matrix"))}</span></button>
      <button class="btn btn-sm ${activeTab === "inbox" ? "btn-primary" : "btn-ghost"}" data-tab="inbox">${icon("bell")} <span>${esc(t("core.notify.tabInbox", "In-App Inbox"))}</span></button>
      <button class="btn btn-sm ${activeTab === "logs" ? "btn-primary" : "btn-ghost"}" data-tab="logs">${icon("activity")} <span>${esc(t("core.notify.tabLogs", "Delivery Logs"))}</span></button>
    </div>

    <div id="notify-tab-content">
      <div style="padding:2rem;text-align:center;color:var(--muted)">${icon("refresh")} 加载中…</div>
    </div>

    <!-- Rule Modal Container -->
    <div id="rule-modal-container" hidden></div>
  `;

  const tabContainer = mount.querySelector("#notify-tab-content");
  const tabsBar = mount.querySelector(".notify-tabs-bar");

  tabsBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    tabsBar.querySelectorAll("[data-tab]").forEach((b) => {
      b.className = `btn btn-sm ${b.dataset.tab === activeTab ? "btn-primary" : "btn-ghost"}`;
    });
    renderTabContent(tabContainer);
  });

  mount.querySelector("#btn-seed-rules").onclick = async () => {
    if (!confirm(t("core.notify.confirmRestore", "Restore built-in default notification rules?"))) return;
    try {
      const res = await api(scoped("notify/rules/seed"), { method: "POST" });
      if (res.error) throw new Error(res.error);
      toast(t("core.notify.restored", "Default notification rules restored"));
      renderTabContent(tabContainer);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  mount.querySelector("#btn-create-rule").onclick = () => {
    openRuleEditor(mount, tabContainer);
  };

  await renderTabContent(tabContainer);
}

// ============================================================================
// Tab Content Rendering
// ============================================================================

async function renderTabContent(container) {
  if (activeTab === "rules") {
    await renderRulesTab(container);
  } else if (activeTab === "channels") {
    await renderChannelsTab(container);
  } else if (activeTab === "inbox") {
    await renderInboxTab(container);
  } else if (activeTab === "logs") {
    await renderLogsTab(container);
  }
}

// --- 1. Rules Tab ---
async function renderRulesTab(container) {
  container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted)">加载规则列表中…</div>`;
  try {
    const res = await api(scoped("notify/rules"), { method: "GET" });
    const rules = res.rules || [];

    if (rules.length === 0) {
      container.innerHTML = `
        <div class="empty-card" style="padding:3rem 1rem;text-align:center;border:1px dashed var(--border);border-radius:8px">
          <div style="font-size:2rem;margin-bottom:0.5rem">${icon("bell")}</div>
          <h3 style="margin-bottom:0.5rem">暂无通知规则</h3>
          <p class="muted" style="margin-bottom:1rem">配置通知规则后，系统事件（如用户登录、新文章、新评论）将自动匹配并投递至指定渠道。</p>
          <button class="btn btn-sm btn-primary" onclick="document.querySelector('#btn-seed-rules').click()">${icon("sparkles")} 恢复默认内置规则</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap"><table class="table">
          <thead>
            <tr>
              <th style="width:20%">规则名称</th>
              <th style="width:25%">触发事件</th>
              <th style="width:10%">优先级</th>
              <th style="width:20%">执行动作 / 渠道</th>
              <th style="width:10%">状态</th>
              <th style="width:15%;text-align:right">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map((r) => {
              const actionsBadges = (r.actions || []).map((a) => `
                <span class="badge" style="background:var(--accent-bg);color:var(--accent-fg);font-size:0.75rem;padding:2px 6px;border-radius:4px;margin-right:4px">
                  ${esc(a.channel)} (${esc(a.recipient_type)})
                </span>
              `).join("") || '<span class="muted small">无动作</span>';

              return `
                <tr>
                  <td>
                    <strong>${esc(r.name)}</strong>
                    ${r.remark ? `<div class="muted small">${esc(r.remark)}</div>` : ""}
                  </td>
                  <td><code style="font-size:0.8rem;background:var(--card);padding:2px 6px;border-radius:4px;border:1px solid var(--border)">${esc(r.event)}</code></td>
                  <td>${r.priority}</td>
                  <td>${actionsBadges}</td>
                  <td>
                    <span class="badge ${r.enabled ? "badge-success" : "badge-secondary"}">
                      ${r.enabled ? "已启用" : "已停用"}
                    </span>
                  </td>
                  <td style="text-align:right">
                    <button class="btn btn-sm btn-ghost btn-edit-rule" data-id="${attr(r.id)}" title="编辑">${icon("pencil")}</button>
                    <button class="btn btn-sm btn-ghost btn-del-rule" data-id="${attr(r.id)}" style="color:var(--danger)" title="删除">${icon("trash")}</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="muted small" style="margin-top:1rem">
        ${icon("info")} 提示：事件名支持通配符，例如 <code>post:*</code> 可匹配所有文章创建、更新与删除事件；系统会自动捕获插件与主题发出的全部 Hook 事件。
      </div>
    `;

    container.querySelectorAll(".btn-edit-rule").forEach((b) => {
      b.onclick = () => {
        const rule = rules.find((r) => r.id === b.dataset.id);
        if (rule) openRuleEditor(container.closest(".page"), container, rule);
      };
    });

    container.querySelectorAll(".btn-del-rule").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确认删除此通知规则？")) return;
        try {
          const dRes = await api(scoped(`notify/rules/${b.dataset.id}`), { method: "DELETE" });
          if (dRes.error) throw new Error(dRes.error);
          toast("规则已删除");
          renderRulesTab(container);
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:1.5rem">加载规则失败: ${esc(err.message)}</div>`;
  }
}

// --- 2. Channels Tab ---
async function renderChannelsTab(container) {
  container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted)">加载通知渠道中…</div>`;
  try {
    const res = await api(scoped("notify/channels"), { method: "GET" });
    const channels = res.channels || [];

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(360px, 1fr));gap:1.25rem">
        ${channels.map((ch) => {
          const isInApp = ch.code === "inapp";
          const isMail = ch.code === "mail";
          const fieldsHtml = (ch.fields || []).map((f) => {
            const val = ch.config?.[f.key] ?? "";
            const inputId = `field_${ch.code}_${f.key}`;
            if (f.type === "select") {
              return `
                <div style="margin-bottom:0.75rem">
                  <label class="small muted" style="display:block;margin-bottom:4px">${esc(f.label)}</label>
                  <select id="${inputId}" class="input input-sm" style="width:100%" data-ch="${attr(ch.code)}" data-key="${attr(f.key)}">
                    ${(f.options || []).map(([k, lbl]) => `
                      <option value="${attr(k)}" ${String(val) === String(k) ? "selected" : ""}>${esc(lbl)}</option>
                    `).join("")}
                  </select>
                </div>
              `;
            }
            const type = f.type === "password" ? "password" : (f.type === "number" ? "number" : "text");
            return `
              <div style="margin-bottom:0.75rem">
                <label class="small muted" style="display:block;margin-bottom:4px">
                  ${esc(f.label)} ${f.type === "password" ? '<span class="muted" style="font-size:0.7rem">（留空保持不变）</span>' : ""}
                </label>
                <input id="${inputId}" type="${type}" class="input input-sm" style="width:100%" data-ch="${attr(ch.code)}" data-key="${attr(f.key)}" value="${attr(val)}" placeholder="${attr(f.placeholder || "")}">
              </div>
            `;
          }).join("");

          return `
            <div class="card channel-card" data-channel="${attr(ch.code)}" style="border:1px solid var(--border);border-radius:8px;padding:1.25rem;background:var(--card)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:1.25rem;color:var(--primary)">${icon(ch.icon || "send")}</span>
                  <strong>${esc(ch.name)}</strong>
                  ${isMail ? '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:0.7rem;padding:2px 6px">基础服务</span>' : ""}
                </div>
                <div>
                  ${isInApp ? '<span class="badge badge-success">开箱即用</span>' : `
                    <label class="switch" style="display:inline-flex;align-items:center;cursor:pointer">
                      <input type="checkbox" id="switch_${attr(ch.code)}" ${ch.enabled ? "checked" : ""}>
                      <span class="slider" style="margin-left:6px;font-size:0.8rem">${ch.enabled ? "已开启" : "未开启"}</span>
                    </label>
                  `}
                </div>
              </div>

              <p class="muted small" style="margin-bottom:1rem;line-height:1.4">${esc(ch.desc || "")}</p>

              ${isInApp ? '<div class="alert alert-info small" style="padding:8px 12px;background:var(--accent-bg);border-radius:6px;margin-bottom:1rem">站内通知中心自动向管理员和前台会员派发站内信与角标提醒，无需额外网络配置。</div>' : `
                <div class="channel-fields" style="margin-bottom:1rem">
                  ${fieldsHtml}
                </div>
              `}

              <div style="display:flex;gap:8px;align-items:center;margin-top:auto;padding-top:0.5rem;border-top:1px solid var(--border)">
                ${isInApp ? "" : `
                  <button class="btn btn-sm btn-primary btn-save-ch" data-ch="${attr(ch.code)}">${icon("save")} 保存</button>
                  <div style="display:flex;gap:4px;flex:1">
                    <input type="text" class="input input-sm test-target" data-ch="${attr(ch.code)}" placeholder="${isMail ? "测试邮箱" : "测试目标(可选)"}" style="flex:1">
                    <button class="btn btn-sm btn-outline btn-test-ch" data-ch="${attr(ch.code)}">${icon("send")} 测试</button>
                  </div>
                `}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    // Wire Channel Actions
    container.querySelectorAll(".btn-save-ch").forEach((btn) => {
      btn.onclick = async () => {
        const code = btn.dataset.ch;
        const enabled = container.querySelector(`#switch_${code}`)?.checked ?? false;
        const config = {};
        container.querySelectorAll(`[data-ch="${code}"][data-key]`).forEach((el) => {
          config[el.dataset.key] = el.value;
        });

        try {
          const res = await api(scoped("notify/channels"), {
            method: "POST",
            body: JSON.stringify({ channel: code, enabled, config }),
          });
          if (res.error) throw new Error(res.error);
          toast(`渠道「${code}」配置已保存`);
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });

    container.querySelectorAll(".btn-test-ch").forEach((btn) => {
      btn.onclick = async () => {
        const code = btn.dataset.ch;
        const to = container.querySelector(`.test-target[data-ch="${code}"]`)?.value || undefined;
        btn.disabled = true;
        btn.innerHTML = `${icon("refresh")} 发送中…`;
        try {
          const res = await api(scoped("notify/channels/test"), {
            method: "POST",
            body: JSON.stringify({ channel: code, to }),
          });
          if (res.error) throw new Error(res.error);
          toast(res.msg || "测试消息发送成功！");
        } catch (err) {
          toast(err.message, "error");
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icon("send")} 测试`;
        }
      };
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:1.5rem">加载渠道矩阵失败: ${esc(err.message)}</div>`;
  }
}

// --- 3. Inbox Tab ---
async function renderInboxTab(container) {
  container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted)">加载站内消息中…</div>`;
  try {
    const res = await api(scoped("notify/inbox"), { method: "GET" });
    const notifications = res.notifications || [];
    const unreadCount = res.unreadCount || 0;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div style="display:flex;align-items:center;gap:8px">
          <strong>未读消息: <span class="badge badge-primary">${unreadCount}</span></strong>
        </div>
        <div>
          <button class="btn btn-sm btn-outline" id="btn-mark-all-read">${icon("check")} 全部标为已读</button>
        </div>
      </div>

      ${notifications.length === 0 ? `
        <div class="empty-card" style="padding:3rem 1rem;text-align:center;border:1px dashed var(--border);border-radius:8px">
          <div style="font-size:2rem;margin-bottom:0.5rem">${icon("bell")}</div>
          <p class="muted">站内消息箱空空如也，暂无通知。</p>
        </div>
      ` : `
        <div class="table-wrap"><table class="table">
            <thead>
              <tr>
                <th style="width:25%">标题</th>
                <th style="width:15%">事件</th>
                <th style="width:35%">内容详情</th>
                <th style="width:10%">状态</th>
                <th style="width:15%;text-align:right">时间 / 操作</th>
              </tr>
            </thead>
            <tbody>
              ${notifications.map((n) => `
                <tr style="${n.status === 'unread' ? 'background:var(--accent-bg);font-weight:500' : ''}">
                  <td>${esc(n.title)}</td>
                  <td><code style="font-size:0.75rem">${esc(n.event || "-")}</code></td>
                  <td style="white-space:pre-wrap;font-size:0.85rem">${esc(n.content)}</td>
                  <td>
                    <span class="badge ${n.status === 'unread' ? 'badge-primary' : 'badge-secondary'}">
                      ${n.status === 'unread' ? '未读' : '已读'}
                    </span>
                  </td>
                  <td style="text-align:right">
                    <div class="muted small">${new Date(n.created_at * 1000).toLocaleString()}</div>
                    <button class="btn btn-sm btn-ghost btn-del-inapp" data-id="${attr(n.id)}" style="color:var(--danger)">${icon("trash")}</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}
    `;

    container.querySelector("#btn-mark-all-read")?.addEventListener("click", async () => {
      try {
        await api(scoped("notify/inbox/read"), { method: "POST", body: JSON.stringify({}) });
        toast("全部通知已标记为已读");
        renderInboxTab(container);
      } catch (err) {
        toast(err.message, "error");
      }
    });

    container.querySelectorAll(".btn-del-inapp").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(scoped(`notify/inbox/${btn.dataset.id}`), { method: "DELETE" });
          toast("已删除");
          renderInboxTab(container);
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:1.5rem">加载站内信失败: ${esc(err.message)}</div>`;
  }
}

// --- 4. Logs Tab ---
async function renderLogsTab(container) {
  container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted)">加载投递队列日志中…</div>`;
  try {
    const res = await api(scoped("notify/logs"), { method: "GET" });
    const logs = res.logs || [];

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div class="muted small">${icon("activity")} 显示最近 50 条外部渠道（邮件、飞书、Telegram、Webhook等）异步投递排队与执行记录</div>
        <button class="btn btn-sm btn-primary" id="btn-drain-queue">${icon("refresh")} 立即执行投递排队</button>
      </div>

      ${logs.length === 0 ? `
        <div class="empty-card" style="padding:3rem 1rem;text-align:center;border:1px dashed var(--border);border-radius:8px">
          <p class="muted">投递队列当前为空，暂无投递记录。</p>
        </div>
      ` : `
        <div class="table-wrap"><table class="table">
            <thead>
              <tr>
                <th style="width:12%">状态</th>
                <th style="width:15%">事件</th>
                <th style="width:12%">渠道</th>
                <th style="width:18%">收件目标</th>
                <th style="width:23%">标题 / 错误</th>
                <th style="width:10%">重试次数</th>
                <th style="width:10%;text-align:right">时间</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((l) => {
                let badgeClass = "badge-secondary";
                if (l.status === "sent") badgeClass = "badge-success";
                if (l.status === "failed") badgeClass = "badge-danger";
                if (l.status === "queued") badgeClass = "badge-warning";

                return `
                  <tr>
                    <td><span class="badge ${badgeClass}">${esc(l.status)}</span></td>
                    <td><code style="font-size:0.75rem">${esc(l.event)}</code></td>
                    <td><strong>${esc(l.channel)}</strong></td>
                    <td class="small">${esc(l.recipient || "-")}</td>
                    <td>
                      <div>${esc(l.title || "")}</div>
                      ${l.error ? `<div class="muted small" style="color:var(--danger)">${esc(l.error)}</div>` : ""}
                    </td>
                    <td>${l.attempts} / ${l.max_attempts}</td>
                    <td style="text-align:right" class="muted small">${new Date(l.created_at * 1000).toLocaleTimeString()}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `}
    `;

    container.querySelector("#btn-drain-queue")?.addEventListener("click", async () => {
      const btn = container.querySelector("#btn-drain-queue");
      btn.disabled = true;
      try {
        const r = await api(scoped("notify/queue/drain"), { method: "POST" });
        toast(`投递完成: 成功 ${r.sent || 0} 条，失败 ${r.failed || 0} 条`);
        renderLogsTab(container);
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:1.5rem">加载投递日志失败: ${esc(err.message)}</div>`;
  }
}

// ============================================================================
// Rule Editor Modal
// ============================================================================

function openRuleEditor(mount, tabContainer, existingRule = null) {
  const modalBox = mount.querySelector("#rule-modal-container");
  modalBox.hidden = false;

  const rule = existingRule || {
    id: "",
    name: "",
    event: "post:afterCreate",
    priority: 10,
    enabled: 1,
    remark: "",
    actions: [{ channel: "inapp", recipient_type: "admin", template_title: "{{title}}", template_body: "{{content}}" }],
  };

  modalBox.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:999">
      <div class="modal-card" style="background:var(--card);border:1px solid var(--border);border-radius:8px;width:90%;max-width:640px;max-height:90vh;overflow-y:auto;padding:1.5rem;box-shadow:var(--shadow-lg)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid var(--border);padding-bottom:0.75rem">
          <h3 style="margin:0">${rule.id ? "编辑通知规则" : "新建通知规则"}</h3>
          <button class="btn btn-sm btn-ghost" id="btn-close-modal">${icon("x")}</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:1rem">
          <div>
            <label class="small muted" style="display:block;margin-bottom:4px">规则名称 *</label>
            <input type="text" id="rule-name" class="input input-sm" style="width:100%" value="${attr(rule.name)}" placeholder="例如：新文章发布通知">
          </div>

          <div>
            <label class="small muted" style="display:block;margin-bottom:4px">触发事件 *</label>
            <input type="text" id="rule-event" class="input input-sm" style="width:100%" value="${attr(rule.event)}" placeholder="例如：post:afterCreate 或 user:*">
            <div class="muted small" style="margin-top:4px">常见事件：<code>post:afterCreate</code>, <code>user:login</code>, <code>comment:beforeCreate</code>, <code>media:afterUpload</code></div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div>
              <label class="small muted" style="display:block;margin-bottom:4px">优先级 (越小越先触发)</label>
              <input type="number" id="rule-priority" class="input input-sm" style="width:100%" value="${attr(rule.priority)}">
            </div>
            <div>
              <label class="small muted" style="display:block;margin-bottom:4px">状态</label>
              <select id="rule-enabled" class="input input-sm" style="width:100%">
                <option value="1" ${rule.enabled ? "selected" : ""}>启用</option>
                <option value="0" ${!rule.enabled ? "selected" : ""}>停用</option>
              </select>
            </div>
          </div>

          <div>
            <label class="small muted" style="display:block;margin-bottom:4px">备注说明</label>
            <input type="text" id="rule-remark" class="input input-sm" style="width:100%" value="${attr(rule.remark || "")}">
          </div>

          <hr style="border:none;border-top:1px solid var(--border);margin:0.5rem 0" />
          <div>
            <h4 style="margin:0 0 0.5rem 0;font-size:0.95rem">执行动作配置</h4>
            <div id="actions-list" style="display:flex;flex-direction:column;gap:0.75rem">
              ${(rule.actions || []).map((a, idx) => `
                <div class="action-item" style="border:1px solid var(--border);border-radius:6px;padding:0.75rem;background:var(--background)">
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.5rem">
                    <div>
                      <label class="small muted" style="display:block;margin-bottom:4px">投递渠道</label>
                      <select class="input input-sm act-channel" style="width:100%">
                        <option value="inapp" ${a.channel === "inapp" ? "selected" : ""}>站内通知 (In-App)</option>
                        <option value="mail" ${a.channel === "mail" ? "selected" : ""}>邮箱服务 (Mail)</option>
                        <option value="feishu" ${a.channel === "feishu" ? "selected" : ""}>飞书机器人 (Feishu)</option>
                        <option value="telegram" ${a.channel === "telegram" ? "selected" : ""}>Telegram Bot</option>
                        <option value="wecom" ${a.channel === "wecom" ? "selected" : ""}>企业微信 (WeCom)</option>
                        <option value="dingtalk" ${a.channel === "dingtalk" ? "selected" : ""}>钉钉 (DingTalk)</option>
                        <option value="serverchan" ${a.channel === "serverchan" ? "selected" : ""}>Server酱</option>
                        <option value="webhook" ${a.channel === "webhook" ? "selected" : ""}>通用 Webhook</option>
                      </select>
                    </div>
                    <div>
                      <label class="small muted" style="display:block;margin-bottom:4px">收件人角色/类型</label>
                      <select class="input input-sm act-recipient-type" style="width:100%">
                        <option value="admin" ${a.recipient_type === "admin" ? "selected" : ""}>站点管理员 (admin)</option>
                        <option value="user" ${a.recipient_type === "user" ? "selected" : ""}>触发事件用户 (user)</option>
                        <option value="all" ${a.recipient_type === "all" ? "selected" : ""}>全员广播 (all)</option>
                      </select>
                    </div>
                  </div>
                  <div style="margin-bottom:0.5rem">
                    <label class="small muted" style="display:block;margin-bottom:4px">消息标题模板（支持 <code>{{key}}</code>）</label>
                    <input type="text" class="input input-sm act-title" style="width:100%" value="${attr(a.template_title || "")}" placeholder="例如：新文章发布: {{title}}">
                  </div>
                  <div>
                    <label class="small muted" style="display:block;margin-bottom:4px">消息正文模板</label>
                    <textarea class="input input-sm act-body" style="width:100%;height:60px" placeholder="例如：文章《{{title}}》由 {{author}} 提交">${esc(a.template_body || "")}</textarea>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem">
          <button class="btn btn-sm btn-outline" id="btn-cancel-modal">取消</button>
          <button class="btn btn-sm btn-primary" id="btn-save-rule-submit">${icon("save")} 保存规则</button>
        </div>
      </div>
    </div>
  `;

  modalBox.querySelector("#btn-close-modal").onclick = () => { modalBox.hidden = true; };
  modalBox.querySelector("#btn-cancel-modal").onclick = () => { modalBox.hidden = true; };

  modalBox.querySelector("#btn-save-rule-submit").onclick = async () => {
    const name = modalBox.querySelector("#rule-name").value.trim();
    const event = modalBox.querySelector("#rule-event").value.trim();
    const priority = parseInt(modalBox.querySelector("#rule-priority").value, 10) || 10;
    const enabled = parseInt(modalBox.querySelector("#rule-enabled").value, 10);
    const remark = modalBox.querySelector("#rule-remark").value.trim();

    if (!name || !event) {
      toast("请填写规则名称与触发事件", "error");
      return;
    }

    const actions = [];
    modalBox.querySelectorAll(".action-item").forEach((el) => {
      actions.push({
        channel: el.querySelector(".act-channel").value,
        recipient_type: el.querySelector(".act-recipient-type").value,
        template_title: el.querySelector(".act-title").value,
        template_body: el.querySelector(".act-body").value,
        enabled: 1,
      });
    });

    try {
      const res = await api(scoped("notify/rules"), {
        method: "POST",
        body: JSON.stringify({
          rule: { id: rule.id || undefined, name, event, priority, enabled, remark },
          actions,
        }),
      });
      if (res.error) throw new Error(res.error);
      toast("通知规则保存成功！");
      modalBox.hidden = true;
      renderRulesTab(tabContainer);
    } catch (err) {
      toast(err.message, "error");
    }
  };
}
