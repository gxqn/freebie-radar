/** Pure policy: no DB/config imports, safe at every model-call boundary. */
export const AI_HOURS = [8, 11, 14, 18, 22] as const;
export const AI_BATCH_LIMIT = 20;
export type AiExecutionOrigin = 'automatic' | 'scheduled' | 'manual';
export function scheduledAiMode(): boolean {
  const mode = process.env.AI_REVIEW_MODE;
  return Boolean(mode && mode !== 'realtime');
}
export function automaticAiDuringCollection(): boolean { return !scheduledAiMode(); }
export function beijingDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function scheduledAiSlot(now = new Date()): { day: string; hour: number; key: string } | null {
  if (!Number.isFinite(now.getTime())) return null;
  const shifted = new Date(now.getTime() + 8 * 3600000);
  const hour = shifted.getUTCHours();
  if (!(AI_HOURS as readonly number[]).includes(hour)) return null;
  const day = beijingDay(now);
  return { day, hour, key: `automation:ai:${day}:${hour}` };
}
