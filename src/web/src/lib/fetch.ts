export type ReadMetadata = { mode: "snapshot" | "live"; snapshotAt: string | null };

/** Data and provenance travel together; callers commit both only after accepting the body. */
export async function readPublicJson<T>(response: Response): Promise<{ data: T; readMetadata: ReadMetadata | null }> {
  const data = await response.json() as T;
  const mode = response.headers.get("X-Radar-Mode");
  const at = response.headers.get("X-Radar-Snapshot-At");
  const readMetadata: ReadMetadata | null = mode === "snapshot" || mode === "live"
    ? { mode, snapshotAt: at && Number.isFinite(Date.parse(at)) ? at : null } : null;
  return { data, readMetadata };
}

/** Same-origin requests, including response-body reads, have an absolute deadline.
 * Request/init cancellation still wins immediately; external requests are untouched.
 */
export function boundedFetch(transport: typeof fetch, base: string, timeoutMs = 28_000): typeof fetch {
  return ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base);
    if (url.origin !== new URL(base).origin) return transport(input, init);
    const caller = init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : null;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
    return transport(input, { ...init, signal });
  }) as typeof fetch;
}
