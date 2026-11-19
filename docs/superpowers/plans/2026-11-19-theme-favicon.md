# Theme and Favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 补齐全站深色模式并使用用户参考图 favicon，验收后直接上线。
**Architecture:** 沿用 React/Tailwind 变量，首屏主题初始化与运行时切换共用验证规则；静态图标使用版本化资源名。
**Tech Stack:** React 19, TypeScript, Tailwind 4, Vite, node:test, Playwright, Python Pillow。
**Spec:** docs/superpowers/specs/2026-11-19-theme-favicon-design.md

## Global Constraints
- 保留现有 App.tsx 未提交改动，不修改后端、数据库或凭据。
- 默认浅色；已有 radar_theme 的合法 light/dark 值继续有效。
- 仅前端 Pages 发布；Gemini 4hy 开发及独立审核，主助手验收。

## Review Focus
- localStorage 不可用/非法值必须回退浅色。
- 已存深色刷新不闪白；不覆盖其他 html class。
- 反向按钮的白字不可在浅色背景消失。
- 移动端切换按钮可访问、可点击，无横向溢出。
- favicon 不能继续命中旧 SVG 缓存。

### Task 1: 深色主题
**Files:** src/web/src/lib/theme.ts（新建）、tests/theme.test.ts（新建）、src/web/src/App.tsx、src/web/src/styles.css、src/web/index.html、必要的现有组件。
**Interfaces:** theme.ts 导出 Theme = 'light' | 'dark'，normalizeTheme(value: unknown): Theme；持久化键 radar_theme。初始化可使用无依赖静态脚本，但需测试与运行时规则一致。
- [x] 先写测试覆盖 light/dark、非法值、存储读写异常和不覆盖 html class。
- [x] 运行测试确认失败（父助手验证 prepaint/对比度3项失败后修正）。
- [x] 实现初始化、切换、全站深色变量及语义对比色，动态中文 aria-label/title。
- [x] 运行测试、类型检查和构建通过。

### Task 2: 图标
**Files:** src/web/public/radar-favicon-v2.png、src/web/public/radar-favicon-v2.ico、src/web/public/apple-touch-icon.png、src/web/index.html。
**Interfaces:** 参考附件为用户原图；PNG 32/192 与 ICO 16/32/48、apple 180，由实现者选择明确输出文件映射。
- [x] 验证旧图标引用，新增图标结构检查（生成前0/3失败）。
- [x] 用 Pillow 对用户图等比缩放，不裁去主体；生成图标。
- [x] 更新 icon 与 apple-touch-icon 引用，测试资源存在和尺寸（3/3通过）。

### Task 3: 审核与验收发布
- [x] Gemini 独立审核 Task 1/2：最终 spec/quality 均 PASS，无 Critical/Important。
- [x] 主助手运行 node --test tests/*.test.ts（153/153）与 node node_modules/typescript/bin/tsc --noEmit、Vite build；发布脚本另3/3。
- [x] Playwright 验证浅深、持久化、移动、详情和管理入口；保留私有截图。另捕获并修复深色遮罩反白，实测通过。
- [x] python3 scripts/deploy-instabox.py 发布既有站点，版本 ui-20261119T024617Z-c2b808。
- [x] 正式域名 HTML/JS/CSS/图标200，图标 SHA256 与本机一致；桌面和手机两种主题、刷新记忆、详情、管理入口复验通过，pageerror=0。未推送 Git。

## 实际实施与审核备注

- 原 Gemini 多文件工具链3次遇到上游 HTTP500 `MALFORMED_FUNCTION_CALL`；不是此前的「无可用账号」。后者本轮未复现，不能宣称服务端账号池已修复。
- 改用 Gemini 代码输出与独立审核、主助手执行修正和验收。主助手修正了中断留下的导入错误、存储 getter 防护、错误图片缩放写法及遮罩反白；未改 DSH 安装或账号配置。
- 三项非阻塞维护建议暂留：移动活动项计数徽标背景区分度较低（文字可读）；原有 Github 声明未清理；部分 CSS 格式变化。未为此扩展上线范围。
- 实施取舍：沿用现有架构和默认浅色；在 feat/theme-favicon 分支保留用户未提交首页改动，无额外 worktree；图标固定版本化命名；拆小 Gemini 任务并由主助手执行工具。若取舍需调整，可在该分支修改并重新验收发布；不涉及不可逆数据操作。
