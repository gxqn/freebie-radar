export type DeploymentStatus = {
  state: "running" | "sleeping" | "waking" | "cooldown" | "offline" | "error" | "unknown";
  checkedAt: string;
  cooldownUntil: string | null;
  retryAfterSeconds: number;
  snapshotAt: string | null;
  lastCollectionAt: string | null;
  nextCollectionAt: string;
  release: string;
  readMode: "snapshot" | "live";
  snapshotAvailable: boolean;
  snapshotLimit: 1000;
  reason?: string;
};
const TITLES: Record<DeploymentStatus["state"], string> = {
  running: "实时服务运行中", sleeping: "实时服务休眠中", waking: "实时服务唤醒中",
  cooldown: "平台冷却中", offline: "实时服务离线", error: "实时服务异常", unknown: "实时服务状态未知",
};

export function statusView(status: DeploymentStatus | null, now: number) {
  const checked = Date.parse(status?.checkedAt ?? "");
  const fresh = Number.isFinite(checked) && now - checked <= 120_000 && checked <= now + 60_000;
  const state = status && fresh && Object.hasOwn(TITLES, status.state) ? status.state : "unknown";
  return {
    title: TITLES[state],
    content: status?.snapshotAvailable === false
      ? "暂无可用公开快照；公开浏览不会自动唤醒服务。"
      : "公开内容来自最近一次成功的公开快照（最近30天、最多1000条）；服务运行不代表内容已更新。",
    canConnect: state === "sleeping" || state === "running" || state === "error",
  };
}

export function remainingCooldown(status: DeploymentStatus, now: number): number {
  const until = status.cooldownUntil ? Date.parse(status.cooldownUntil) : NaN;
  const fallback = Date.parse(status.checkedAt) + Math.max(0, status.retryAfterSeconds || 0) * 1000;
  const deadline = Number.isFinite(until) ? until : fallback;
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

/** A controller survives React StrictMode effect replay and repeated visibility events. */
export function createStatusPoller(load: () => Promise<DeploymentStatus>) {
  let lastAttempt = -Infinity;
  let inFlight: Promise<DeploymentStatus> | null = null;
  return {
    async poll(now: number, visible: boolean): Promise<DeploymentStatus | null> {
      if (!visible) return null;
      if (inFlight) return inFlight;
      if (now - lastAttempt < 60_000) return null;
      lastAttempt = now;
      inFlight = load();
      try { return await inFlight; }
      finally { inFlight = null; }
    },
  };
}

export function retainReloadData<T>(data: T | null, loadedKey: string, key: string): T | null {
  return loadedKey === key ? data : null;
}
export function defaultFeedPreset() { return "all"; }

export function acceptDeploymentStatus(previous: DeploymentStatus | null, next: DeploymentStatus): DeploymentStatus {
  const incoming = Date.parse(next.checkedAt);
  const current = Date.parse(previous?.checkedAt ?? "");
  if (!Number.isFinite(incoming)) return previous ?? { ...next, state: "unknown" };
  return previous && Number.isFinite(current) && incoming <= current ? previous : next;
}

export function createForegroundTaskPoller(task: () => Promise<void>) {
  let inFlight = false;
  let stopped = false;
  return {
    async poll(active: boolean, visible: boolean): Promise<void> {
      // Hiding ends this observation session; stale task flags never authorize a wake.
      if (!visible) stopped = true;
      if (!active || stopped || inFlight) return;
      inFlight = true;
      try { await task(); }
      finally { inFlight = false; }
    },
  };
}
