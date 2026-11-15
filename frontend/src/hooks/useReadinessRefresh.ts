import { useEffect } from "react";

import { useReadinessShellStore } from "../store/readinessShellStore";

/**
 * Keeps the shell's readiness answer fresh (spec §12): once when the session
 * is confirmed (login or reload), again when the tab regains focus — at most
 * every 10 minutes — and after any readiness write (see
 * `refreshReadinessShell`). Deliberately no timer: a loop would keep asking
 * about a thing that changes when a person acts.
 */
export function useReadinessRefresh(sessionConfirmed: boolean): void {
  const refresh = useReadinessShellStore((s) => s.refresh);
  const refreshOnFocus = useReadinessShellStore((s) => s.refreshOnFocus);
  const reset = useReadinessShellStore((s) => s.reset);

  useEffect(() => {
    if (!sessionConfirmed) {
      reset();
      return;
    }
    void refresh();
    const onFocus = (): void => void refreshOnFocus(Date.now());
    const onVisible = (): void => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionConfirmed, refresh, refreshOnFocus, reset]);
}
