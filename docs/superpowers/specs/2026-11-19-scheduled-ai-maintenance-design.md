# Scheduled AI, rule-first push and daily maintenance

## Intent and authorization
User explicitly approved “按推荐方案直接改”: reduce model usage without waiting for AI before Telegram delivery; add daily retention cleanup; never create any backups. Parent implements in this session, independent final review, then deploy to the existing Instabox/Cloudflare application. No Git push authorized.

## Chosen approach
Keep hourly Cloudflare -> private gateway -> serialized CLI collection. Change that CLI job to a scheduled cycle: daily cleanup if due, ordinary collection/rule-first push, flush this cycle's batch within quiet-hour/hourly guards, then optional scheduled AI enrichment. Keep ENABLE_SCHEDULER=false. Do not start a second daemon or additional cron heartbeat.
Alternatives: AI-before-push delays time-sensitive posts; merely running AI at five hours still permits unbounded per-source batches/retries/dedup calls; both rejected by approved cost/timeliness requirements.

## AI contract
- Production AI_REVIEW_MODE=scheduled. Ordinary collectors (including ingest), user/global push and automatic semantic dedup never call a model in this mode. Manual explicit admin connection tests/reviews remain manual operations and are documented separately.
- Beijing slots 08:00, 11:00, 14:00, 18:00, 22:00, timezone fixed Asia/Shanghai. A job may run within its matching hour, not catch up missed AI slots outside those hours.
- Each scheduled slot: at most one actual model HTTP attempt, including errors/timeouts/invalid output; no retries. At most20 recent pending eligible items (last72hours, not already expired) in one request, max420-character excerpt each. Max5 automatic attempts per Beijing day.
- A unique SQLite settings ledger key per Beijing day/slot is atomically reserved immediately before the outbound call. Repeated/concurrent CLI processes or restarts cannot reclaim a consumed slot. Empty/disabled work consumes no request.
- No semantic dedup call or push/re-push after this scheduled review. Other pending items wait for later slots; do not immediately launch the existing historical backlog on deployment.

## Push and cleanup
- Rule-first Telegram, no AI requirement or semantic calls. Include freebie/deal/opensource/news/info; exclude noise. Obtain-mode restriction removed. Propose instant50/batch45; retain blocklists, age<=72h, title/URL dedup and reject explicit expired timestamps and titles marked 已无/已结束/已失效/已过期.
- Keep hourly cap24, per-source instant cap5 and batch cap8; flush current-process batches before CLI exits, respecting quiet23:30–08:00. Do not promise durable cross-cycle batching or replay existing history in this change. Slots missed through Instabox cooldown are skipped, not retried in a loop.
- Daily cleanup once per Beijing date at first successful scheduled job, honoring existing retention auto switch and stored day thresholds; preserve global/user-starred entries. Persistent ledger survives restart. No archive/export/database copy or backup step.
- Expose automation status/settings and durable recent ledger in existing AI/admin API so scheduled behavior is visible; UI wording must not imply every new item is automatically reviewed.

## Boundaries and tradeoffs
Use existing React/Node24/SQLite/Python/Worker stack; no dependencies or paid services. New feature branch in current checkout (no extra worktree, user delegated choices and requested direct execution). Retention deletes are authorized, backups explicitly prohibited. Preserve user-edited source config, AI credentials, channel target, theme/favicon and platform safeguards. Broader Cloudflare quota/asset routing work, new source adapters, backups and durable outbox are out of scope.

## Acceptance
Mocks count actual HTTP attempts:0 outside slots/ordinary collection+push;<=1 per slot across success/failure/restart/concurrency;<=5/day;20 max items; no dedup follow-up. Daily cleanup idempotent and protects favorites. Gateway still authenticates, validates slots, serializes, times out; source config untouched. Full Node/edge/Python tests, tsc/build, independent review. Deploy without backup; verify production mode, rules, gate ledger and a controlled due/no-work or outside-slot maintenance execution without replaying history.
