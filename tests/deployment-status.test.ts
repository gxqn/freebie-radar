import assert from "node:assert/strict";
import { test } from "node:test";
import { statusView, remainingCooldown, createStatusPoller, retainReloadData, defaultFeedPreset, createForegroundTaskPoller, acceptDeploymentStatus } from "../src/web/src/lib/deployment-status.ts";
import { boundedFetch, readPublicJson } from "../src/web/src/lib/fetch.ts";
import { installAuthFetch, getToken, setToken } from "../src/web/src/lib/auth.ts";

const now = Date.parse("2026-11-18T09:00:00Z");
const status = (state = "sleeping") => ({ state, checkedAt: new Date(now).toISOString(), cooldownUntil: null, retryAfterSeconds: 0, snapshotAt: "2026-11-18T08:00:00Z", lastCollectionAt: null, nextCollectionAt: "2026-11-18T10:00:00Z", release: "r1", readMode: "snapshot", snapshotAvailable: true, snapshotLimit: 1000 } as any);

test("status distinguishes platform states without claiming a running VM means fresh content", () => {
  for (const [state, word] of [["running", "运行"], ["sleeping", "休眠"], ["waking", "唤醒"], ["cooldown", "冷却"], ["offline", "离线"], ["error", "服务异常"], ["unknown", "未知"]] as const) {
    const view = statusView(status(state), now);
    assert.ok(view.title.includes(word), `${state}: ${view.title}`);
    assert.match(view.content, /最近.*公开快照/);
    assert.match(view.content, /1000/);
    assert.doesNotMatch(view.content, /最新数据/);
  }
  assert.equal(statusView(status("cooldown"), now).canConnect, false);
  assert.equal(statusView(status("waking"), now).canConnect, false);
  assert.equal(statusView(status("sleeping"), now).canConnect, true);
});

test("an older or equally cached status cannot overwrite a newer authoritative connect cooldown", () => {
  const cooldown = { ...status("cooldown"), checkedAt: "2026-11-18T09:01:00Z", cooldownUntil: "2026-11-18T09:10:00Z" };
  assert.equal(acceptDeploymentStatus(cooldown, status("sleeping")), cooldown);
  assert.equal(acceptDeploymentStatus(cooldown, { ...status("sleeping"), checkedAt: cooldown.checkedAt }), cooldown);
  const fresh = { ...status("running"), checkedAt: "2026-11-18T09:11:00Z" };
  assert.equal(acceptDeploymentStatus(cooldown, fresh), fresh);
});

test("countdown derives from authoritative timestamps locally, expires without enabling cooldown connect", () => {
  const cooling = { ...status("cooldown"), cooldownUntil: "2026-11-18T09:02:00Z", retryAfterSeconds: 999 };
  assert.equal(remainingCooldown(cooling, now + 30_000), 90);
  assert.equal(remainingCooldown(cooling, now + 130_000), 0);
  assert.equal(statusView(cooling, now + 130_000).canConnect, false);
  assert.equal(remainingCooldown({ ...status("cooldown"), retryAfterSeconds: 120 }, now + 30_000), 90);
});

test("stale, missing, and invalid status become unknown, not live or fresh", () => {
  for (const value of [null, { ...status(), checkedAt: "bad" }, status("surprise"), status()]) {
    const view = statusView(value, now + 180_000);
    assert.match(view.title, /未知/);
    assert.equal(view.canConnect, false);
  }
  assert.match(statusView({ ...status(), snapshotAvailable: false }, now).content, /暂无可用公开快照/);
});

test("visible status polling is rate limited even across repeated focus and in-flight requests", async () => {
  let calls = 0;
  const poller = createStatusPoller(async () => { calls++; return status(); });
  await poller.poll(now, false);
  assert.equal(calls, 0);
  await Promise.all([poller.poll(now, true), poller.poll(now, true)]);
  await poller.poll(now + 59_999, true);
  assert.equal(calls, 1);
  await poller.poll(now + 60_000, false);
  assert.equal(calls, 1);
  await poller.poll(now + 60_000, true);
  assert.equal(calls, 2);
});

