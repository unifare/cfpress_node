/**
 * System Hook Pipeline (src/platform/hooks.ts)
 *
 * Provides a comprehensive, production-grade Action & Filter hook bus:
 * - ACTION_HOOKS: Full catalog of side-effect hooks across System, User, Content, Media, Render, Email, etc.
 * - FILTER_HOOKS: Full catalog of pipeline data transform hooks.
 * - doAction / applyFilters: Async execution with priority ordering, execution timing, and error isolation.
 * - Live Call Chain & Event Loggers: Ring buffers storing recent executions for developer inspection.
 * - Broadcast: Every action fires `system:hookFired` (with recursion guard) for global notification routing.
 */

export interface HookContext {
  env?: any;
  siteId?: string;
  locale?: string;
  request?: Request;
  user?: any;
  [key: string]: any;
}

export type HookHandler = (ctx: HookContext, data: any, ...extra: any[]) => Promise<any> | any;

export interface RegisteredHook {
  handler: HookHandler;
  priority: number;
  origin: string; // e.g. 'system', 'plugin:notify', 'plugin:demo'
}

export interface HookLogEntry {
  id: string;
  timestamp: string;
  hook: string;
  phase: "action" | "filter";
  origin?: string;
  durationMs: number;
  data: any;
}

export interface HookCallLogEntry {
  hookName: string;
  hookType: "action" | "filter";
  pluginName: string;
  order: number;
  totalCallbacks: number;
  timestamp: string;
}

// ============================================================================
// Hook Catalogs
// ============================================================================

export const ACTION_HOOKS: Record<string, string> = {
  // System Lifecycle
  "wp:init": "系统初始化",
  "wp:ready": "系统准备就绪",
  "wp:shutdown": "系统关闭",
  "system:hookFired": "任意 Hook 事件被触发（通配广播，供通知系统等全局订阅）",

  // User
  "user:login": "用户登录成功",
  "user:loginFailed": "用户登录失败",
  "user:logout": "用户登出",
  "user:register": "用户注册",
  "user:created": "用户创建后",
  "user:updated": "用户更新后",
  "user:deleted": "用户删除后",

  // Post & Page
  "post:beforeCreate": "文章创建前",
  "post:afterCreate": "文章创建后",
  "post:beforeUpdate": "文章更新前",
  "post:afterUpdate": "文章更新后",
  "post:beforeDelete": "文章删除前",
  "post:afterDelete": "文章删除后",
  "post:published": "文章发布",
  "post:viewed": "文章被浏览",
  "page:beforeCreate": "页面创建前",
  "page:afterCreate": "页面创建后",
  "page:beforeUpdate": "页面更新前",
  "page:afterUpdate": "页面更新后",
  "page:beforeDelete": "页面删除前",
  "page:afterDelete": "页面删除后",

  // Taxonomy & Terms
  "category:beforeCreate": "分类创建前",
  "category:afterCreate": "分类创建后",
  "category:beforeUpdate": "分类更新前",
  "category:afterUpdate": "分类更新后",
  "category:beforeDelete": "分类删除前",
  "category:afterDelete": "分类删除后",
  "tag:beforeCreate": "标签创建前",
  "tag:afterCreate": "标签创建后",
  "tag:beforeDelete": "标签删除前",
  "tag:afterDelete": "标签删除后",

  // Comments
  "comment:beforeCreate": "评论创建前",
  "comment:afterCreate": "评论创建后",
  "comment:approved": "评论审核通过",
  "comment:rejected": "评论被拒绝",
  "comment:beforeDelete": "评论删除前",
  "comment:afterDelete": "评论删除后",

  // Media
  "media:beforeUpload": "媒体上传前",
  "media:afterUpload": "媒体上传后",
  "media:beforeDelete": "媒体删除前",
  "media:afterDelete": "媒体删除后",

  // Themes & Plugins
  "theme:beforeActivate": "主题激活前",
  "theme:afterActivate": "主题激活后",
  "theme:beforeDeactivate": "主题禁用前",
  "theme:afterDeactivate": "主题禁用后",
  "plugin:beforeActivate": "插件激活前",
  "plugin:afterActivate": "插件激活后",
  "plugin:beforeDeactivate": "插件禁用前",
  "plugin:afterDeactivate": "插件禁用后",

  // Render (Frontend & Admin)
  "frontend:head:start": "前台 <head> 开始",
  "frontend:head:end": "前台 <head> 结束",
  "frontend:body:start": "前台 <body> 开始",
  "frontend:body:end": "前台 <body> 结束",
  "frontend:footer": "前台页脚",
  "frontend:beforeRender": "前台渲染前",
  "frontend:afterRender": "前台渲染后",
  "admin:head:start": "后台 <head> 开始",
  "admin:head:end": "后台 <head> 结束",
  "admin:body:start": "后台 <body> 开始",
  "admin:body:end": "后台 <body> 结束",
  "admin:sidebar:start": "后台侧边栏开始",
  "admin:sidebar:end": "后台侧边栏结束",
  "admin:header": "后台头部",
  "admin:footer": "后台页脚",
  "admin:beforeRender": "后台渲染前",
  "admin:afterRender": "后台渲染后",

  // Menus & Settings
  "menu:beforeRender": "菜单渲染前",
  "menu:afterRender": "菜单渲染后",
  "setting:beforeSave": "设置保存前",
  "setting:afterSave": "设置保存后",

  // Email & Notifications
  "email:beforeSend": "邮件发送前（可改写收件人/主题/内容，或抛错拒绝）",
  "email:afterSend": "邮件发送后（审计与日志）",
  "notify:beforeEnqueue": "通知入队前",
  "notify:afterDispatch": "通知投递完成",
};

