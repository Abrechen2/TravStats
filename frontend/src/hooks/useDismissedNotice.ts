import { useCallback, useState } from "react";

/**
 * A notice the user reads once and closes.
 *
 * The dismissal is a per-viewer convenience, so it lives in the browser: the
 * notice comes back on another device, which is acceptable for a sentence and
 * not worth a settings column. Storage can be absent or throw (private
 * windows, cleared site data), and then the notice simply shows again.
 *
 * The key should carry what the notice is ABOUT, so a notice about a
 * different change does not inherit an old dismissal.
 */
export function useDismissedNotice(key: string): { dismissed: boolean; dismiss: () => void } {
  const storageKey = `travstats.notice.${key}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const dismiss = useCallback((): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Nothing to persist into — the notice will show again next time.
    }
  }, [storageKey]);
  return { dismissed, dismiss };
}
