# 一键发布与休眠友好快照设计

> **2026-11-18 17:37 用户调整（优先于下文旧发布细节）：** 一键发布仅用于修改 freebie-radar 页面/UI 后构建并发布 Cloudflare Pages、更新前端缓存；不做数据库/源码备份、不自动回滚、不每次重建远程后端。出问题由用户回滚代码后重新发布。首次快照/调度迁移由本次实施一次完成；只做必要测试验证，取消发布方案中重型备份流程。

用户已在会话接受本方案（2026-11-18）：保留零新增费用部署，每小时采集，冷却时先看最近公开快照，标注更新时间；实时管理操作等待设备恢复，不承诺平台30秒解除冷却。实现直接继续，不要求用户执行命令。

## 已批准的行为
- 项目根目录提供 macOS 可双击发布入口：检查/测试/构建、远程发布、健康失败回退、更新 Cloudflare 前端和调度、更新前端缓存；不清空数据库或唯一可用快照。
- 每小时整点采集（UTC cron `0 * * * *`），每批保持720秒容器内超时和互斥锁。普通公开浏览不请求 VM。
- Cloudflare KV 保存最近一次成功的公开快照，先写新版本再切换指针，失败保留旧版本；新前端版本缓存更新与数据快照缓存分离。
- 页面即时浏览最近快照，状态条区分 running/sleeping/waking/cooldown/offline/error/unknown；显示快照时间、冷却剩余时间、预计下一采集。
- 实时管理请求边缘上游截止25秒（浏览器28秒），不超过30秒无限等待。平台强制冷却必须遵守真实 cooldownUntil / Retry-After。
- 访客阅读、分页、搜索、基本分类/语言/价格/时间筛选和条目预览由公开快照提供。范围为最近1000条公开条目，超出范围明确提示快照容量限制。
- 收藏/已读等访客状态本地保存；账户/管理员/写入/个人RSS永不写入公共缓存。已携带管理凭据或用户会话的实时请求不伪装成匿名成功。

## 实现裁决
- 继续现有 Node24/Hono/SQLite、Python私有网关、Pages入口、独立Cron Worker，不购买新服务。
- 增加名为 FREEBIE_PUBLIC_SNAPSHOTS 的专属 KV 绑定，单文档≤2MiB，最多1000条/最近30天。按小时更新，控制免费写入额度；不是无持久性的 Cache API 替代品。
- Python网关批次结束后经固定 `SNAPSHOT_PUBLISH_URL` 推送公开快照；独立 SNAPSHOT_SECRET 鉴权，不向 VM 分发 Cloudflare 账号管理凭据。
- Snapshot schema1：`{schema:1,generatedAt,release,items:PublicItem[],sources:PublicSource[],bootstrap:PublicBootstrap,stats:PublicStats,digests:[],truncated:boolean}`。条目和来源显式白名单序列化；个人状态清零，source.config={}，user=null,isAdmin=false；不复制原始response或SQLite全行。
- Pages与Cron绑定同一 KV。`POST /internal/snapshot` 仅接受独立发布密钥；其他浏览器内部路由保持404。
- 网关 `GET /internal/snapshot` 仅给内部验证凭据返回新鲜匿名快照；`POST /internal/publish` 可为已认证运维触发快照刷新，不触发采集。
- `GET /api/deployment/status` 只读平台元数据，不唤醒VM；Cloudflare Cache API缓存60秒以避免频繁API读取，不逐次写KV。
- 状态接口：`{state,checkedAt,cooldownUntil,retryAfterSeconds,snapshotAt,lastCollectionAt,nextCollectionAt,release,readMode:'snapshot'|'live',snapshotAvailable,snapshotLimit:1000,reason?}`，不暴露机器ID、私有端口和密钥。
- 预算：在状态已知且 running 的 `runStartedAt` 持续≥75分钟，或剩余上限<45分钟，跳过新采集；处于冷却或人工offline跳过。空闲暂停允许正常按时请求私有端口自动唤醒。状态未知则不盲目唤醒。
- 浏览器显式“连接实时服务”才尝试唤醒；公开浏览与状态轮询不会唤醒。冷却时不提供无效唤醒按钮。状态显示来自平台，不能把所有409解释为冷却。
- 新部署默认全部收录，避免AI未配置时严格精选空白；保留真福利频道。

## 发布与凭据
- 新脚本不依赖旧 Desktop 项目，不硬编码当前一天有效的SSH Token；使用 Instabox exec/文件上传官方API，或使用API更新SSH连接凭据。
- 私有状态位于忽略的 .deploy-private 和现有 ~/.config/instabox；凭据不入Git，不打印。Cloudflare OAuth使用当前可刷新缓存，必要时脚本自动打开浏览器授权。
- 每次唯一 release/image tag；保留前一个镜像和 SQLite 在线备份。部署期间暂停网关接收新写入，确认容器采集锁空闲后再切换；失败恢复旧镜像、配置和数据库备份。不能仅把可变 latest 标签当作回退。
- 发布前端使用hash资源与 index no-store、release元信息；不删除唯一快照。更新后主动生成新快照，验证公开接口从KV读取而非偷偷回源。
- 不承诺跨前后端/DNS的全球原子切换；如Cloudflare发布失败，保留之前可访问入口、输出明确失败与恢复结果，不伪报全部成功。

## 验收
- 纯测试覆盖：公开数据不含密钥/用户状态，任意查询不回源、缓存缺失不唤醒、旧快照保留、坏publish拒绝；各设备状态与预算跳过；运行/唤醒/冷却不同提示；实时截止；发布回退与秘密输出脱敏。
- 原项目测试+构建、新模块测试、独立安全审查。
- 用新发布脚本进行一次真实发布，浏览器在阻断VM访问/模拟权威冷却时仍展示快照及提示，不通过制造平台强制冷却测试。
