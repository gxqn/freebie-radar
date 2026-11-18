# Instabox / Cloudflare 部署与一键发布

更新：2026-11-18（Asia/Shanghai）。以下配置已实际上线，无需补执行部署命令。

## 访问与发布

- 正式入口：https://zoomzero.pages.dev
- 默认「全部收录」。2026-11-18 19:00 已启用用户保存的 AI 配置（当前模型名 `deepseek-v4-flash`），4条连通示例正常；仅补审4条真实待审记录，保留2条、拦截2条。未启动整库补审。LINUX DO OAuth 仍未配置。站长 Telegram 推送已接入生产私有频道「AI信息、福利归集」。已核对 @ai_radar_info_bot 的频道发帖权限，通过生产 `POST /api/push/test` 成功发送一条测试消息。每小时采集完成后，符合即时推送规则的新条目可发送到频道。当前采集在独立进程运行，站长攒批队列只保存在该进程内存，跨采集周期的自动攒批未启用。
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
- 保持 `ENABLE_SCHEDULER=false`，未打开原频繁内部采集、自动日报、推送或定时清理。
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

官方规则：[自动暂停与最大运行时间](https://instabox.sh/docs/machines/auto-pause.md)、[私有端口与自动唤醒](https://instabox.sh/docs/access/ports.md)。
