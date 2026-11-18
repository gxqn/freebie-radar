# 一键发布与快照兜底实施计划

> **最终状态：已完成并上线。** 用户17:37收窄发布范围：只改UI构建/发布/缓存更新，取消所有备份、自动回退和每次远程容器重建。下文原Task3相应步骤已被轻量Pages发布替代，不执行旧重型流程。最终构建发布UI `ui-20261118T095846Z-127a80`；整点Cron、公开KV快照和状态提示均已上线；171项测试通过，真实浏览器首屏100项/合并总310项，pageerror=0；浏览器模拟冷却仍显示真实KV列表，无真实强制冷却测试。详见 [部署与验收记录](../../deployment-instabox.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans task-by-task.

**Goal:** 上线用户已接受的一键发布、小时采集和不依赖VM存活的公开浏览与设备状态提示。

**Architecture:** 保留现有后端与私有网关，增加只含公开DTO的KV快照；普通读取在边缘执行过滤与分页，真实管理请求有截止。网关任务结束推送新快照，Cron先检查只读平台状态再决定是否采集。

**Tech Stack:** Node24、Python3 stdlib、Cloudflare Pages/Workers/KV、React、Docker Compose。

**Spec:** [已批准设计](../specs/2026-11-18-hybrid-release-design.md)。

## Global Constraints
- 不新增付费服务；不绕过平台冷却；不承诺30秒内解除冷却。
- 公开文档≤2MiB/1000条/最近30天；匿名状态与配置显式白名单，个人/管理员数据不缓存。
- 整点每小时采集；720秒超时；run age≥75min或剩余预算<45min跳过；未知状态不盲目唤醒。
- 实时上游25秒、浏览器28秒截止；只读页面不自动唤醒VM。
- 密钥不入Git、不打印；新部署不依赖旧源码目录；回退保留上一版镜像和SQLite备份。

## Review Focus
1. 携带Cookie、Authorization或伪造内部头的请求，不得污染公共快照或绕过鉴权。
2. 缓存缺失、KV故障、格式损坏或过时快照不得触发普通浏览回源或显示虚假空成功。
3. 调度遇到cooldown/人工暂停/预算不足/未知状态时不得唤醒或持续重试。
4. 发布失败不能覆盖唯一旧快照、删数据或把新旧镜像指向同一标签；日志不能泄露凭据。
5. 浏览器隐藏页不轮询，冷却倒计时不产生VM流量；快照列表/搜索/分页在VM完全不可达时仍可用。

### Task 1: 公开快照及平台控制
**Files:** deploy/instabox/snapshot.py、deploy/instabox/gateway.py、deploy/cloudflare/snapshot.mjs、deploy/cloudflare/platform.mjs、deploy/cloudflare/edge.mjs、对应测试、wrangler.toml。
**Interfaces:** schema1见设计；`GET /internal/snapshot`、`POST /internal/publish`；边缘`/api/deployment/status`字段见设计。
- [ ] 写失败测试：显式白名单、source.cookie/admin/session字段清除、保留旧快照、搜索/分页无VM请求、各平台状态及预算。
- [ ] 实现匿名后端导出和批后独立密钥推送；保持任务失败与发布失败可区分，不依赖长时间Worker轮询。
- [ ] 实现公开DTO检验、版本化KV文档和原子指针切换、基础查询/分页/条目/来源/统计/bootstrap/auth/check等纯只读路由。
- [ ] 实现只读平台状态查询、60秒缓存和真实错误分类、25秒上游截止。
- [ ] 实现每小时Cron及75/45分钟预算闸门；写测试确认未知/冷却/离线都不唤醒。
- [ ] 运行Python和Node模块测试，确认先红后绿。

### Task 2: 浏览器状态与有界交互
**Files:** src/web/src/components/DeploymentStatus.tsx、src/web/src/lib/deployment-status.ts、App.tsx、lib/auth.ts或独立fetch包装、tests/deployment-status.test.ts。
**Consumes:** `/api/deployment/status` 固定字段；公开读取由边缘快照路由接管。
**Produces:** 顶部状态条、最近快照时间/范围/倒计时、显式实时连接按钮；不因读取状态唤醒。
- [ ] 写状态文案、倒计时、未知与过期状态、请求截止测试并看失败。
- [ ] 实现显示与只读状态60秒轮询（仅可见时），28秒fetch截止且尊重已有取消信号，不破坏原认证包装。
- [ ] 缓存错误保留已显示内容；管理员错误显示具体解释，不误清token；默认全部收录。
- [ ] 用构建和测试确认无外站凭据泄露、无后台高频请求。

### Task 3: 一键发布与回退
**Files:** Deploy.command、scripts/deploy-instabox.py、scripts/deploy_release.py(如拆分)、deploy/cloudflare/pages.wrangler.toml或构建生成配置、package.json/pnpm-lock.yaml（本地wrangler依赖）、发布测试与文档。
**Consumes:** 现有私有production.json追加SNAPSHOT_SECRET、INSTABOX_API_KEY/MACHINE_ID通过安全配置读取；KV binding FREEBIE_PUBLIC_SNAPSHOTS；独立snapshotpublishendpoint。
**Produces:** 双击全流程，唯一image release，健康失败回退和不泄密日志，--check/--dry-run帮助。
- [ ] 先写测试：archive不含私密/数据/依赖、合法release、部署失败回退顺序、path含空格、错误日志脱敏。
- [ ] 加入项目内固定wrangler依赖，不引用旧Desktop。
- [ ] 实现API/SSH可续期连接、锁/预算检查、源码暂存构建、数据库备份、停止写入、切换/健康/回退。
- [ ] 实现KV资源与Secrets绑定、Pages develop生产分支和Cron发布、index缓存更新、成功后快照seed；失败不删除旧资源。
- [ ] 原凭据可自动刷新时复用；必须人授权时自动开浏览器而不是要求终端操作。

### Task 4: 集成上线与验收
- [ ] 独立安全审查，修复重要问题并复测。
- [ ] 全测试与构建；新脚本--check并执行真实发布。
- [ ] 实测公开读接口无VM回源、状态不唤醒；浏览器读取KV快照、筛选与分页；模拟冷却显示正确倒计时。
- [ ] 核实云端每小时Cron、预算闸门、KV与Secret绑定、容器健康/回退证据，保存验收记录。
