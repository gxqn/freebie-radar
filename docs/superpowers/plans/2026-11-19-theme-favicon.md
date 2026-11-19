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
- [ ] 先写测试覆盖 light/dark、非法值、存储读写异常和不覆盖 html class。
- [ ] 运行测试确认失败。
- [ ] 实现初始化、切换、全站深色变量及语义对比色，动态中文 aria-label/title。
- [ ] 运行测试、类型检查和构建通过。

### Task 2: 图标
**Files:** src/web/public/radar-favicon-v2.png、src/web/public/radar-favicon-v2.ico、src/web/public/apple-touch-icon.png、src/web/index.html。
**Interfaces:** 参考附件为用户原图；PNG 32/192 与 ICO 16/32/48、apple 180，由实现者选择明确输出文件映射。
- [ ] 验证旧图标引用，新增图标结构检查。
- [ ] 用 Pillow 对用户图等比缩放，不裁去主体；生成图标。
- [ ] 更新 icon 与 apple-touch-icon 引用，测试资源存在和尺寸。

### Task 3: 审核与验收发布
- [ ] Gemini 独立审核 Task 1/2，问题先修复后复核。
- [ ] 主助手运行 node --test tests/*.test.ts 与 node node_modules/typescript/bin/tsc --noEmit、Vite build。
- [ ] Playwright 验证浅深、持久化、移动、详情和管理弹窗；保留必要截图但不提交凭据或截图缓存。
- [ ] python3 scripts/deploy-instabox.py 发布既有站点。
- [ ] 线上确认版本资源、favicon 200 和两种主题；记录实际验证结果。不得未经授权推送 Git。
