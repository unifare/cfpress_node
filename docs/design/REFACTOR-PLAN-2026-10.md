# CFPress 重构方案（2026-10）

> 状态：**提案**。本文只描述「按什么顺序改、每步怎么验收、什么不做」。
> 数字全部来自 2026-10-19 的实测，不是估计值；改动前请重跑文中的命令复核。

## 0. 先说结论

**值得重构的只有三处，其余都不值得动。**

| 候选 | 价值 | 风险 | 结论 |
|---|---|---|---|
| 后台 11.6k 行 JS 进入类型系统 | **高**（唯一的整块静态盲区） | **低**（零运行时改动） | **做，第一个做** |
| 安全响应头 + 口令/限流参数化 | 高（与「安全是卖点」直接相关） | 低（可分级放开） | **做，可与上一项并行** |
| `src/api.ts` 拆域 | 中（可维护性，用户不可见） | **高**（18 个注入锚点 + 11 处守卫按路径读 + 租户裁决按行号索引） | **做，但放最后，且先改守卫** |
| 文档/元数据数字 | 低但便宜 | 极低 | 顺手做（阶段 0） |
| 共享 esbuild bundle 缓存 | 低（套件实测 1–4s，不是瓶颈） | 中（缓存失效 = 新的假绿） | **不做** |
| 后台迁 React / 引入构建步骤 | 负 | 高 | **不做**（见 §6） |

一个必须先纠正的前提：**测试链不是瓶颈**。实测 `architecture` 2s、`admin-spa` 2s、`admin-contract` 4s、`theme-bundled` 3s，36 个入口串行约 1.5–2 分钟。真正慢的是注入器一轮约 9 分钟——那是**改规则时**才付的成本，不该为它重构测试基础设施。

---

## 1. 不变量（任何阶段都不得触碰）

这五条来自 `AGENTS.md` 的 20 维清单，是这次重构的边界条件，不是建议：

1. **不引入构建步骤。** `public/admin` 是 `ASSETS` 直接服务的静态资产，`src/` 由 wrangler 现场打包。加 bundler = 改部署契约（维度 17）。
2. **不拆 Worker。** 多站点隔离在存储层（维度 2），拆进程只增加运维面，不增加隔离。
3. **不动 D1 schema**，唯一例外是阶段 2.3 的登录计数表（需走维度 15 + 迁移只增）。
4. **不改 `PBKDF2_ITERATIONS` 默认值**（25000 是免费计划 10ms CPU 的实测产物）。只做「可上调」。
5. **每个新增具名断言都必须有注入场景。** 没有反向验证的守卫视为不存在（`AGENTS.md` 规则 8）。

---

## 2. 阶段 0：基线校准（1 个提交，约 1 小时）

### 为什么先做这个

因为后面每个阶段都要拿「套件数 / 断言数 / tsc 错误数」当验收口径，而现在这三个数字**全是错的**：

| 位置 | 写的 | 实测 |
|---|---|---|
| `README.md:10` 徽章 | 28 suites | `npm test` 36 个入口 / 35 个套件文件 |
| `package.json:3` | `0.7.0` | 迁移已到 `0032`，HANDOVER 称 v0.8.0 |
| `src/api.ts` health 端点 | `version: "0.7.0"` | 与 package.json 一致，但两者都落后于功能 |
| `docs/HANDOVER.md:35-37` | admin-contract 280 / theme-bundled 160 | 实测 **316 / 354** |

数字漂移不是洁癖问题：`HANDOVER.md` 是「接手时先读」的文档，它给出的基线比现实低 36 条断言，意味着**回归会被漏判**。

### 做什么

1. 新建 `src/shared/version.ts`，导出唯一常量 `VERSION`；`api.ts` 的 health 改读它。
2. 新建 `scripts/check-meta.mjs`：校验 `package.json.version === VERSION`、README 徽章数字 === `npm test` 链长度。失败时打印**两边实际值**。
3. 徽章改为由本阶段新建的 `scripts/check-meta.mjs` 生成（带 `--fix` 参数），而不是手写。
4. `HANDOVER.md` 顶部的「基线」段改为贴 `npm test` 的尾部输出，不再手写条数。
5. 把这个校验接进 `npm run gate`。

### 验收与反向验证

- 该脚本退出码 0。
- 反向验证两条：把 `package.json` 版本改回 `0.7.0` → 红；把徽章改成 `99` → 红。
- 守卫必须断言「正则确实匹配到了徽章」（非空性），否则 README 一改格式守卫就静默变绿。

---

## 3. 阶段 1：后台 JS 进入类型系统（4–6 个提交）——**优先级最高**

### 实测基线

用一份临时 `tsconfig`（`allowJs` + `checkJs`，`strict: false`）扫 `public/admin/**/*.js`：

