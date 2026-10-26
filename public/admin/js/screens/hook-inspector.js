/**
 * Hook Inspector & Testing Console Screen (public/admin/js/screens/hook-inspector.js)
 *
 * Professional developer console for:
 * 1. Inspecting the full catalog of 100+ system Action & Filter hooks
 * 2. Visualizing live Hook Call Chains and execution priority
 * 3. One-click manual trigger & testing with mock payload
 * 4. Real-time ring-buffered execution logs with latency metrics
 */

import { api, scoped, state } from "../state.js";
import { attr, esc, toast } from "../../ui.js";
import { icon } from "../../icons.js";
import { t } from "../i18n.js";
import { pageHead } from "../shell.js";

let selectedHook = null;
let selectedType = "action";
let filterKeyword = "";

export default async function hookInspector(mount) {
  mount.innerHTML = `
    ${pageHead({
      title: t("core.hooks.title", "Hook Inspector & Tester"),
      sub: t("core.hooks.sub", "Inspect system lifecycle hooks, filter pipelines, plugin execution order, and trigger manual test dispatches."),
      actions: `
        <button class="btn btn-sm btn-outline" id="btn-refresh-hooks">${icon("refresh")}<span>${esc(t("core.action.refresh", "Refresh"))}</span></button>
        <button class="btn btn-sm btn-ghost" id="btn-clear-logs" style="color:var(--danger)">${icon("trash")}<span>${esc(t("core.action.clearLogs", "Clear Logs"))}</span></button>
      `,
    })}

    <!-- KPI Stats Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:1rem;margin-bottom:1.5rem">
      <div class="card" style="padding:1rem;border:1px solid var(--border);border-radius:8px;background:var(--card)">
        <div class="muted small">总触发日志</div>
        <div style="font-size:1.75rem;font-weight:700;color:var(--primary)" id="stat-total-logs">0</div>
      </div>
      <div class="card" style="padding:1rem;border:1px solid var(--border);border-radius:8px;background:var(--card)">
        <div class="muted small">可用 Action 钩子</div>
        <div style="font-size:1.75rem;font-weight:700;color:#10b981" id="stat-actions">0</div>
      </div>
      <div class="card" style="padding:1rem;border:1px solid var(--border);border-radius:8px;background:var(--card)">
        <div class="muted small">可用 Filter 钩子</div>
        <div style="font-size:1.75rem;font-weight:700;color:#0ea5e9" id="stat-filters">0</div>
      </div>
      <div class="card" style="padding:1rem;border:1px solid var(--border);border-radius:8px;background:var(--card)">
        <div class="muted small">实时调用链深度</div>
        <div style="font-size:1.75rem;font-weight:700;color:#f59e0b" id="stat-calls">0</div>
      </div>
    </div>

    <!-- Main Workspace: Left (Catalog & Call Chain) / Right (Execution Logs) -->
    <div style="display:grid;grid-template-columns:380px 1fr;gap:1.5rem;align-items:start">
      <!-- Left Panel -->
      <div style="display:flex;flex-direction:column;gap:1rem">
        <div class="card" style="border:1px solid var(--border);border-radius:8px;padding:1rem;background:var(--card)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
            <strong>可用 Hook 目录</strong>
            <span class="muted small" id="hook-total-count">0</span>
          </div>
          <div style="margin-bottom:0.75rem">
            <input type="text" id="hook-search-input" class="input input-sm" style="width:100%" placeholder="搜索 Hook 名称...">
          </div>
          <div id="hook-tree-container" style="max-height:480px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
            <div style="padding:1rem;text-align:center;color:var(--muted)">加载中…</div>
          </div>
        </div>

        <!-- Call Chain Trace Card -->
        <div class="card" style="border:1px solid var(--border);border-radius:8px;padding:1rem;background:var(--card)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
            <strong><span style="font-size:0.9rem">${icon("layers")}</span> 调用链追踪 (Call Chain)</strong>
            <button class="btn btn-xs btn-ghost" id="btn-clear-calls" style="color:var(--danger)">清空</button>
          </div>
          <div id="call-chain-container" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
            <div style="padding:0.75rem;text-align:center;color:var(--muted);font-size:0.8rem">暂无调用记录</div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Execution Logs -->
      <div class="card" style="border:1px solid var(--border);border-radius:8px;padding:1.25rem;background:var(--card)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <div>
            <strong>实时执行与触发日志</strong>
            <span class="muted small" style="margin-left:8px">捕获全站生命周期与插件拦截事件</span>
          </div>
          <div style="display:flex;gap:6px">
            <input type="text" id="log-filter-input" class="input input-sm" placeholder="过滤触发日志..." style="width:180px">
          </div>
        </div>

        <div id="logs-table-container">
          <div style="padding:2rem;text-align:center;color:var(--muted)">加载日志流中…</div>
        </div>
      </div>
    </div>
  `;

  // --- Data Loading & Event Handlers ---
  let catalogData = { actions: {}, filters: {}, totalLogs: 0, totalCalls: 0 };
  let logsData = [];
  let callsData = [];

  async function loadData() {
    try {
      const [catRes, logRes, callRes] = await Promise.all([
        api(scoped("hooks/list"), { method: "GET" }),
        api(scoped("hooks/logs"), { method: "GET" }),
        api(scoped("hooks/calls"), { method: "GET" }),
      ]);

      catalogData = catRes || { actions: {}, filters: {}, totalLogs: 0, totalCalls: 0 };
      logsData = logRes?.logs || [];
      callsData = callRes?.calls || [];

      // Update KPI counters
      mount.querySelector("#stat-total-logs").textContent = catalogData.totalLogs || logsData.length;
      mount.querySelector("#stat-actions").textContent = Object.keys(catalogData.actions || {}).length;
      mount.querySelector("#stat-filters").textContent = Object.keys(catalogData.filters || {}).length;
      mount.querySelector("#stat-calls").textContent = callsData.length;
      mount.querySelector("#hook-total-count").textContent = `${Object.keys(catalogData.actions || {}).length + Object.keys(catalogData.filters || {}).length} 个`;

      renderCatalog(mount.querySelector("#hook-tree-container"));
      renderCallChain(mount.querySelector("#call-chain-container"));
      renderLogs(mount.querySelector("#logs-table-container"));
    } catch (err) {
      toast(`加载 Hook 数据失败: ${err.message}`, "error");
    }
  }

  function renderCatalog(container) {
    const kw = filterKeyword.toLowerCase().trim();
    const actionEntries = Object.entries(catalogData.actions || {}).filter(([k, v]) => !kw || k.toLowerCase().includes(kw) || v.desc?.toLowerCase().includes(kw));
    const filterEntries = Object.entries(catalogData.filters || {}).filter(([k, v]) => !kw || k.toLowerCase().includes(kw) || v.desc?.toLowerCase().includes(kw));

    container.innerHTML = `
      <div style="margin-bottom:8px">
        <div style="font-weight:600;font-size:0.8rem;color:var(--primary);margin-bottom:4px;display:flex;align-items:center;gap:4px">
          ${icon("zap")} Action Hooks (${actionEntries.length})
        </div>
        ${actionEntries.map(([name, info]) => `
          <div class="hook-item" data-name="${attr(name)}" data-type="action" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);margin-bottom:4px;background:var(--background);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
            <div style="overflow:hidden;text-overflow:ellipsis">
              <code style="font-size:0.75rem;font-weight:600">${esc(name)}</code>
              <div class="muted" style="font-size:0.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(info.desc || "")}</div>
            </div>
            <button class="btn btn-xs btn-outline btn-trigger-hook" data-name="${attr(name)}" data-type="action" title="触发测试">${icon("play")}</button>
          </div>
        `).join("")}
      </div>

      <div>
        <div style="font-weight:600;font-size:0.8rem;color:#0ea5e9;margin-bottom:4px;display:flex;align-items:center;gap:4px">
          ${icon("funnel")} Filter Hooks (${filterEntries.length})
        </div>
        ${filterEntries.map(([name, info]) => `
          <div class="hook-item" data-name="${attr(name)}" data-type="filter" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);margin-bottom:4px;background:var(--background);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
            <div style="overflow:hidden;text-overflow:ellipsis">
              <code style="font-size:0.75rem;font-weight:600;color:#0ea5e9">${esc(name)}</code>
              <div class="muted" style="font-size:0.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(info.desc || "")}</div>
            </div>
            <button class="btn btn-xs btn-outline btn-trigger-hook" data-name="${attr(name)}" data-type="filter" title="测试此 Filter">${icon("play")}</button>
          </div>
        `).join("")}
      </div>
    `;

    container.querySelectorAll(".btn-trigger-hook").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const type = btn.dataset.type;
        btn.disabled = true;
        try {
          const res = await api(scoped("hooks/trigger"), {
            method: "POST",
            body: JSON.stringify({ name, type, data: { test: true, timestamp: new Date().toISOString() } }),
          });
          if (res.error) throw new Error(res.error);
          toast(`已触发 Hook: ${name}`);
          loadData();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  function renderCallChain(container) {
    if (callsData.length === 0) {
      container.innerHTML = `<div style="padding:0.75rem;text-align:center;color:var(--muted);font-size:0.8rem">暂无调用记录</div>`;
      return;
    }

    container.innerHTML = callsData.slice(0, 30).map((c) => `
      <div style="padding:4px 8px;border-radius:4px;background:var(--background);border:1px solid var(--border);font-size:0.75rem;display:flex;align-items:center;justify-content:space-between">
        <div>
          <code>${esc(c.hookName)}</code>
          <span class="muted" style="margin-left:4px">(${esc(c.pluginName)})</span>
        </div>
        <span class="badge ${c.hookType === 'action' ? 'badge-primary' : 'badge-secondary'}" style="font-size:0.65rem">
          ${c.order}/${c.totalCallbacks}
        </span>
      </div>
    `).join("");
  }

  function renderLogs(container) {
    const kw = mount.querySelector("#log-filter-input")?.value?.toLowerCase().trim();
    const filtered = kw ? logsData.filter((l) => l.hook?.toLowerCase().includes(kw)) : logsData;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-card" style="padding:3rem 1rem;text-align:center;border:1px dashed var(--border);border-radius:8px">
          <p class="muted">暂无匹配的 Hook 触发日志。</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap"><table class="table">
          <thead>
            <tr>
              <th style="width:16%">触发时间</th>
              <th style="width:24%">Hook 名称</th>
              <th style="width:10%">类型</th>
              <th style="width:10%">耗时</th>
              <th style="width:40%">负载数据 (Data Snapshot)</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.slice(0, 50).map((l) => `
              <tr>
                <td class="muted small">${new Date(l.timestamp).toLocaleTimeString()}</td>
                <td>
                  <code style="font-size:0.8rem;${l.phase === 'filter' ? 'color:#0ea5e9' : 'color:#10b981'}">${esc(l.hook)}</code>
                </td>
                <td>
                  <span class="badge ${l.phase === 'action' ? 'badge-success' : 'badge-secondary'}" style="font-size:0.7rem">
                    ${esc(l.phase)}
                  </span>
                </td>
                <td class="small">${l.durationMs}ms</td>
                <td>
                  <pre style="margin:0;max-height:80px;overflow:auto;font-size:0.75rem;background:var(--background);padding:4px 6px;border-radius:4px"><code>${esc(typeof l.data === 'object' ? JSON.stringify(l.data, null, 2) : String(l.data ?? ""))}</code></pre>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // Event wiring
  mount.querySelector("#btn-refresh-hooks").onclick = () => loadData();

  mount.querySelector("#btn-clear-logs").onclick = async () => {
    if (!confirm("确认清空所有 Hook 触发日志？")) return;
    try {
      await api(scoped("hooks/clear-logs"), { method: "POST" });
      toast("Hook 日志已清空");
      loadData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  mount.querySelector("#btn-clear-calls").onclick = async () => {
    try {
      await api(scoped("hooks/clear-calls"), { method: "POST" });
      toast("调用记录已清空");
      loadData();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  mount.querySelector("#hook-search-input").addEventListener("input", (e) => {
    filterKeyword = e.target.value;
    renderCatalog(mount.querySelector("#hook-tree-container"));
  });

  mount.querySelector("#log-filter-input").addEventListener("input", () => {
    renderLogs(mount.querySelector("#logs-table-container"));
  });

  await loadData();
}