export const FILTER_HOOKS: Record<string, string> = {
  // Content Filters
  "content:body": "正文内容过滤（可替换短代码、关键词、追加广告或水印）",
  "content:title": "标题过滤",
  "content:excerpt": "摘要过滤",
  "content:meta": "文章元数据过滤",

  // User
  "user:data": "用户数据过滤",
  "user:profile": "用户资料过滤",
  "user:permissions": "用户权限过滤",

  // Post & Page Queries
  "post:data": "文章数据过滤",
  "post:list": "文章列表过滤",
  "page:data": "页面数据过滤",
  "page:list": "页面列表过滤",

  // Comments & Media
  "comment:content": "评论内容过滤",
  "media:data": "媒体数据过滤",
  "media:url": "媒体 URL 重定向过滤",

  // Menus & Themes
  "admin:menu": "后台侧边栏菜单过滤",
  "member:menu": "会员中心菜单过滤",
  "menu:items": "前台菜单项过滤",
  "theme:options": "主题配置过滤",

  // Settings & Routing
  "setting:value": "设置值读取过滤",
  "setting:default": "设置默认值过滤",
  "url:rewrite": "URL 重写过滤",
  "template:data": "模板渲染数据过滤",
  "response:data": "API 响应数据过滤",
};

// ============================================================================
// Global Hook Registry State
// ============================================================================

const actionRegistry = new Map<string, RegisteredHook[]>();
const filterRegistry = new Map<string, RegisteredHook[]>();

const MAX_LOGS = 1000;
const hookLogs: HookLogEntry[] = [];
const callLogs: HookCallLogEntry[] = [];

let isBroadcasting = false;

// ============================================================================
// Registration APIs
// ============================================================================

export function addAction(name: string, handler: HookHandler, priority = 10, origin = "system"): void {
  const list = actionRegistry.get(name) || [];
  list.push({ handler, priority, origin });
  list.sort((a, b) => a.priority - b.priority);
  actionRegistry.set(name, list);
}

export function addFilter(name: string, handler: HookHandler, priority = 10, origin = "system"): void {
  const list = filterRegistry.get(name) || [];
  list.push({ handler, priority, origin });
  list.sort((a, b) => a.priority - b.priority);
  filterRegistry.set(name, list);
}

export function removeAction(name: string, handler?: HookHandler, origin?: string): void {
  if (!handler && !origin) {
    actionRegistry.delete(name);
    return;
  }
  const list = actionRegistry.get(name) || [];
  actionRegistry.set(
    name,
    list.filter((item) => {
      if (handler && item.handler !== handler) return true;
      if (origin && item.origin !== origin) return true;
      return false;
    })
  );
}

export function removeFilter(name: string, handler?: HookHandler, origin?: string): void {
  if (!handler && !origin) {
    filterRegistry.delete(name);
    return;
  }
  const list = filterRegistry.get(name) || [];
  filterRegistry.set(
    name,
    list.filter((item) => {
      if (handler && item.handler !== handler) return true;
      if (origin && item.origin !== origin) return true;
      return false;
    })
  );
}

// ============================================================================
// Dispatch APIs
// ============================================================================

