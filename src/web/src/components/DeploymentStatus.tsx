import { useEffect, useRef, useState } from "react";
import { acceptDeploymentStatus, createStatusPoller, remainingCooldown, statusView, type DeploymentStatus as Status } from "../lib/deployment-status.ts";
import type { ReadMetadata } from "../lib/fetch.ts";

function time(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "暂无记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

/** This component only observes platform metadata. Only the button POST may wake a VM. */
export function DeploymentStatus({ readMetadata }: { readMetadata: ReadMetadata | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusEpoch = useRef(0);
  const connectInFlight = useRef(false);
  const poller = useRef<ReturnType<typeof createStatusPoller> | null>(null);
  if (!poller.current) poller.current = createStatusPoller(async () => {
    const response = await fetch("/api/deployment/status");
    if (!response.ok) throw new Error(`状态查询失败（${response.status}）；公开快照仍可浏览`);
    return await response.json() as Status;
  });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (connectInFlight.current) return;
      const epoch = statusEpoch.current;
      try {
        const next = await poller.current!.poll(Date.now(), document.visibilityState === "visible");
        if (active && next && epoch === statusEpoch.current) { setStatus((previous) => acceptDeploymentStatus(previous, next)); setError(null); }
      } catch (cause) {
        if (active && epoch === statusEpoch.current) { setError(String(cause)); }
      }
    };
    // The one-second timer is local only; it never schedules a fetch.
    const clock = window.setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 1000);
    const timer = window.setInterval(() => void poll(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") { setNow(Date.now()); void poll(); } };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => { active = false; window.clearInterval(clock); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);

  const snapshotAt = readMetadata?.mode === "snapshot" ? readMetadata.snapshotAt : status?.snapshotAt;
  const readMode = readMetadata?.mode ?? status?.readMode ?? "snapshot";
  const view = statusView(status, now);
  const remaining = status?.state === "cooldown" ? remainingCooldown(status, now) : 0;
  const connect = async () => {
    // Never infer permission from an expired local countdown.
    if (!view.canConnect || connectInFlight.current) return;
    statusEpoch.current += 1;
    connectInFlight.current = true;
    setConnecting(true); setError(null);
    try {
      const response = await fetch("/api/deployment/connect", { method: "POST" });
      const result = await response.json().catch(() => null) as Status | null;
      if (result?.checkedAt && result?.state) setStatus(result);
      if (!response.ok) throw new Error(result?.reason ?? `实时连接失败（${response.status}），请稍后手动重试`);
      if (!result?.checkedAt) throw new Error("实时连接返回无效状态；未切换公开读取模式");
    } catch (cause) { setError(String(cause)); }
    finally { statusEpoch.current += 1; connectInFlight.current = false; setConnecting(false); setNow(Date.now()); }
  };

  return <section aria-label="部署与快照状态" className="border-b border-ink-200 bg-canvas px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="font-semibold text-ink-900" role="status">{connecting ? "正在连接实时服务（最多28秒）…" : view.title}</strong>
      {view.canConnect && <button type="button" disabled={connecting} onClick={() => void connect()} className="rounded-md border border-ink-300 bg-surface px-2.5 py-1 font-medium text-ink-800 disabled:opacity-50">连接实时服务</button>}
    </div>
    <p>{readMode === "live" ? "当前凭据请求使用实时服务；运行状态不代表采集内容已更新。公开访客仍读取最近公开快照（最近30天、最多1000条）。" : view.content}</p>
    <p>公开快照最后更新：<time dateTime={snapshotAt ?? undefined}>{time(snapshotAt)}</time> · 最近采集：{time(status?.lastCollectionAt)} · 预计下次采集：{time(status?.nextCollectionAt)}</p>
    {status?.state === "cooldown" && <p>平台冷却：{remaining > 0 ? `剩余 ${Math.floor(remaining / 60)}分${remaining % 60}秒` : "预计等待时间已到，等待平台状态确认"}；冷却期间不能连接，不承诺立即恢复。</p>}
    {status?.state === "waking" && <p>正在等待平台唤醒；请先浏览快照，不会自动重试连接。</p>}
    {status?.reason === "runtime_budget_guard" && <p>设备接近连续运行预算，将跳过采集，留出休眠时间；已有快照仍可浏览。</p>}
    {status?.reason === "platform_status_unavailable" && <p>暂时无法确认设备状态，不会自动唤醒或反复重试；请先浏览快照。</p>}
    {error && <p role="alert" className="text-alert">{error}</p>}
  </section>;
}
