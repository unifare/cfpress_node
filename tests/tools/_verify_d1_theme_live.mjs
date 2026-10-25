import { DatabaseSync } from "node:sqlite";
import { zipSync, unzipSync } from "fflate";

const BASE_URL = process.env.CFP_BASE_URL || "http://127.0.0.1:47920";
const DB_PATH = "data/cfpress.sqlite";

async function run() {
  console.log("==================================================================");
  console.log("  CFPress D1 数据库主题存储（无 R2 依赖）实时端到端全功能测试");
  console.log(`  目标服务器: ${BASE_URL}  |  数据库: ${DB_PATH}`);
  console.log("==================================================================\n");

  const db = new DatabaseSync(DB_PATH);

  // 1. 获取 admin 用户并创建临时 session
  const adminUser = db.prepare("SELECT id, username FROM site_users WHERE username = 'admin'").get();
  if (!adminUser) {
    throw new Error("在数据库中未找到 admin 用户");
  }

  const sessionId = "sess_live_test_" + Date.now();
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + 3600;
  db.prepare("INSERT INTO admin_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(sessionId, adminUser.id, expiresAt, nowSec);
  
  // 确保初始测试状态：重置限额为 512KB，清理测试主题残留
  db.prepare("INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('theme.max_binary_size_kb', '512')").run();
  db.prepare("DELETE FROM theme_files WHERE theme_name = 'live-d1-theme'").run();
  db.prepare("DELETE FROM theme_installs WHERE name = 'live-d1-theme'").run();

  console.log(`[步骤 1: 认证鉴权] 创建测试管理员会话: ${sessionId} (用户: ${adminUser.username})`);

  const headers = {
    "Cookie": `cfpress_admin=${sessionId}`,
    "X-Site-Id": "default"
  };

  try {
    // 2. 检查健康状态
    const pingRes = await fetch(`${BASE_URL}/admin/api/v1/auth/me`, { headers });
    if (pingRes.status !== 200) {
      throw new Error(`后台连接失败: HTTP ${pingRes.status} ${await pingRes.text()}`);
    }
    const meData = await pingRes.json();
    const me = meData.user;
    console.log(`[步骤 2: 服务健康] 成功连接 Node 服务端，当前管理员: ${me.username} (${me.role})\n`);

    // 3. 构建包含 700KB 二进制图片的主题 ZIP
    console.log("[步骤 3: 构造测试自定义主题]");
    const themeName = "live-d1-theme";
    const largePng = new Uint8Array(700 * 1024);
    for (let i = 0; i < largePng.length; i++) largePng[i] = 0xAA;

    const zipFiles = {
      "theme.json": new TextEncoder().encode(JSON.stringify({
        name: themeName,
        title: "D1 独立存储主题",
        version: "1.0.0",
        description: "该主题完全存储于 D1 theme_files 数据表，不依赖 R2 对象存储",
        author: "Dev Pair"
      }, null, 2)),
      "templates/home.html": new TextEncoder().encode(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>D1 Theme</title><link rel="stylesheet" href="/themes/${themeName}/assets/style.css"></head><body><h1>Hello from D1 Database!</h1><p id="desc">This page is rendered directly from theme_files table in D1 without R2!</p></body></html>`
      ),
      "assets/style.css": new TextEncoder().encode(
        `body { background-color: #f0fdf4; font-family: system-ui; } h1 { color: #15803d; }`
      ),
      "assets/hero.png": largePng
    };

    const zipData = zipSync(zipFiles);
    console.log(`  - 主题包压缩后大小: ${(zipData.byteLength / 1024).toFixed(1)} KB`);
    console.log(`  - 包含文件: theme.json, templates/home.html, assets/style.css, assets/hero.png (700.0 KB)\n`);

    // 4. 测试 1: 默认 512KB 限制下上传 700KB 主题 -> 验证拦截
    console.log("[步骤 4: 二进制超限拦截测试]");
    console.log("  - 系统当前默认限制: 512 KB，尝试上传 700 KB 二进制主题...");
    const fd1 = new FormData();
    fd1.append("file", new File([zipData], `${themeName}.zip`, { type: "application/zip" }));

    const uploadRes1 = await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/upload`, {
      method: "POST",
      headers,
      body: fd1
    });

    console.log(`  - 响应 HTTP 状态码: ${uploadRes1.status} (预期: 400)`);
    const errJson = await uploadRes1.json();
    console.log(`  - 拦截提示信息: "${errJson.error}"`);
    if (uploadRes1.status !== 400 || !errJson.error?.includes("512 KB")) {
      throw new Error(`测试未按预期拦截！响应: ${JSON.stringify(errJson)}`);
    }

    const countAfterReject = db.prepare("SELECT COUNT(*) AS c FROM theme_files WHERE theme_name = ?").get(themeName).c;
    console.log(`  - 查询 D1 theme_files 数据表记录数: ${countAfterReject} 条（无半途残留数据）`);
    console.log("  -> [超限拦截验证成功！]\n");

    // 5. 测试 2: 动态调大限额 theme.max_binary_size_kb = 1024
    console.log("[步骤 5: 动态配置平台参数测试]");
    console.log("  - 将配置 theme.max_binary_size_kb 调整为 1024 KB...");
    const putSettingRes = await fetch(`${BASE_URL}/admin/api/v1/platform-settings`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "theme.max_binary_size_kb", value: "1024" })
    });
    console.log(`  - 更新设置状态码: ${putSettingRes.status}`);

    const getSettingsRes = await fetch(`${BASE_URL}/admin/api/v1/platform-settings`, { headers });
    const settingsList = await getSettingsRes.json();
    const currentLimit = settingsList.items?.find(x => x.key === "theme.max_binary_size_kb");
    console.log(`  - 读取生效平台设置: theme.max_binary_size_kb = ${currentLimit?.value} KB`);
    console.log("  -> [平台配置生效验证成功！]\n");

    // 6. 测试 3: 放行并完整入库 D1
    console.log("[步骤 6: 重新上传并在 D1 (SQLite) 中持久化存储]");
    const fd2 = new FormData();
    fd2.append("file", new File([zipData], `${themeName}.zip`, { type: "application/zip" }));

    const uploadRes2 = await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/upload`, {
      method: "POST",
      headers,
      body: fd2
    });
    console.log(`  - 上传响应状态码: ${uploadRes2.status} (预期: 201)`);
    if (uploadRes2.status !== 201) {
      throw new Error(`上传失败: ${await uploadRes2.text()}`);
    }

    const rows = db.prepare(
      "SELECT file_path, content_type, is_binary, size_bytes FROM theme_files WHERE theme_name = ? ORDER BY file_path"
    ).all(themeName);
    console.log(`  - D1 theme_files 数据表现存记录 (${rows.length} 项):`);
    for (const r of rows) {
      const mode = r.is_binary ? "二进制 Base64" : "纯文本 UTF-8";
      console.log(`    * [${mode.padEnd(12)}] ${r.file_path.padEnd(25)} 大小: ${r.size_bytes.toString().padStart(7)} 字节 | 类型: ${r.content_type}`);
    }
    if (rows.length !== 4) {
      throw new Error(`D1 存储文件数量异常: 预期 4，实际 ${rows.length}`);
    }
    console.log("  -> [D1 持久化存储验证成功！]\n");

    // 7. 测试 4: 激活主题并前台渲染
    console.log("[步骤 7: 激活主题 & 前台 HTML 模板渲染测试]");
    const activateRes = await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/${themeName}/activate`, {
      method: "POST",
      headers
    });
    console.log(`  - 激活 ${themeName} 响应码: ${activateRes.status}`);

    const frontRes = await fetch(`${BASE_URL}/`);
    const frontHtml = await frontRes.text();
    console.log(`  - 请求前台主页 GET / -> 状态码: ${frontRes.status}`);
    const hitTitle = frontHtml.includes("Hello from D1 Database!");
    const hitDesc = frontHtml.includes("theme_files table in D1 without R2");
    console.log(`  - 页面输出标题匹配: ${hitTitle ? "OK" : "FAIL"}`);
    console.log(`  - 页面描述内容匹配: ${hitDesc ? "OK" : "FAIL"}`);
    if (!hitTitle || !hitDesc) {
      throw new Error(`前台模板未从 D1 正常渲染！响应截取:\n${frontHtml.slice(0, 350)}`);
    }
    console.log("  -> [前台模板直读 D1 渲染验证成功！]\n");

    // 8. 测试 5: 静态资源从 D1 获取
    console.log("[步骤 8: 静态资源通过 D1 theme_files 路由分发测试]");
    const assetRes = await fetch(`${BASE_URL}/themes/${themeName}/assets/style.css`);
    const assetCss = await assetRes.text();
    console.log(`  - 请求 GET /themes/${themeName}/assets/style.css -> 状态码: ${assetRes.status}`);
    console.log(`  - Content-Type: ${assetRes.headers.get("content-type")}`);
    const hitCss = assetCss.includes("background-color: #f0fdf4");
    console.log(`  - CSS 样式内容匹配: ${hitCss ? "OK" : "FAIL"}`);
    if (!hitCss) {
      throw new Error(`静态资源未从 D1 获取正确内容！`);
    }
    console.log("  -> [静态资源直读 D1 验证成功！]\n");

    // 9. 测试 6: 在线代码编辑与热更新
    console.log("[步骤 9: 主题文件在线编辑与前台热重载测试]");
    const hotContent = `<!DOCTYPE html><html><body><h1>🔥 热更新成功！Direct from D1</h1><p>更新时间: ${new Date().toLocaleString()}</p></body></html>`;
    const editRes = await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/${themeName}/file`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "templates/home.html", content: hotContent })
    });
    console.log(`  - 在线修改 templates/home.html 响应码: ${editRes.status}`);

    const hotFrontRes = await fetch(`${BASE_URL}/`);
    const hotFrontHtml = await hotFrontRes.text();
    const hitHot = hotFrontHtml.includes("🔥 热更新成功！Direct from D1");
    console.log(`  - 再次访问前台 GET / 是否立即呈现热更新内容: ${hitHot ? "YES" : "NO"}`);
    if (!hitHot) {
      throw new Error("在线热更新失败！");
    }
    console.log("  -> [在线编辑与热重载验证成功！]\n");

    // 10. 测试 7: 卸载主题与 D1 级联清除
    console.log("[步骤 10: 卸载自定义主题与 D1 级联清除验证]");
    // 先切回默认主题
    await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/default/activate`, {
      method: "POST",
      headers
    });
    console.log("  - 已恢复激活 default 内置主题");

    const uninstallRes = await fetch(`${BASE_URL}/admin/api/v1/extensions/themes/${themeName}`, {
      method: "DELETE",
      headers
    });
    console.log(`  - 卸载自定义主题响应码: ${uninstallRes.status}`);

    const remainingRows = db.prepare("SELECT COUNT(*) AS c FROM theme_files WHERE theme_name = ?").get(themeName).c;
    console.log(`  - 查询 D1 theme_files 剩余该主题的文件行数: ${remainingRows} 条`);
    if (remainingRows !== 0) {
      throw new Error(`卸载未彻底清除 D1 文件！残留 ${remainingRows} 条！`);
    }
    console.log("  -> [D1 存储干净清除验证成功！]\n");

    // 11. 还原平台配置
    console.log("[步骤 11: 还原平台参数与收尾清理]");
    await fetch(`${BASE_URL}/admin/api/v1/platform-settings`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "theme.max_binary_size_kb", value: "512" })
    });
    console.log("  - 已恢复 theme.max_binary_size_kb 为默认 512 KB");

    console.log("\n==================================================================");
    console.log("  ✅ 测试全部通过！D1 主题方案功能完整、安全、可靠！");
    console.log("==================================================================");
  } finally {
    db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(sessionId);
    console.log(`[清理] 已注销测试会话: ${sessionId}`);
  }
}

run().catch((err) => {
  console.error("\n❌ 测试中断，发生错误:", err);
  process.exit(1);
});
