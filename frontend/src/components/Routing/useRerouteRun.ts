import { useCallback, useEffect, useRef, useState } from "react";

import { jobErrorCode } from "../../lib/api/jobs";
import type { RerouteRun } from "../../lib/api/rerouteRuns";
import { logger } from "../../lib/logger";

const POLL_MS = 3000;
const PAUSED_POLL_MS = 60_000;

export type RerouteError = "notConfigured" | "failed" | "loadFailed";

/**
 * One re-route run on screen: starts it, follows it while it runs, cancels it.
 * The server holds the run (it can outlive this page and a day), so the hook
 * only ever shows what `read` answers; a refused start says why.
 */
export function useRerouteRun(
  api: {
    read: () => Promise<RerouteRun | null>;
    start: () => Promise<RerouteRun>;
    cancel: (id: string) => Promise<RerouteRun>;
  },
  /** Read the latest run on mount. A page that only offers the action reads it when asked. */
  readOnMount = true,
  /** Called once when the run this hook follows ends, so a page can reload what it changed. */
  onEnded?: (run: RerouteRun) => void
): {
  run: RerouteRun | null;
  error: RerouteError | null;
  busy: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
} {
  const [run, setRun] = useState<RerouteRun | null>(null);
  const [error, setError] = useState<RerouteError | null>(null);
  const [busy, setBusy] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const runId = run?.id ?? null;
  const status = run?.status ?? null;
  const active = status === "running" || status === "paused";
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const lastStatus = useRef<string | null>(null);

  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = status;
    if (run && before && (before === "running" || before === "paused") && !active) {
      onEndedRef.current?.(run);
    }
  }, [status, active, run]);

  useEffect(() => {
    if (!readOnMount) return undefined;
    let alive = true;
    apiRef.current
      .read()
      .then((r) => alive && setRun(r))
      .catch((err: unknown) => {
        logger.warn("Reading the re-route run failed", err);
        if (alive) setError("loadFailed");
      });
    return () => {
      alive = false;
    };
  }, [readOnMount]);

  useEffect(() => {
    if (!active || !runId) return undefined;
    // A paused run waits for the next quota window; looking once a minute is enough
    // to see it go on by itself.
    const timer = setInterval(
      () => {
        apiRef.current
          .read()
          .then((r) => r && setRun(r))
          .catch((err: unknown) => logger.warn("Following the re-route run failed", err));
      },
      status === "paused" ? PAUSED_POLL_MS : POLL_MS
    );
    return () => clearInterval(timer);
  }, [active, status, runId]);

  const start = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setRun(await apiRef.current.start());
    } catch (err) {
      logger.warn("Starting the re-route failed", err);
      setError(jobErrorCode(err) === "notConfigured" ? "notConfigured" : "failed");
      // `alreadyActive` carries the run that is going: show it instead of an error.
      try {
        const current = await apiRef.current.read();
        if (current && (current.status === "running" || current.status === "paused")) {
          setRun(current);
          setError(null);
        }
      } catch {
        /* the error above already says it */
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runId) return;
    try {
      setRun(await apiRef.current.cancel(runId));
    } catch (err) {
      logger.warn("Cancelling the re-route failed", err);
      setError("failed");
    }
  }, [runId]);

  return { run, error, busy, start, cancel };
}
