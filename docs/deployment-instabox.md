# Instabox / Cloudflare 部署与一键发布

更新：2026-11-19（Asia/Shanghai）。以下配置已实际上线，无需补执行部署命令；最新维护与AI节流规则见本文末节。

## 访问与发布

- 正式入口：https://zoomzero.pages.dev
- 默认「全部收录」。2026-11-18 19:00 已启用用户保存的 AI 配置（当前模型名 `deepseek-v4-flash`），4条连通示例正常；仅补审4条真实待审记录，保留2条、拦截2条。未启动整库补审。LINUX DO OAuth 仍未配置。站长 Telegram 推送已接入生产私有频道「AI信息、福利归集」。已核对 @ai_radar_info_bot 的频道发帖权限，通过生产 `POST /api/push/test` 成功发送一条测试消息。每小时采集完成后，符合即时推送规则的新条目可发送到频道。当前采集在独立进程运行，站长攒批队列只保存在该进程内存；2026-11-19起会在本轮采集退出前尝试清空，仍受免打扰和小时上限限制，跨采集周期的持久攒批未启用。
- AI 总开关未启用时，补审按钮现在明确提示原因；请求失败/超时不再伪装成功，提醒查看实时审核台且避免重复提交。Telegram 凭据与频道目标记在 [本机私有配置](../.deploy-private/telegram.json)，权限0600，不入Git。
- 管理 Token：[本机私有访问凭据](../.deploy-private/access.txt)，权限0600，不提交Git。
- **修改页面/UI后双击 [Deploy.command](../Deploy.command)**。脚本自动执行 TypeScript/Vite 构建、打包既有 Pages 入口并发布到 zoomzero 的 **develop 生产分支**。
- 脚本只发布前端和既有边缘入口：**不连接VM、不重建后端、不备份/恢复数据库、不自动回滚、不修改KV/Secret/调度配置**。出问题时按用户偏好回滚代码后再次双击发布。
- 更新页面版本标识；HTML/非哈希入口 `no-store`，哈希JS/CSS使用新文件名。刷新或重新打开页面会读取新版本；不清空收藏/已读本机偏好，不删除数据库或唯一可用快照。
- [发布实现](../scripts/deploy-instabox.py)、[构建/缓存规则](../scripts/deploy_release.py)。依赖本项目已安装的Node/TypeScript/Vite；Wrangler固定4.161.0，复用项目内可刷新OAuth，不依赖旧Desktop项目。

## 当前运行架构

- Instabox：原glenn-zoom，应用目录 `/data/workspace/freebie-radar`。
- Docker：Node24/SQLite，容器freebie-radar-radar-1，应用仅环回8788；384MiB/1CPU，restart unless-stopped；持久数据目录 `data`。
- Python私有网关8789由systemd管理；独立gateway secret和平台私有端口Bearer双重保护。应用Authorization经独立头恢复，不把平台token当管理员token。
- Pages独立提供静态界面与**匿名公开快照读取**。普通列表、搜索/分页、分类、来源、统计、条目预览和公开RSS不会访问VM。
- 新专属KV `freebie-radar-public-snapshots`，绑定 `FREEBIE_PUBLIC_SNAPSHOTS`；与此前已删除的旧项目KV无关。
- 快照范围：最近30天，最多1000条、单文档2MiB。按显式公开DTO白名单导出，个人已读/收藏清零，来源配置为空；不复制用户会话、后台设置、Cookie、原始数据库行或推送密钥。
- 先提交新文档、再更新版本指针，保留上一份快照；失败不删除唯一可用数据。KV跨地区更新可能有短暂传播延迟。
- 携带管理员Bearer或用户会话的请求、写操作和个人RSS走实时服务并 `private,no-store`，不进入公共缓存。公开访客偏好只存浏览器。
- 全部原云端旧项目清理结果不变；未触碰其他本地项目或购买付费服务。

相关代码：[边缘入口](../deploy/cloudflare/edge.mjs)、[快照查询](../deploy/cloudflare/snapshot.mjs)、[平台状态/预算](../deploy/cloudflare/platform.mjs)、[匿名导出器](../deploy/instabox/snapshot.py)、[私有网关](../deploy/instabox/gateway.py)、[systemd](../deploy/instabox/freebie-radar-gateway.service)、[Compose](../docker-compose.instabox.yml)。

## 每小时采集与休眠保护

