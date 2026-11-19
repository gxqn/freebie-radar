import { all, run } from './db.ts';
import { AI_HOURS, AI_BATCH_LIMIT, beijingDay, scheduledAiMode, scheduledAiSlot } from './automation-policy.ts';

/** Atomic persistent reservation; failures and crashes never refund a transport attempt. */
export function claimAutomaticAiAttempt(count: number): string | null {
  if (!scheduledAiMode() || !Number.isInteger(count) || count < 1 || count > AI_BATCH_LIMIT) return null;
  const slot = scheduledAiSlot();
  if (!slot) return null;
  const now = new Date().toISOString();
  const result = run('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)',
    slot.key, JSON.stringify({ day: slot.day, hour: slot.hour, items: count, status: 'attempted', at: now }), now);
  if (!Number(result.changes)) return null;
  // busy_timeout may have waited across the hour/day boundary. Burn, but never dispatch a stale permit.
  if (scheduledAiSlot()?.key !== slot.key) {
    finishAutomaticAiAttempt(slot.key, 'expired_before_dispatch');
    return null;
  }
  return slot.key;
}
export function finishAutomaticAiAttempt(key: string, status: string): void {
  run("UPDATE settings SET value=json_set(value,'$.status',?,'$.finishedAt',?),updated_at=? WHERE key=?",
    status, new Date().toISOString(), new Date().toISOString(), key);
}
export function aiAutomationStatus() {
  const day = beijingDay();
  const attempts = all<{ key: string; value: string }>('SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key', `automation:ai:${day}:%`)
    .map(r => JSON.parse(r.value) as { hour: number; items: number; status: string; at: string });
  return { mode: scheduledAiMode() ? 'scheduled' : 'realtime', timezone: 'Asia/Shanghai', hours: AI_HOURS,
    maxRequestsPerDay: 5, maxItemsPerRequest: AI_BATCH_LIMIT, day, attempts, used: attempts.length,
    manualRequestsIncluded: false, collectionCallsAi: !scheduledAiMode(), pushCallsAi: !scheduledAiMode() };
}
