import { useCallback, useEffect, useState } from "react";
import { settingsApi, versionApi } from "../lib/api";
import { findEntryForVersion, type WhatsNewEntry } from "../content/whatsNew";
import { logger } from "../lib/logger";

interface UseWhatsNewResult {
  entry: WhatsNewEntry | null;
  shouldShow: boolean;
  dismiss: () => Promise<void>;
}

/**
 * Decides whether the release-highlights modal should appear.
 *
 * Shows when: authenticated, a content entry matches the running backend
 * version, and that version is not recorded as seen for this user.
 *
 * Every failure path hides the modal. It is not important enough to surface
 * an error, and a modal that appears on a broken request is worse than none.
 */
export function useWhatsNew(isAuthenticated: boolean): UseWhatsNewResult {
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setEntry(null);
      setShouldShow(false);
      return;
    }
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const [{ version }, settings] = await Promise.all([versionApi.get(), settingsApi.get()]);
        if (cancelled) return;

        const match = findEntryForVersion(version);
        if (!match || settings.whatsNewSeenVersion === version) {
          setEntry(null);
          setShouldShow(false);
          return;
        }
        setEntry(match);
        setShouldShow(true);
      } catch (error) {
        if (!cancelled) setShouldShow(false);
        logger.debug("whats-new check failed", error);
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const dismiss = useCallback(async (): Promise<void> => {
    // Close first: the user asked to close, and a failed PUT must never
    // leave the modal open. Worst case it reappears next session.
    setShouldShow(false);
    if (!entry) return;
    try {
      await settingsApi.update({ whatsNewSeenVersion: entry.version });
    } catch (error) {
      logger.debug("whats-new dismiss failed to persist", error);
    }
  }, [entry]);

  return { entry, shouldShow, dismiss };
}
