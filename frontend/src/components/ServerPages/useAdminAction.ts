import { useCallback, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * Runs one admin write and remembers how it ended, so the page can say it
 * under the row instead of in a toast that is gone a few seconds later.
 * `failed` carries the key of the sentence that names WHAT failed; the server's
 * own English text is never shown.
 */
export function useAdminAction(): {
  busy: boolean;
  failed: string | null;
  run: (failKey: string, action: () => Promise<void>) => Promise<boolean>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const run = useCallback(async (failKey: string, action: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      return true;
    } catch (error) {
      logger.error(`Admin action failed (${failKey}):`, error);
      setFailed(failKey);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, failed, run, clear: () => setFailed(null) };
}