test("admin task polling never reads while idle or hidden and never overlaps a slow request", async () => {
  let calls = 0;
  let finish: () => void = () => {};
  const poller = createForegroundTaskPoller(async () => { calls++; await new Promise<void>((resolve) => { finish = resolve; }); });
  void poller.poll(false, true);
  void poller.poll(true, false);
  assert.equal(calls, 0);
  void poller.poll(true, true);
  assert.equal(calls, 0, "foregrounding cannot resume a stale hidden task session");
  const fresh = createForegroundTaskPoller(async () => { calls++; await new Promise<void>((resolve) => { finish = resolve; }); });
  const pending = fresh.poll(true, true);
  void fresh.poll(true, true);
  assert.equal(calls, 1);
  finish(); await pending;
});

test("bounded same-origin fetch respects caller signals and does not constrain external requests", async () => {
  const seen: RequestInit[] = [];
  const transport = (async (_input, init) => {
    seen.push(init!);
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const fallback = setTimeout(() => reject(new Error("request exceeded deadline")), 100);
      if (signal?.aborted) { clearTimeout(fallback); reject(signal.reason); }
      else signal?.addEventListener("abort", () => { clearTimeout(fallback); reject(signal.reason); }, { once: true });
    });
  }) as typeof fetch;
  const wrapped = boundedFetch(transport, "https://radar.example/", 10);
  await assert.rejects(wrapped("/api/items"), { name: "TimeoutError" });
  const ac = new AbortController();
  const pending = wrapped(new Request("https://radar.example/api/items", { signal: ac.signal }));
  ac.abort(new DOMException("caller", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
  const external = new AbortController();
  const outside = wrapped("https://other.example/api/items", { signal: external.signal });
  assert.equal(seen.at(-1)!.signal, external.signal);
  external.abort();
  await assert.rejects(outside);
});

test("accepted public JSON bundles provenance with data; malformed reloads cannot advance retained snapshot time", async () => {
  const headers = { "X-Radar-Mode": "snapshot", "X-Radar-Snapshot-At": "2026-11-18T08:00:00Z" };
  const accepted = await readPublicJson(new Response('{"items":[1]}', { headers }));
  assert.deepEqual(accepted, { data: { items: [1] }, readMetadata: { mode: "snapshot", snapshotAt: "2026-11-18T08:00:00Z" } });
  await assert.rejects(readPublicJson(new Response("not json", { headers: { ...headers, "X-Radar-Snapshot-At": "2026-11-18T09:00:00Z" } })));
  assert.equal(retainReloadData(accepted, "guest:q1", "guest:q1")?.readMetadata?.snapshotAt, "2026-11-18T08:00:00Z");
  assert.equal(retainReloadData(accepted, "guest:q1", "account:q1"), null);
});

test("global auth wrapper bounds anonymous and admin calls without dropping credentials on 503", async () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => store.get(key), setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
  const calls: RequestInit[] = [];
  const mockWindow = { location: { href: "https://radar.example/", origin: "https://radar.example" }, fetch: (async (_input, init) => { calls.push(init!); return new Response("unavailable", { status: 503 }); }) as typeof fetch, dispatchEvent: () => true };
  Object.assign(globalThis, { window: mockWindow });
  installAuthFetch();
  await mockWindow.fetch("/api/items");
  assert.ok(calls.at(-1)?.signal instanceof AbortSignal);
  setToken("secret");
  await mockWindow.fetch("/api/admin/items");
  assert.equal(new Headers(calls.at(-1)?.headers).get("authorization"), "Bearer secret");
  assert.ok(calls.at(-1)?.signal instanceof AbortSignal);
  assert.equal(getToken(), "secret");
  await mockWindow.fetch("https://other.example/api/items");
  assert.equal(new Headers(calls.at(-1)?.headers).has("authorization"), false);
  assert.equal(calls.at(-1)?.signal, undefined);
});

test("reload failure retains same-query content but never content from another identity/query", () => {
  const items = { items: [{ id: 1 }] };
  assert.equal(retainReloadData(items, "guest:q1", "guest:q1"), items);
  assert.equal(retainReloadData(items, "guest:q1", "account:q1"), null);
  assert.equal(retainReloadData(items, "guest:q1", "guest:q2"), null);
  assert.equal(defaultFeedPreset(), "all");
});
