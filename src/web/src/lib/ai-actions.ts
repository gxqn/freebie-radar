export type BackfillResult = {
  reviewed: number; rejected: number; scanned: number; skippedBlocked?: number;
  mode?: "pending" | "recent" | "rejected"; error?: string;
};

export function aiReviewBlockedReason(settings: { enabled: boolean; ready: boolean }, active: boolean): string | null {
  if (!settings.enabled) return "请先开启下方的「AI 语义审核」总开关；仅保存端点、模型和 Key 不会启用审核。";
  if (!settings.ready) return "请先保存有效的 AI 端点与模型配置。";
  if (active) return "审核任务正在执行，请查看实时审核台，勿重复提交。";
  return null;
}

export async function readBackfillResult(response: Response): Promise<BackfillResult> {
  if (!response.ok) {
    if (response.status >= 500) throw new Error(`实时连接未完成（HTTP ${response.status}）；任务可能仍在后台执行，请查看实时审核台，勿重复提交。`);
    throw new Error(`审核请求被拒绝（HTTP ${response.status}），请检查管理会话与设备状态。`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("审核结果格式无效，请查看实时审核台。");
  const row = data as Record<string, unknown>;
  if (typeof row.error === "string" && !row.reviewed) throw new Error(row.error);
  if (![row.reviewed, row.rejected, row.scanned].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new Error("审核结果格式无效，请查看实时审核台。");
  return data as BackfillResult;
}
