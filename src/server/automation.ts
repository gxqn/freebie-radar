import { get, run, txImmediate } from './db.ts';
import { getRetention, runCleanup } from './retention.ts';
import { beijingDay, scheduledAiMode, scheduledAiSlot } from './automation-policy.ts';
import { aiReady, getAiSettings } from './enrich/ai-settings.ts';
import { backfillAi } from './ai-admin.ts';

export function runDailyCleanup(now = new Date()) {
  const cfg = getRetention();
  if (!cfg.auto) return { skipped: true, reason: 'cleanup_disabled' };
  const key = `automation:cleanup:${beijingDay(now)}`;
  return txImmediate(() => {
    const claimed = run('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)', key,
      JSON.stringify({ status: 'running', at: now.toISOString() }), now.toISOString());
    if (!Number(claimed.changes)) return { skipped: true, reason: 'cleanup_already_done' };
    const report = runCleanup(cfg);
    run('UPDATE settings SET value=?,updated_at=? WHERE key=?',
      JSON.stringify({ status: 'succeeded', ...report }), now.toISOString(), key);
    return { skipped: false, ...report };
  });
}

export async function runScheduledAi() {
  if (!scheduledAiMode()) return { skipped: true, reason: 'realtime_mode' };
  const slot = scheduledAiSlot();
  if (!slot) return { skipped: true, reason: 'outside_ai_slot' };
  if (!aiReady(getAiSettings())) return { skipped: true, reason: 'ai_disabled' };
  if (get('SELECT key FROM settings WHERE key=?', slot.key)) return { skipped: true, reason: 'slot_consumed' };
  // The actual atomic permit is acquired at the HTTP transport, never at job enqueue time.
  return { skipped: false, ...await backfillAi(20, 'pending', { scheduled: true }) };
}
