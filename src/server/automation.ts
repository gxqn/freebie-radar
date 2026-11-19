import { get } from './db.ts';
import { scheduledAiMode, scheduledAiSlot } from './automation-policy.ts';
import { aiReady, getAiSettings } from './enrich/ai-settings.ts';
import { backfillAi } from './ai-admin.ts';

export async function runScheduledAi() {
  if (!scheduledAiMode()) return { skipped: true, reason: 'realtime_mode' };
  const slot = scheduledAiSlot();
  if (!slot) return { skipped: true, reason: 'outside_ai_slot' };
  if (!aiReady(getAiSettings())) return { skipped: true, reason: 'ai_disabled' };
  if (get('SELECT key FROM settings WHERE key=?', slot.key)) return { skipped: true, reason: 'slot_consumed' };
  // The actual atomic permit is acquired at the HTTP transport, never at job enqueue time.
  return { skipped: false, ...await backfillAi(20, 'pending', { scheduled: true }) };
}