- [外部调度Worker配置](../wrangler.toml)：UTC `0 * * * *`，即北京时间**每小时整点**，由原每天3次提高到最多每天24次；预算或平台限制时跳过，不承诺24次全部执行。
- 读取数据库启用状态动态采集；初始16个来源，网页启用/禁用对下一批生效。
- 调度首先只读管理API，不唤醒VM。冷却、人工offline、状态不明、已连续运行≥75分钟、或剩余预算<45分钟时，跳过新采集，不盲目重复唤醒。
- 在正常小时周期中，最长约12分钟任务＋固定30分钟空闲暂停，预留约18分钟余量；访客读快照不会重置VM空闲计时。
- 容器内flock互斥，720秒超时、10秒后强杀，宿主等待上限750秒。同小时槽幂等；失败不伪报成功。
- 成功采集结束后，由网关用**独立快照发布密钥**推送到Pages，自动更新KV。VM不保存Cloudflare账号管理凭据。
- 保持 `ENABLE_SCHEDULER=false`，未打开原频繁内部采集、自动日报或推送计时器。2026-11-19起，外部小时任务调用 `scheduled-cycle`，同时承载每日清理、本轮规则推送及可选的限额AI批审。
- 网关并发8，请求2MiB/响应4MiB，避免无限线程与无限响应。

## 设备状态和30秒边界

- [页面状态条](../src/web/src/components/DeploymentStatus.tsx)区分运行、休眠、唤醒、冷却、人工离线、异常和未知，并显示快照时间、最近采集及预计下次整点。
- 状态查询只读平台元数据，不触碰VM端口；可见页最多每60秒请求一次，边缘缓存60秒；倒计时在浏览器本地更新，不每秒请求设备。
- 只有主动点击「连接实时服务」才尝试实时健康连接；冷却期间禁用。普通浏览从KV直接读取，不先等待VM。
- 实时上游截止25秒，浏览器同源请求截止28秒；连接路径的状态查询和上游连接合计有界。超时说明原因并保留已有快照，不无限加载。
- **不保证平台30秒解除冷却，也不保证持续最新。** 平台空闲暂停固定30分钟；首次强制冷却5～20分钟，连续触发可能延长。管理活动、SSH或异常流量仍可能使VM到达最大连续运行时间。
- 缓存缺失或KV本身异常会显示明确不可用，不暗中唤醒VM，也不把空数据伪装为成功。

## 本次上线验收

- 简化发布脚本已真实执行成功，生产入口已更新；未备份数据库、未重建Docker后端。
- TypeScript原功能及状态测试140项；边缘18项；网关/导出10项；发布脚本3项，共171项通过；构建与打包通过。
- 首份快照260条；随后一批真实采集完成，网关自动推送新快照，浏览器列表总数310（合并后的展示数）。数字会随采集、去重和查询变化。
- Chromium生产页面请求200、`X-Radar-Mode: snapshot`、首屏100项，JavaScript pageerror为0。
- 浏览器只模拟权威冷却状态，验证倒计时提示与真实KV列表同时可见；**没有制造真实平台冷却或停止VM来做破坏性测试**。
- [真实页面截图](../.deploy-private/hybrid-live.png)、[冷却提示模拟截图](../.deploy-private/hybrid-cooldown-simulation.png)。

## 2026-11-19 前端主题与图标发布

- 正式版本 `ui-20261119T024617Z-c2b808` 已上线：https://zoomzero.pages.dev 。功能代码提交 `83e48e6`，本地分支 `feat/theme-favicon`，未推送远程 Git。
- favicon 改为用户提供的 AI 橙黑圆盘图，PNG 32/192、ICO 16/32/48、Apple 180；版本化浏览器图标路径，线上响应200且 SHA256 与本机一致。
- 浅/深色手动切换，默认浅色，`radar_theme` 保存偏好；已存深色在首屏前初始化。覆盖公共页、详情、弹窗和管理组件语义配色；未改后端或数据库。
- Gemini 4hy 参与开发与独立审核；多文件工具链被上游 `MALFORMED_FUNCTION_CALL` 中断后，由主助手修正并执行工具。此前的「无可用账号」本轮未复现，不能据此承诺上游已彻底修复。
- 测试153项、发布流程3项通过；类型检查、构建通过。主助手用 Chromium 在正式域名复验桌面/手机浅深切换、刷新记忆、详情、弹窗、管理入口及图标，页面错误0、无横向溢出。
- [实施记录与审核备注](superpowers/plans/2026-11-19-theme-favicon.md)、[正式站深色截图](../.deploy-private/theme-verification/desktop-dark.png)、[手机深色截图](../.deploy-private/theme-verification/mobile-dark.png)。

## 2026-11-19 定时清理、AI五时点与规则先推

