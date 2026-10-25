# CFPress 扩展自检反面教材 (Extension Anti-patterns & Bad Examples)

本目录包含专为 CFPress 扩展自检引擎 (Extension Doctor) 打造的反面教材示例，集中展示了开发者在制作主题或插件时常犯的典型错误与合规性违规。

---

## 1. 反面教材示例主题：`bad-theme` / `bad-theme.zip`

### 包含的典型错误 (Anti-patterns):
1. **Rule 11 命名空间越界 (CHK_MENU_LABEL_KEY_NAMESPACE)**
   - `adminMenus[].label_key` 写成 `"global.invalid.namespace.key"`。
   - **合规标准**：主题的自定义菜单 label_key 必须以 `theme.<theme_name>.<key>` 开头。
2. **Rule 41 多语言数据表违规 (CHK_TABLE_PROSE_NOT_TRANSLATABLE)**
   - 表 `theme_bad_books` 的散文字段 `title` (text) 和 `summary` (longtext) 没有放入 `translatable` 列表。
   - **合规标准**：所有面向用户阅读的散文文本必须具备多语言翻译能力，必须声明在 `tables[].translatable` 中。
3. **语言中性字段误入翻译 (CHK_TABLE_NEUTRAL_TRANSLATABLE)**
   - 将数值类型字段 `price` (number) 错误地塞进了 `translatable` 列表。
   - **合规标准**：数字、布尔、日期等语言中性字段严禁声明为可翻译字段。
4. **未识别的管理屏警告 (CHK_MENU_UNSUPPORTED_SCREEN)**
   - 试图挂载到不存在的屏幕 `theme-page:bad-view`。

### 测试方法:
```bash
# 本地终端体检
npm run doctor:ext -- examples/bad-theme

# 检测 ZIP 安装包
npm run doctor:ext -- examples/bad-theme.zip
```

---

## 2. 反面教材示例插件：`bad-plugin` / `bad-plugin.zip`

### 包含的典型错误 (Anti-patterns):
1. **Rule 11 命名空间隔离错误 (CHK_MENU_LABEL_KEY_NAMESPACE)**
   - 插件菜单 label_key 未以 `plugin.bad-plugin.<key>` 命名空间前缀命名。
2. **非法表名侵犯 (CHK_TABLE_NAME_INVALID)**
   - 声明了含特殊字符的非法表名 `invalid-table-name!`。
3. **未识别的管理屏警告 (CHK_MENU_UNSUPPORTED_SCREEN)**
   - 挂载未知屏 `invalid-screen:xyz`。

### 测试方法:
```bash
# 本地终端体检
npm run doctor:ext -- examples/bad-plugin

# 检测 ZIP 安装包
npm run doctor:ext -- examples/bad-plugin.zip
```

---

## 3. 在后台管理端实测上传拦截

您也可以直接登录管理后台：
- 前往 **系统 → 外观 → 主题**，点击右上角 **【安装主题 ZIP】**，选择 `examples/bad-theme.zip` 上传；
- 或前往 **系统 → 插件**，点击右上角 **【安装插件 ZIP】**，选择 `examples/bad-plugin.zip` 上传；

系统会立即阻断非法安装，并弹出模态框展示结构化诊断错误明细与修复指引。