export async function doAction(name: string, ctx: HookContext = {}, data: any = null): Promise<void> {
  const handlers = actionRegistry.get(name) || [];
  const start = Date.now();

  for (let i = 0; i < handlers.length; i++) {
    const item = handlers[i];
    recordCallLog(name, "action", item.origin, i + 1, handlers.length);
    try {
      await item.handler(ctx, data);
    } catch (err: any) {
      console.error(`[Hook:Action] Error in "${name}" from "${item.origin}":`, err?.message || err);
    }
  }

  const durationMs = Date.now() - start;
  recordHookLog(name, "action", durationMs, data);

  // Global broadcast for system:hookFired (guards against recursion)
  if (!isBroadcasting && name !== "system:hookFired") {
    isBroadcasting = true;
    try {
      await doAction("system:hookFired", ctx, {
        hookName: name,
        phase: "action",
        data,
      });
    } catch {
      // Broadcast failures must never crash the main transaction
    } finally {
      isBroadcasting = false;
    }
  }
}

export async function applyFilters(name: string, ctx: HookContext = {}, data: any = null, ...extra: any[]): Promise<any> {
  const handlers = filterRegistry.get(name) || [];
  const start = Date.now();
  let currentVal = data;

  for (let i = 0; i < handlers.length; i++) {
    const item = handlers[i];
    recordCallLog(name, "filter", item.origin, i + 1, handlers.length);
    try {
      const res = await item.handler(ctx, currentVal, ...extra);
      if (res !== undefined) {
        currentVal = res;
      }
    } catch (err: any) {
      console.error(`[Hook:Filter] Error in "${name}" from "${item.origin}":`, err?.message || err);
    }
  }

  const durationMs = Date.now() - start;
  recordHookLog(name, "filter", durationMs, currentVal);

  return currentVal;
}

// ============================================================================
// Logs & Introspection
// ============================================================================

function recordHookLog(hook: string, phase: "action" | "filter", durationMs: number, data: any): void {
  // Avoid logging the broadcast itself to keep log clean
  if (hook === "system:hookFired") return;

  let safeData: any = null;
  try {
    if (data && typeof data === "object") {
      safeData = JSON.parse(JSON.stringify(data, (key, value) => (key === "env" || key === "db" ? undefined : value)));
    } else {
      safeData = data;
    }
  } catch {
    safeData = "[Complex/Circular Data]";
  }

  hookLogs.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    hook,
    phase,
    durationMs,
    data: safeData,
  });

  if (hookLogs.length > MAX_LOGS) {
    hookLogs.pop();
  }
}

function recordCallLog(hookName: string, hookType: "action" | "filter", pluginName: string, order: number, totalCallbacks: number): void {
  if (hookName === "system:hookFired") return;

  callLogs.unshift({
    hookName,
    hookType,
    pluginName,
    order,
    totalCallbacks,
    timestamp: new Date().toISOString(),
  });

  if (callLogs.length > 500) {
    callLogs.pop();
  }
}

export function getHookLogs(filter?: string): HookLogEntry[] {
  if (!filter) return hookLogs;
  const lower = filter.toLowerCase();
  return hookLogs.filter((l) => l.hook.toLowerCase().includes(lower));
}

export function clearHookLogs(): void {
  hookLogs.length = 0;
}

export function getCallLogs(): HookCallLogEntry[] {
  return callLogs;
}

export function clearCallLogs(): void {
  callLogs.length = 0;
}

export function getAllHooksCatalog() {
  const actionsWithCount: Record<string, { desc: string; handlerCount: number }> = {};
  for (const [name, desc] of Object.entries(ACTION_HOOKS)) {
    actionsWithCount[name] = {
      desc,
      handlerCount: (actionRegistry.get(name) || []).length,
    };
  }

  const filtersWithCount: Record<string, { desc: string; handlerCount: number }> = {};
  for (const [name, desc] of Object.entries(FILTER_HOOKS)) {
    filtersWithCount[name] = {
      desc,
      handlerCount: (filterRegistry.get(name) || []).length,
    };
  }

  return {
    actions: actionsWithCount,
    filters: filtersWithCount,
    totalLogs: hookLogs.length,
    totalCalls: callLogs.length,
  };
}

export async function triggerHookManually(name: string, type: "action" | "filter", payload: any = {}, ctx: HookContext = {}) {
  if (type === "action") {
    await doAction(name, ctx, payload);
    return { success: true, message: `Action hook "${name}" triggered` };
  } else {
    const result = await applyFilters(name, ctx, payload);
    return { success: true, message: `Filter hook "${name}" applied`, result };
  }
}