- 已部署后端镜像 `freebie-radar:20261119-maintenance`（在既有运行镜像上覆盖代码，不重装依赖），私有网关改为执行 `scheduled-cycle`。前端 `ui-20261119T063132Z-105239` 已发布：[正式入口](https://zoomzero.pages.dev)、[本次部署](https://ae940d9f.zoomzero.pages.dev)。实现提交 `e037d3a`、`64e2665`、`fea40cb`，分支 `feat/scheduled-ai-maintenance`，未进行Git推送。
- Compose明确 `AI_REVIEW_MODE=scheduled`，仍为384MiB / 1CPU / 128PID、Node堆256MiB，原数据卷和凭据不变。没有备份/恢复、数据库复制、归档或备份表。现有公开快照继续作为网站匿名读服务缓存，不新增备份任务。
- **自动模型调用仅北京时间08:00、11:00、14:00、18:00、22:00各对应小时内可执行，每时段最多1个实际HTTP请求、每天最多5个、每次最多20条。** 失败、超时、无效返回也消耗时段，不重试、不跟随HTTP重定向；休眠/冷却错过的时段不在其它小时补打。每次仅选最近72小时、未过期、未屏蔽的待审内容，不回扫旧收藏与历史库。
- 持久预算记录在SQLite不可重复的日期/时段键，先占额再发请求；并行进程、容器重启、重复调度不会重获同一时段。普通采集、手动来源采集、入口入库及全局/个人推送不调用模型；自动语义去重关闭，即使误开旧设置，传输层也会拒绝自动调用。
- **手动测试、手动补审/重审、手动聚类去重属于额外调用，不计入自动5次。** AI面板已明确显示时点、今日用量和该例外；下方旧分波参数不改变定时任务硬上限。
- 推送改为规则优先：`instant_first` / `ignore_ai`，不等待AI、不在审后补推；即时50分、攒批45分，允许福利/好价/开源/新闻/资讯，不限获取方式。保留标题/链接本地去重、屏蔽词、72小时时效、显式截止时间/已结束标题过滤，每小时24条、单源即时5条、每批8条、23:30–08:00免打扰。采集进程结束前排空当前队列的可发部分；免扰或超额积压仍不保证跨进程保留，没有历史推送回放。
- 每个北京时间日期首个实际执行的小时任务做一次清理，尊重后台 `auto` 开关及原阈值：普通条目60天、AI保留180天、忽略条目14天、推送日志30天、精选90天。全局/个人收藏保护；删除与完成标记在同一事务，失败回滚，第二天再形成新日期任务。时段/清理实现：[调度入口](../src/server/automation.ts)、[传输预算](../src/server/ai-budget.ts)、[CLI](../src/server/cli.ts)、[保留策略](../src/server/retention.ts)。

### 实际验收与已知边界

- Node166项、边缘18项、Python网关/导出10项、发布流程3项，共197项通过；TypeScript/Vite通过。独立审核发现并复现“307重定向多请求”和“首批全被过滤导致后批漏推”，均新增回归并修正；复核17项通过，无剩余阻断项。
- 14:32首次真实维护：删除12条达到原保留期限的普通旧记录，851→839；重复执行显示 `cleanup_already_done`。该次14时时段20条AI请求在15秒超时，记作失败且用量1；之后多次运行均 `slot_consumed`，没有重试或重复计费请求。未宣称AI上游故障已修复。
- 14:36一次真实完整周期：17个已启用源、0失败、新增56条；即时推送20条、攒批4条，达到既有24条/小时限额；AI用量保持1→1。公开快照已按原通道更新（830条，数字随内容变化）。维护本身未历史补推，来源配置哈希前后一致。
- 正式管理API返回新模式/时点/阈值；匿名列表仍 `X-Radar-Mode:snapshot`。正式Chrome实际打开AI面板，时点和今日用量可见，页面错误0；[验收截图](../.deploy-private/maintenance-live.png)。原图标200且SHA一致。
- 部署脚本首次健康请求早于容器完成启动，连接被重置；随后容器健康检查成功、零重启、未OOM、网关active，独立HTTP健康200。紧邻两个Docker exec使用非阻塞flock时第二个曾遇到短暂锁竞争；验收改为最多5秒等待，两次成功，生产仍保留非阻塞并发保护，没有绕锁重试采集。
- 不承诺每天必有5次：平台冷却/预算保护、无候选、AI配置关闭时会少于5次；不为补次数额外唤醒。当前原内存队列仍不是持久投递队列。详见[设计](superpowers/specs/2026-11-19-scheduled-ai-maintenance-design.md)与[实施计划](superpowers/plans/2026-11-19-scheduled-ai-maintenance.md)。

官方规则：[自动暂停与最大运行时间](https://instabox.sh/docs/machines/auto-pause.md)、[私有端口与自动唤醒](https://instabox.sh/docs/access/ports.md)。