```
340 errors，7 种错误码
  321  TS2339  属性不存在
    9  TS2345  实参类型不匹配
    3  TS2367  比较无重叠
    2  TS2741 / 2 TS2353 / 2 TS2322 / 1 TS2554
```

分布高度集中：

| 模式 | 数量 | 占比 |
|---|---|---|
| `e.target.closest(...)` —— `EventTarget` 上没有 `closest` | **140** | 41% |
| 表单读取 `.value` / `.checked` —— `Element` 上没有 | **96** | 28% |
| `window.CFP_ADMIN_BASE` 未声明 | 6 | 2% |
| `.dataset` / `.style` / `.matches` / `.focus` 等 | ~60 | 18% |
| 其余（真类型错误） | ~38 | 11% |

按文件：`editor.js` 59、`widgets.js` 41、`menu-config.js` 21、`theme-assets.js` 20、`content-list.js` 20。

**结论：这不是「11.6k 行要补类型」，而是「3 个机械模式 + 38 处手工」。** 这也是为什么它排第一：投入小、风险为零、收益是整块盲区消失。

### 3.1 建立工程骨架

`public/admin/types.d.ts`：

```ts
interface Window {
  CFP_ADMIN_BASE?: string;
}
```

`tsconfig.admin.json`（**不要**改 `tsconfig.json` 的 `include`，那是 `src/` 的严格项目）：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "Bundler",
    "allowJs": true, "checkJs": true, "noEmit": true,
    "strict": false, "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["public/admin/**/*.js", "public/admin/types.d.ts"]
}
```

`strict: false` 是刻意的：先把「属性不存在」这类**真错**抓住，不跟 `null` 检查缠斗。等预算降到 0 再单独评估 `strictNullChecks`。

### 3.2 棘轮（ratchet）——本阶段的关键机制

一次性把 340 条修到 0 不现实，也不该阻塞其它工作。所以引入预算文件 `tests/fixtures/admin-type-budget.json`：

```json
{ "errors": 340, "note": "只能减，不能增；降到 0 后删除本文件并把守卫改成必须为 0" }
```

`scripts/check-admin-types.mjs` 的行为：

- 跑 `tsc -p tsconfig.admin.json --pretty false`
- 统计 `error TS` 行数
- `actual > budget` → 退出码 1，并打印**新增的每一条**（按文件 diff）
- `actual < budget` → 退出码 0，但打印 `budget can be lowered to N`
- 接进 `npm run gate`

**为什么必须用棘轮而不是「先修完再接」**：后者会在分支上堆一个几千行的 diff，评审无法逐条看，等于没有评审。棘轮让每个提交都小、可审、可回滚，并且**立刻**阻止新的未类型化代码进来。

### 3.3 三个 codemod

**a) `closest`（140 处）**

在 `public/admin/ui.js` 增加：

```js
/** @param {Event} e @param {string} sel @returns {Element|null} */
export function closestEl(e, sel) {
  return e.target instanceof Element ? e.target.closest(sel) : null;
}
```

把 `e.target.closest(` 机械替换为 `closestEl(e, `。语义等价（原代码对非 Element 目标本来会抛），且**没有任何守卫锚定这个字符串**（已 grep 确认），codemod 安全。

**b) 表单读取（96 处）**

```js
/** @param {string} id @returns {HTMLInputElement} */
export function field(id) { return /** @type {HTMLInputElement} */ (document.getElementById(id)); }
```

`document.getElementById("x").value` → `field("x").value`；`.checked` 同理。对 `querySelector` 的少数站点用 JSDoc 断言：

```js
/** @type {HTMLInputElement|null} */ (document.querySelector("#u"))
```

**c) 剩余 ~38 处**

逐文件手工，重点在 `editor.js`（59 条里大部分是块属性的 `attrs` 形状）。这里值得顺手补 `@typedef`：

```js
/** @typedef {{ type: string, attrs: Record<string, string>, html?: string }} Block */
```

这不是装饰——`editor.js` 的 `attrs` 形状正是 §12 第 15 种假绿（编辑器写 `attrs.text`、渲染器读别的键，12 个块里 6 个在 200 状态下渲染为空）的现场。

### 3.4 预算归零后

- 删除 `admin-type-budget.json`
- `check-admin-types.mjs` 改为「任何一条都红」
- `npm run typecheck` 同时跑两个项目：`tsc --noEmit && tsc -p tsconfig.admin.json`
- 在 `AGENTS.md` 的「改完代码后」加一条：改了 `public/admin/**` 必须跑 `tsc -p tsconfig.admin.json`

### 3.5 验收与反向验证

- 每个 codemod 提交：预算从 340 → 200 → 104 → 66 → 0，**只降不升**。
- 反向验证（必须做）：在 `admin.js` 里把 `attr` 的 import 删掉 → `check-admin-types` 必须红（`Cannot find name 'attr'`）。这是对「类型检查真的覆盖了后台」的证明，也是对 §12 第 15 种的静态补强。
- 真实浏览器验收：`node tests/tools/_ui-admin-functional.cjs`（需先起 `wrangler dev --port 47913`），确认 codemod 没有改变 DOM 行为。

### 3.6 风险

- **低**。唯一真实风险是 codemod 误伤：`e.target.closest(` 出现在字符串或注释里。提交前用 `git diff --stat` 核对改动行数应≈140，并跑一次 `node tests/suites/admin-spa.test.mjs`。
- 回滚：每个 codemod 是独立提交，`git revert` 单条即可。

---

## 4. 阶段 2：安全基线（3 个提交，可与阶段 1 并行）

### 现状（实测）

- **没有任何安全响应头**：`src/` 与 `public/` 里搜不到 `Content-Security-Policy` / `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / `Strict-Transport-Security`。
- Cookie 属性是对的：`HttpOnly; SameSite=Lax; Secure`（`platform/auth.ts:39`）。
- 登录限流存在，但**按 isolate 计数**，注释自己写明多 isolate 可绕过（`platform/auth.ts:324-347`）。
- `PBKDF2_ITERATIONS = 25000`（`shared/crypto.ts:35`），约为 OWASP 建议值的 1/24。但哈希串格式是 `pbkdf2$25000$salt$hash`——**迭代数已经存在哈希里**，所以调高不会让旧密码失效。

### 2.1 统一响应头出口（1 个提交）

`src/index.ts:210` 是唯一的 `export default`，但它内部有几十个 `return`。改法是把方法体抽成函数，外面包一层：

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return withSecurityHeaders(await handleRequest(request, env, ctx));
  },
};
```

`withSecurityHeaders` 必须 `new Response(res.body, res)` 后再 `set`，不能直接改 `res.headers`（重定向与资产响应可能不可变）。

首版头：

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

**为什么必须带 `'unsafe-inline'`**：后台 SPA 大量使用内联 `onclick`（`WINDOW_HANDLERS` 机制），主题模板也直接写 `<script>`（ctblog / default / prism / shop 都有）。要去掉它得先给模板引擎加 nonce —— 那是独立项目，不在本次范围。即便如此，这条 CSP 仍然**堵住了外部脚本加载**，这是当前最大的实际风险面。

`img-src https:` 是必需的：捆绑主题引用 `upload.wikimedia.org`，媒体还可以走 imgbb / postimages。

`Strict-Transport-Security` 只在 `request.url` 是 https 时发（本地 dev 是 http）。

### 2.2 口令强度可上调（1 个提交）

`PBKDF2_ITERATIONS` 改为读 `env.CFP_PBKDF2_ITERATIONS`，校验为整数且 `>= 25000`，默认仍是 25000。哈希串里已带迭代数，验证路径无需改动。付费计划部署可以设到 100000+，免费计划保持现状。

### 2.3 登录限流持久化（1 个提交，含迁移 0033）

新增 `login_attempts(key TEXT PRIMARY KEY, count INTEGER, first_at INTEGER, last_at INTEGER)`，`key = sha256(username + "|" + ip)`。策略：

- 失败时先查内存（快路径，命中即拒），未命中则读 D1 计数
- 失败 +1，成功则删除该 key
- 5 次失败后 15 分钟内拒绝，`429` 语义不变

只对**失败**写库，正常登录零额外写入。

⚠️ 这个提交必须走完整 20 维清单：`contract/schema.ts` 声明租户归属（这张表是**安装级**的，不是站点级——要写清理由）、`_tenant-query-audit` 补裁决、`_residue-guard` 加清理、迁移只增。

### 验收与反向验证

- `curl -sI http://localhost:47913/en/` 必须看到四条头；`/admin/` 必须看到 CSP。
- 真实浏览器验收：`_ui-admin-functional.cjs` + `_i18n-browser.cjs`，确认 CSP 没有拦掉 Google Fonts 或后台脚本（CSP 的失败模式是**静默**的，必须用浏览器看 console）。
- 反向验证：删掉 `X-Content-Type-Options` 一行 → `admin-contract` 新增的具名断言红。

---

## 5. 阶段 3：`src/api.ts` 拆域（3–5 个提交）——**放最后**

### 为什么它最贵

`src/api.ts` 4,281 行，但 `routeApi`（2223 行起）**已经是分发器链**，14 个 `dispatch*` 已经把域分好了。真正的成本不在代码，在**测试工具的路径依赖**：

| 依赖形态 | 数量 | 位置 | 拆了会怎样 |
|---|---|---|---|
| 守卫按路径读 `src/api.ts` | **11 处** | `architecture.test.mjs:1996,2109,2228,2256,2323,2432,2501,2646,3208,3334,3634` | 文件不存在 → `readFileSync` 抛错 → 套件崩（**会红，但红得没信息**） |
| 注入器按锚点补丁 `api.ts` | **~18 个场景** | `_skeleton-inject.mjs`、`_media-inject.mjs`、`_locale-url-inject.mjs`、`_plugin-pages-inject.mjs` | `apply()` 会因「锚点出现 0 次」**抛错**（`_skeleton-inject.mjs:2104`）——好消息：**不会静默变绿**，坏消息：18 个场景要重新指路 |
| 租户裁决按 `api.ts:行号` 索引 | 3 条 + 全部 NEW 项 | `_tenant-query-audit.mjs` | 行号整体位移 → 全部打印 `NEW` → 需要逐条重新裁决 |

这个「不会静默变绿」是决定性的：它意味着拆分**安全但费工**。所以顺序必须是「先让守卫跟着代码走，再搬代码」。

### 3.1 先改守卫（1 个提交，行为零变化）

在 `architecture.test.mjs` 顶部加：

```js
const API_DIR = join(ROOT, "src", "api");
const apiSources = () => {
  const files = existsSync(API_DIR)
    ? readdirSync(API_DIR).filter(f => f.endsWith(".ts")).map(f => join(API_DIR, f))
    : [join(ROOT, "src", "api.ts")];
  const text = files.map(f => blankComments(read(f))).join("\n");
  // 非空性：搬完之后如果读到 0 个文件或过短，守卫必须红，而不是「没找到就跳过」
  if (files.length === 0 || text.length < 20000) throw new Error("apiSources() read nothing");
  return text;
};
```

然后把 11 处 `blankComments(read(join(ROOT, "src/api.ts")))` 换成 `apiSources()`。**此时 `src/api/` 还不存在，读到的仍是 `api.ts`，所有断言结果必须逐条不变**——这是这次提交唯一的验收标准（跑一遍，确认 253 条仍全绿，且断言数不变）。

`_tenant-query-audit.mjs` 的裁决键从 `api.ts:3177` 改为 `api.ts#<锚点子串>`（例如 `api.ts#UPDATE theme_installs`）。这需要一次性的重写，之后行号位移不再影响裁决。

### 3.2 抽 `core.ts`（1 个提交）

只搬**无业务依赖的叶子**：`ok` / `json` 响应构造、`requestSiteId`、`siteParamMalformed`、`requireSiteAccess`、`requirePermission` 包装、`currentUser` 的取用。

判据：搬完之后 `api.ts` 里不应再出现 `function ok(`、`function requestSiteId(`。

### 3.3 一次一个域（每个域 1 个提交）

顺序按「依赖少 → 依赖多」：

1. `media.ts`：`mediaList/Upload/Update/Delete/RowForWrite`（依赖 core + `platform/media-*`）
2. `settings.ts`：`settings/features/saveFeature/saveSetting/platformSettings*`
3. `extensions.ts`：`uploadExtension/pluginSettings/savePluginSetting/uninstallTheme`
4. `content.ts`：`listPosts/savePost/deletePost/handleBatchContent/writePostMeta/postMetaRows/translationGroup/freeSlug/groupOf/fieldExists/findActivePostType`（最大，最后）
5. `front.ts`：`readFrontParams/safeRedirect/frontAnswer/saveMemberPost/deleteMemberPost/routeFrontApi`

**每个域一个提交**，因为每个提交都要重跑 18 个注入锚点：哪个锚点找不到，`apply()` 会直接告诉你是哪一条、哪个文件。

### 3.4 收尾

- `src/api.ts` 删除，`src/index.ts` 改 `from "./api/index"`
- **不要**保留 `src/api.ts` 作为 re-export 桶。桶会让守卫读到空壳并**全绿**——这正是本项目 §12 反复记录的假绿形状。
- 更新 `AGENTS.md` 与 `ARCHITECTURE.md` 里所有写 `src/api.ts` 的路径（架构套件有一条守卫专门检查「文档里写的路径必须存在」，它会替你抓漏）。

### 验收

- 每个提交：`npm test` 全绿 + `_skeleton-inject` 18 个 api 场景全绿 + `_tenant-query-audit` 0 NEW。
- 全部完成后 `src/api/index.ts` ≤ 300 行，单文件最大 ≤ 900 行（`content.ts`）。
- 反向验证：抽完 `core.ts` 后，把 `requireSiteAccess` 里的 `siteId` 过滤注掉 → `multisite-isolation-matrix` 必须红。

### 风险

- **中高**，但可控。最大风险不是拆错，而是**拆到一半**——半拆状态下 18 个锚点分散在两个文件里，`apply()` 的「必须唯一」会频繁报错。所以每个域必须一次搬完，不留跨文件的部分函数。
- 回滚：每个域一个提交，`git revert` 单条即可；`api.ts` 在收尾提交前始终存在。

---

## 6. 明确不做的事

| 不做 | 理由 |
|---|---|
| 引入 React/Vue/Svelte | 会引入构建步骤，直接违反「后台是静态资产」的部署前提（维度 17） |
| 把 `public/admin` 一次性迁成 TS | 11.6k 行、30 个屏幕，收益与 `checkJs` 几乎相同，风险大一个量级。棘轮已经能拿到 90% 的保护 |
| 拆成多个 Worker | 多站点隔离已在存储层；拆进程只增加运维面与冷启动，不增加隔离 |
| 改 `PBKDF2_ITERATIONS` 默认值 | 25000 是免费计划 10ms CPU 的实测产物；只做可上调，不动默认 |
| 共享 esbuild bundle 缓存 | 30/35 套件各自 bundle，但单套件只有 1–4s，收益小；缓存失效会制造新的假绿，不划算 |
| 重写模板引擎以支持 CSP nonce | 独立项目，且会动「主题是数据」这条红线；当前 CSP 已能堵住外部脚本 |
| 给 `api.ts` 保留 re-export 桶 | 桶 = 守卫读到空壳还全绿，是本项目最贵的假绿形状 |

---

## 7. 执行顺序与提交切分

```
阶段 0  1 提交   基线校准（版本 + 徽章 + HANDOVER 数字）
阶段 1  5 提交   后台类型棘轮：骨架 → closest → 表单 → 手工 → 归零
阶段 2  3 提交   安全：响应头 → PBKDF2 可配 → 登录限流
阶段 3  7 提交   守卫改造 → core → media → settings → extensions → content → front → 收尾
```

共 **16 个提交**。每个提交都必须满足：

1. `npm test` 0 failures（数字只升不降）
2. `npx tsc --noEmit` 0 错误；阶段 1 之后再加 `tsc -p tsconfig.admin.json`
3. 新增具名断言 → 对应注入场景
4. 提交信息英文（仓库惯例）

阶段 1 与阶段 2 可并行；阶段 3 必须等阶段 0 的「数字可信」之后，因为它要用断言数变化来证明行为未变。

---

## 8. 收益预期（可验证，不是形容词）

| 指标 | 现在 | 完成后 |
|---|---|---|
| `public/admin` 静态检查覆盖 | 0 行 | 11,654 行 |
| 已知静态盲区 | 属性拼错、漏 import、参数形状错误全部运行时才炸 | 编译期 |
| 安全响应头 | 0 条 | 4 条 + CSP |
| 口令强度 | 固定 25000，不可调 | 可上调，旧密码不失效 |
| 登录限流 | per-isolate，可绕过 | 持久化，跨 isolate 生效 |
| `src/api.ts` | 4,281 行 | 7 个域文件，最大 ≤ 900 行 |
| 文档数字 | 4 处与实测不符 | 由脚本校验，漂移即红 |

---

## 9. 执行记录

### 2026-10-19 — 阶段 0 + 阶段 1 的前两步

| 提交 | 内容 | 结果 |
|---|---|---|
| `08fd9eb` | 本方案 | — |
| `c2bbf75` | 版本单一来源 + 套件数守卫 + 注入器修复 | 注入器 **140 场景 / 0 问题**；`npm test` 36 入口 / 0 失败 |
| `b73de71` | `checkJs` + 错误预算 + `closestEl` codemod | 后台类型错误 **334 → 243**；棘轮已接入 `typecheck` / `gate` |

**阶段 0 的实际发现（比方案里的数字更糟）：**

- 注入器**基线原本就是红的**：8 个 problem 里有 7 个是锚点过期（重构后没跟着改），
  1 个是 worker 在套件事件循环排空前被 `terminate()`，导致 `node:sqlite` 句柄没关，
  **下一个**场景的套件以 `database is locked` 崩溃。两者叠加后，"124 场景/0"这个文档数字
  与现状不符。修好后 140/0。
- 顺手修了 `parseVerdict` 的诊断缺失：abort 时只报 "no summary"，把套件真正说的话
  （`0 passed, 1 failed` + 异常栈）丢掉了。现在会打印尾部输出——否则下一次还会有人
  从"工具坏了"开始查。
- 给注入器加了 `--only=<substring>`：单场景验证从 3.5 分钟降到 ~20 秒；
  过滤没匹配到任何场景时**退出码 2**，不允许"0 场景 0 问题"被读成通过。

**阶段 1 的实测修正：**

- 基线不是 340 而是 **334**（`types/admin.d.ts` 声明 `Window.CFP_ADMIN_BASE` 消掉 6 条）。
- `closest` 是 **141 处**（此前按行计数得到 140）。
- helper 的返回类型必须是 `HTMLElement`：签成 `Element` 会修好 141 条、又冒出 49 条
  （`.dataset` / `.value` 在 `HTMLElement` 上）。净效果 334 → 243。
- `noImplicitAny` 单独打开会把基线推到 **1145**，所以 `strict:false` 是当前的正确选择，
  不是偷懒；它应该作为**第二条棘轮**，等第一条归零后再谈。
- 浏览器验收（`_ui-admin-functional.cjs`）在 HEAD 上就有 **2 条失败**
  （URL manager 空态文案、features provenance 文案）。用 `git stash` 对照确认与本次改动无关，
  不修，但记账。

**下一步（阶段 1 剩余）：**

1. 表单读取 96 处（`.value` / `.checked` on `Element`）——一个 `field(id)` helper + codemod。
2. 剩余 ~147 条手工，按文件：`editor.js` / `widgets.js` / `menu-config.js` 优先。
3. 归零后删掉预算文件，把 `check-admin-types` 改成"任何一条都红"，再评估 `noImplicitAny`。

### 2026-10-19（续）— 阶段 1.3：元素获取 codemod

| 提交 | 内容 | 结果 |
|---|---|---|
| `9fff318` | `fieldAt` / `elAt` / `evtTarget` / `evtField` + 24 个文件的获取点改写 | 类型错误 **243 → 122** |

**做法：改「取元素的地方」，不改「读值的地方」。** 113 条 `.value` 里绝大多数不是读法错了，
而是源头类型太宽（`querySelector` 返回 `Element`，`e.target` 是 `EventTarget`）。
在 24 个文件里改写 131 个获取点 + 12 个事件目标，下游的读法自动变对。

**两个必须记住的坑：**

1. **helper 名字本身也是 API。** 第一版叫 `el` / `field`，结果 `dashboard.js` 被改成
   `const el = el("#dash-theme")`（TDZ），`editor.js` 里 `const el = field("#blocks")` 也撞。
   改成 `elAt` / `fieldAt` 后归零。**新 helper 上线前先 grep 同名局部变量。**
2. **codemod 不能碰内联 HTML 属性。** `adinsert.js` 的
   `onclick="document.querySelector('#ai-save-btn')?.click()"` 被改成了 `elAt(...)`，
   而内联脚本访问不到模块作用域 → 点击时 `elAt is not defined`。
   `admin-spa` 的「inline markup 里用到的名字必须挂在 window 上」这条守卫**当场抓住了它**。
   这是该守卫第二次证明自己（第一次是 `attr` 漏 import）。

**剩下的 122 条**（下一轮）：`style`/`dataset` on `Element`（24 条）、`disabled`（16）、
`checked`（13）、`matches`（7）、`contentWindow`（已修 4）、以及约 40 条真类型问题
（`{ name, label, type, value }` 与 `{ options }` 的联合类型、`number` vs `string` 比较等）。

### 2026-10-19（续 2）— 按角色收窄 helper

| 提交 | 内容 | 结果 |
|---|---|---|
| `3130571` | `btnAt` / `closestBtn` / `closestField` / `allAt` / `fieldsAll` + 调用点细化 | 类型错误 **122 → 21** |

**原则：不放宽 helper，而是按角色分裂。** 把 `elAt` 改成返回 `HTMLInputElement` 能一次消掉 50 条，
但那样「任何元素都有 `disabled`/`value`」就成立了，真错会重新被藏起来。所以每个角色一个单行函数：

```
btnAt(sel)              -> HTMLButtonElement
closestBtn(e, sel)      -> HTMLButtonElement
closestField(e, sel)    -> HTMLInputElement
allAt(sel, root?)       -> HTMLElement[]
fieldsAll(sel, root?)   -> HTMLInputElement[]
```

两个集合 helper 带可选 `root`，`form.querySelectorAll(...)` 因此变成
`fieldsAll("[data-pp]", form)`，不必在调用点写 cast。

**教训：正则 codemod 会吃掉 `for (... of ...)` 的右括号。** 四条循环被改坏成
`for (const el of fieldsAll("x"){`，类型检查以 **TS1005** 全部报出来——所以「改完必须跑 tsc」
不是形式主义，它抓的是 codemod 的语法破坏，不是类型问题。

**剩下的 21 条不是 DOM 收窄问题**，是类型模型问题，需要逐条决策：
- `currentTab` 按设计是 `number | string`（settings 是特殊页签），声明缺联合类型；
- 小工具的字段规格是判别联合，调用点用对象字面量松散构造（7 条）；
- 媒体设置默认 `{}`，而读取方要求 `{ provider }`（2 条）。

下一轮应该先给这三处**定类型**，再改调用点——顺序反了会变成一堆 cast。

### 2026-10-19（续 3）— 归零，棘轮改为零容忍

| 提交 | 内容 | 结果 |
|---|---|---|
| `e04d309` | `DialogField` 类型 + `currentTab` 联合 + `attr/escapeHtml` 放宽入参 + 删预算 | 类型错误 **21 → 0** |

**最后 21 条不是 DOM 收窄，是类型模型缺失**——每个调用点各自发明了一套形状：

- `DialogField` 现在在 `types/admin.d.ts` 里定义，`openDialog` 的 JSDoc 用它。此前每个屏幕从
  自己写的第一个字面量推断数组元素类型，于是「往两行 text 的数组里 push 一行 select」报错，
  尽管 `openDialog` 两种都处理（9 条）。
- `currentTab` 按设计是 `number | "settings"`（设置页签不是第 17 块）。声明成联合后，
  唯一一处算术用 `Number(...)` 收窄。
- `escapeHtml` / `attr` 的入参本来就是 `String()` 化的，签成 `string` 比实现窄。

**其中一条是真缺陷，不是注解缺失**：`openDialog` 接受字段的 `disabled` 却从不渲染它，
所以小工具编辑器「创建后类型标识只读」这个意图从未生效。现在会输出该属性。
这是行为变更，但正是调用点一直想要的行为。

**这条行为现在有守卫了**（同日补）：`admin-spa` 新增一节，用 DOM 桩真正调用一次
`openDialog`，断言「标了 `disabled` 的字段渲染出 disabled 控件、没标的保持可编辑」，
并先断言对话框确实渲染了（非空性——否则两条正则都会因为「没有可匹配的东西」而通过）。
`_skeleton-inject` 对应场景把 `dis` 改成空串，确认那条具名断言会红（141 场景 / 0）。
为了让套件读得到渲染结果，桩的 `appendChild` 从 no-op 改成保留子节点。

**棘轮已切换为零容忍**：预算文件删除，`check-admin-types` 把「没有预算」读成**零**，
任何一条诊断都失败。重新 `--update` 生成预算是**有意的倒退**，不是默认的过检方式。

**阶段 1 完成后的基线**：`npm test` 36 入口 / 0 失败；`src/` tsc 0；后台 checkJs **0**；
注入器 **140 场景 / 0**；浏览器验收 39/2（两条既有文案问题，与重构无关）。

### 2026-10-19（续 4）— 阶段 2.1：安全响应头

| 提交 | 内容 | 结果 |
|---|---|---|
| `4f2ea91` | `withSecurityHeaders` + `fetch` 包装层 + 契约断言 + 两个注入场景 | 四条头覆盖全部响应；注入器 **143 场景 / 0** |

**位置比内容重要**：头加在 `fetch` 包装层，而不是每个路由各写一遍。判据是 404 也带头——
这条断言直接证明「包装层在路由之上，而不是某个分支里面」。

**刻意放宽的四处，每处都有理由**：
- `script-src 'unsafe-inline'`：后台 17 个内联 `onclick` + 四套主题的内联 `<script>`。
  去掉需要模板引擎支持 nonce，是独立项目；即便如此仍能挡住外部脚本加载。
- Google 广告主机：`adinsert` 插件自己的示例代码就让用户粘贴 `pagead2.googlesyndication.com`。
  挡住自家文档里的功能不是安全，是回归。
- `img-src https:`：主题引用 wikimedia，媒体库可指向 imgbb / postimages。
- `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`（**不是 none/DENY**）：
  小工具屏用同源 iframe 预览页面，`none` 会把它变白。

**两个「跑起来才发现」的问题**：
1. **包装层不能把正常响应变成 500。** 改头在运行时响应上会抛（headers 不可变），
   复制 body 在**已锁定**的 body 上会抛。现在是「能改就改 → 头不可变就复制 → 复制也失败就原样返回」。
   发现方式：注入「表单适配器返回 JSON 而不是 303」时，整个套件在 `new Response(res.body)` 处崩掉。
2. **HSTS 只在 TLS 上发**，否则是在断言传输层无法兑现的东西。

**顺带修掉 `admin-contract` 的两个残留缺陷**（新场景把它们暴露了，套件此前只能在一个库上跑一次）：
- `cnt2_p1` 与 `def_p0..2` 是固定 id 的裸 INSERT，段落和收尾 sweep 都不管；
  第二次运行直接 `UNIQUE constraint failed`。
- `admin.path` 在 15 节被移到 `/manage` 再移回。中途 abort（注入器**故意**这么做）就把它留在
  `/manage`，之后每次运行都在登录处 404，读起来像路由回归。启动 sweep 现在重置这一行。

**剩余（阶段 2.2 / 2.3）**：PBKDF2 迭代数可上调（哈希串已带迭代数，旧密码不受影响）；
登录限流从 per-isolate 内存改为持久化计数（需要迁移 0033，走完整 20 维清单）。

### 2026-10-19（续 5）— 阶段 2.2 + 2.3：口令强度与共享登录门

| 提交 | 内容 | 结果 |
|---|---|---|
| `6462994` | PBKDF2 可上调 + `login_attempts` 表（迁移 0033）+ 共享限流 | 注入器 **145 场景 / 0**；阶段 2 全部完成 |

**2.2 PBKDF2**：`passwordIterations(env)` 读 `CFP_PBKDF2_ITERATIONS`，**下限 25000**（免费计划的
实测预算），reader 和 writer 各自 clamp——坏值退化到安全设置，绝不退化到便宜设置。
旧密码不受影响：`verifyPassword` 本来就从存储串里读迭代数。
7 条断言钉住 reader 的每个分支 + writer 的 clamp +「调高后仍可验证」。
注入场景把下限改成 0，具名断言红。

**2.3 登录门**：限流原来在模块级 Map 里 = **per isolate**。攻击者把请求分到多个 isolate 就能放大上限，
而没有任何一个 isolate 看到异常速率——这就是它一直「看起来正常」的原因。
现在是 `login_attempts` 表（迁移 0033，platform-global：攻击不是租户事实，门必须跨 isolate 和跨站点共享）。
键不变（`ip|username`），窗口与锁定不变，内存 Map 删除。

**契约套件现在证明这张表存在的理由**：触发限流后，用一个**全新的 worker 实例**（构造上就是第二个
isolate）再打一次登录——旧实现下它会得到 401，这正是攻击形态。现在 429。
注入场景删掉短路检查 → 具名断言红。

**顺带记录**：本地迁移 0032 处于「已应用但未记录」状态（中断的 `wrangler dev` 会留下这种形状），
导致 `db:migrate:local` 拒绝执行；已补 `d1_migrations` 行。以后遇到 apply 报
`duplicate column` 先查这个。

**阶段 2 全部完成。基线**：`npm test` 36 入口 / 0 失败；注入器 145/0；`npm run gate` 全绿；
`src/` 与后台 tsc 均 0；浏览器验收 39/2（既有）。

**未做的（记录在案）**：登录成功后的**重哈希升级**（旧 25000 哈希在成功登录时重写为部署配置的强度）
——是一次额外的写，且需要想清楚多标签并发下的竞争，留作独立改动。

### 2026-10-19（续 6）— 阶段 3 完成

| 提交 | 内容 |
|---|---|
| `6d0816d` | 3.1 守卫先行：`apiSources()` + 审计锚点键 |
| `c071f1d` | 3.2 `core.ts`（53 行） |
| `774c8e8` | 3.3a `media.ts`（245 行）+ 四个注入器装上 `resolveApiFile` |
| `4238e76` | 3.3b `settings.ts`（217 行） |
| `03ce654` | 3.3c `extensions.ts`（201 行） |
| `e0cccf2` | 3.3d `content.ts`（817 行）+ `postMetaRows` 归位 + 70b 区分读写 |
| `aa8a6ab` | 3.3e `front.ts`（424 行）+ `index.ts` 直连导入 |
| `983354e` | 3.4 收尾：`src/api.ts` 删除，路由器在 `src/api/index.ts`，无桶 |

**验收与偏差（都记录在提交信息里）**：

- `src/api.ts` 不存在；`src/index.ts` 从 `./api/index` 导入；**无 re-export 桶**。
- `npm test` 36/36、注入器 145/9/10/4 全 0 问题、架构 258/0、租户审计 0 NEW、后台 checkJs 0。
- **未达成的验收项**：`api/index.ts` 是 2450 行而非 ≤300——十一个 `dispatch*AdminRoutes`
  的路由匹配体（约 2100 行）仍在一起。**但这不再是风险**：守卫经 `apiRelPaths()` 读
  `src/api/*.ts`、注入器经 `file: "api"` 解析锚点、审计按语句锚点键——后续把
  `dispatchSettingsAdminRoutes` 等搬进各自域文件是纯机械操作，不再需要动工具。

**拆分期间额外发现并修复的**：`_plugin-pages-inject` 的菜单清除场景锚点早随 toggle 重构失效
（该工具不在 npm test 链，静默跳过至今）；`postMetaRows` 归位到 `platform/post-meta.ts`，
70b 守卫区分「读」与「删」；规则 77b 的 front 路由体切片改为按模块定位。

### 2026-10-19（续 7）— dispatcher 拆薄（三批）

| 提交 | 内容 | index.ts |
|---|---|---|
| `d6d26a0` | media/settings/extensions 域收编各自的 dispatcher + `activateThemeForSite` + 新 `seed.ts` | 2450→1728 |
| `680301c` | content/taxonomy → content.ts，i18n → settings.ts | 1728→1213 |
| `4de2f10` | 新 `widgets.ts`（导航+小工具+菜单自定义+genericTable） | 1213→**648** |

工具沉淀：`moveFunction`（花括号匹配截取——**字符串字面量里有 `{}` 时不可靠**，seed 对改用
「下一个函数为界」）、auto-importer（读 tsc 的 TS2304 清单自动定位归属模块并生成导入）。

现在 `src/api/index.ts` 只剩路由骨架：`handleApi`/`routeApi` + auth/sites/dashboard/users 四个
管理域分发器。content.ts 1102 行是唯一超 900 的文件。沙箱曾拦截一次 `menus.ts` 读取导致
一轮注入中止——单跑该场景正常变红，判定为环境问题并记录。
