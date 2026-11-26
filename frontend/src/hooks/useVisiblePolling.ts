import { useEffect, useRef } from "react";

/**
 * A poll that respects the tab (perf audit 2026-11, item 11). The navigation
 * bar's inbox counters made eight requests every 30 s in every open tab,
 * hidden ones included: about 23k requests a day per forgotten tab, each with
 * its auth check and settings read. This poll
 *   - does not run while `document.visibilityState` is "hidden",
 *   - runs at once when the tab becomes visible again,
 *   - doubles its interval after a failed round (up to `maxIntervalMs`) and
 *     returns to `intervalMs` after a good one.
 * `poll` resolves `true` for a good round, `false` (or throws) for a failed one.
 */
export interface VisiblePollingOptions {
  intervalMs: number;
  maxIntervalMs: number;
  enabled?: boolean;
}

const isHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

export function nextInterval(current: number, ok: boolean, opts: VisiblePollingOptions): number {
  return ok ? opts.intervalMs : Math.min(opts.maxIntervalMs, current * 2);
}

export function useVisiblePolling(
  poll: () => Promise<boolean>,
  opts: VisiblePollingOptions,
  deps: readonly unknown[]
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const { intervalMs, maxIntervalMs, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let current = intervalMs;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = cancelled ? null : setTimeout(() => void tick(), current);
    };
    const tick = async (): Promise<void> => {
      if (cancelled || running) return;
      if (isHidden()) {
        // Nothing while hidden; the visibility listener restarts the poll.
        timer = null;
        return;
      }
      running = true;
      let ok: boolean;
      try {
        ok = await pollRef.current();
      } catch {
        ok = false;
      } finally {
        running = false;
      }
      current = nextInterval(current, ok, { intervalMs, maxIntervalMs });
      schedule();
    };
    const onVisibility = () => {
      if (!isHidden()) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what restarts the poll
  }, [enabled, intervalMs, maxIntervalMs, ...deps]);
}
