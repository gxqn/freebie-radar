# Scheduled AI and Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hourly collection/rule-first TG with zero incidental AI, <=5 automatic model attempts/day, plus daily cleanup without backups.
**Architecture:** Preserve existing external hourly dispatch and gateway locking. New scheduled-cycle CLI invokes durable SQLite day/slot maintenance. AI network call reservation is atomic, batch size20 and no retry/dedup followups.
**Tech Stack:** Node24 native TypeScript/SQLite, Python stdlib, Workers, React/Vite.
**Spec:** docs/superpowers/specs/2026-11-19-scheduled-ai-maintenance-design.md

## Global Constraints
- Beijing08/11/14/18/22; <=1 HTTP attempt/slot, <=5/day; <=20items; errors consume slot, no retry; ordinary collect/push/ingest zero model calls.
- ENABLE_SCHEDULER=false; no new high-frequency cron; no backups of any data; no credential/source/channel replacement; no bulk historical push.
- Quiet hours and hourly24 cap preserved; deployment to existing production only; no Git push.

## Review Focus
- Duplicate/concurrent CLI jobs and restart cannot reuse AI slot (Task1 ledger tests).
- Failure/invalid model JSON/partial results cannot cause retry or dedup followup (Task1 fetch-count tests).
- Source/manual ingest/global and user push cannot sneak through another model entrypoint (Task1 mode guard tests).
- Midnight Beijing and cleanup favorites/reference rows (Task2 daily idempotence tests).
- Maintenance/AI failure must not reopen tight-loop wakeups or corrupt collection/job reporting (Task2 gateway tests).

### Task 1: AI boundary, durable budget and one-batch review
Files: create src/server/automation.ts, tests/automation.test.ts; modify enrich/ai.ts, enrich/ai-settings.ts, enrich/ai-dedup.ts, ai-admin.ts, routes.ts; adjust AI panel copy if needed.
Interfaces: scheduledAiSlot(now:Date): {day:string,hour:number,key:string}|null; automaticAiDuringCollection():boolean; runScheduledAi(now?:Date):Promise<status>. backfillAi(limit,mode,options?:{scheduled?:boolean;beforeRequest?:()=>boolean}) disables postprocessing and configures batch20/concurrency1/maxAttempts1 when scheduled.
- [ ] Write tests for exact Beijing slots/day keys and atomic reserve repeat/concurrency via SQLite, empty/disabled work and failed HTTP consuming slot.
- [ ] Run RED node --test tests/automation.test.ts.
- [ ] Implement scheduled mode gate in collection/AI dedup entrypoints, optional pre-request/maxAttempts hooks in reviewItems; bounded scheduled backfill with no post-review dedup or push.
- [ ] Add API automation status and clear schedule/manual explanation in AI panel.
- [ ] Run GREEN, typecheck and commit scoped files.

### Task 2: Daily cleanup, rule-first scheduled cycle and gateway
Files: automation.ts, cli.ts, push.ts, deploy/instabox/gateway.py, tests/automation.test.ts, tests/push.test.ts, deploy/instabox/test_gateway.py.
Interfaces: runDailyCleanup(now?:Date):CleanupResult reserves one Beijing day; runMaintenance(now?:Date) combines due cleanup and optional AI. CLI scheduled-cycle cleans, collects, flushes finite current-process batches respecting guards, runs scheduled AI; gateway collect executes scheduled-cycle under existing flock/timeout.
- [ ] Write failing tests for once/day/restart/auto=false/favorite preservation, explicit expiry/title rejection, and gateway's bounded scheduled-cycle command.
- [ ] Run RED focused Node/Python tests.
- [ ] Implement without modifying external cron or enabling original internal scheduler. Cleanup ledger errors reported; collection snapshot publishing stays truthful.
- [ ] Run full node --test tests/*.test.ts; node --test deploy/cloudflare/*.test.mjs; python3 -m unittest discover -s deploy/instabox -p 'test_*.py'; tsc --noEmit; Vite build. Commit scoped files.

### Task 3: Final review, deploy and evidence
Files: deployment docs, private temporary deploy/verification scripts (not committed).
- [ ] Independent broad review; fix blocking findings, verify again.
- [ ] Deploy only changed backend/gateway artifacts and AI_REVIEW_MODE=scheduled env, preserving .env.production secrets and DB; restart/recreate container with existing volumes and limits. Never create backup, copy DB or overwrite source config.
- [ ] Save rule-first preferences: instant_first/ignore_ai/pushAfterBackfill=false, kinds freebie/deal/opensource/news/info, obtainModes[], instant50/batch45, maxPerHour24; disable semantic dedup settings. No historical enqueue.
- [ ] Publish existing frontend if panel changed. Check live API automation mode/settings/ledger, due cleanup once, no unauthorized model call, no backup files; verify public site and document limits. Keep feature branch, no Git push.
