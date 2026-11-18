# Instabox 看板迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 按用户已授权的直接接手方式，将 freebie-radar 部署至原 Instabox，保留 zoomzero.pages.dev，清除旧看板资源。

**Architecture:** Node 24/SQLite 后端在 Instabox Docker 运行；Cloudflare Pages 承载新静态前端及受控反向代理。平台私有端口 token 只保存在服务器端 Secret；应用管理员 Authorization 独立透传。禁用原有高频轮询，以外部有限批次触发采集，任务有界且允许自然空闲暂停。

**Tech Stack:** Docker Compose、Node 24、Cloudflare Pages/Workers、Instabox 官方 API。

**Spec:** 用户在本会话要求全权接手、旧看板完全清除、保留旧域名方案、不再执行终端指令、避免连续运行导致两小时冷却。

## Global Constraints
- 仅操作 glenn-zoom 及 ai-intel-dashboard/ai/ai-intel-zoomzero/zoomzero/旧专属 KV；不触碰 Ninja 或路由器。
- 不新增付费服务，不绕过平台冷却；无法保证持续访问情况下永不冷却。
- 未提供模型凭据时保持规则分类，不能虚称 AI 已配置。
- 新站上线前不删除旧服务；切换后清理旧服务、专属数据与旧云端部署。
- 平台 token、OAuth、应用密钥不提交 Git、不打印明文。

## Review Focus
- Authorization 同时用于平台与应用：私有网关必须分层，管理员鉴权不可被覆盖或自动提权。
- 冷却时响应应明确而非无限重试；静态页面不唤醒虚拟机。
- 原项目实际采集频率来自数据库 interval_sec，不是 COLLECT_CRON；必须禁用高频调度。
- 休眠不会让机内 cron 准时执行，需外部调度；采集互斥且有超时。
- 清理旧云端资源前核实归属，保留 Pages 项目以保留域名。

### Task 1: 核实与准备
- [x] 重新验证远程连接、Cloudflare 授权、实例状态与旧资源清单。
- [x] 停止误启动的本地采集服务，将 OAuth 缓存加入 Git 忽略。
- [x] 上传不含密钥的源码，在远端构建新容器。

### Task 2: 新后端与访问入口
- [x] 生成独立私有生产配置，限制内存/CPU并关闭内置高频调度。
- [x] 启动后端并验证 health、前端、管理接口 401 与带凭据成功。
- [x] 编写新 Cloudflare 入口代理与测试，私有网关分离平台和应用 Authorization。
- [x] 发布到 zoomzero Pages，验证同源前端与 API。

### Task 3: 有界调度与清理
- [x] 建立每日 08/14/20 三个北京时间采集槽、互斥锁、执行超时、有限唤醒与冷却退避。
- [x] 真实采集并检查数据库有条目、来源失败如实记录。
- [x] 停用并清除旧 ai-intel systemd、旧部署目录、8123 端口、旧 Worker、旧 KV 和备用 Pages；清除 zoomzero 的旧部署版本与绑定。

### Task 4: 验收
- [x] 全项目测试、构建、代理测试；真实公网读写权限验证。
- [x] 核实最终云端资源、远端容器健康、内存及调度配置。
- [x] 记录实际结果、访问地址、私有密码保存位置及无法当场验证的长期行为。
