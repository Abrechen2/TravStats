import { useCallback, useEffect, useState } from "react";
import { settingsApi, versionApi } from "../lib/api";
import { compareVersions, findEntryForVersion, type WhatsNewEntry } from "../content/whatsNew";
import { logger } from "../lib/logger";

interface UseWhatsNewResult {
  entry: WhatsNewEntry | null;
  shouldShow: boolean;
  /**
   * True once the check below has settled, whichever way it went.
   *
   * The telemetry consent step waits for this (owner decision 2026-09-20).
   * Without it the two checks race: `shouldShow` is also false while the
   * version request is still in flight, so an instance that DOES have release
   * highlights would flash the consent dialog first and have it replaced a
   * moment later — the opposite of "after the what's-new is dismissed".
   */
  checked: boolean;
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
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setEntry(null);
      setShouldShow(false);
      setChecked(false);
      return;
    }
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const [{ version }, settings] = await Promise.all([versionApi.get(), settingsApi.get()]);
        if (cancelled) return;

        // Compare "seen" against the ENTRY's version, not the running version.
        // findEntryForVersion matches with <=, so on 2.3.1 the running version
        // and the entry's ("2.3.0") differ — comparing against the former would
        // never register the dismissal and the modal would reappear forever.
        //
        // And "at or after", not "equal": a NEW account is stamped server-side
        // with the RUNNING version (services/whatsNewStamp.ts), so on 2.6.3 it
        // carries "2.6.3" against a "2.6.0" entry. Equality showed that account
        // the highlights of a release it never used.
        const match = findEntryForVersion(version);
        const seen = settings.whatsNewSeenVersion;
        if (!match || (seen && compareVersions(seen, match.version) >= 0)) {
          setEntry(null);
          setShouldShow(false);
          setChecked(true);
          return;
        }
        setEntry(match);
        setShouldShow(true);
        setChecked(true);
      } catch (error) {
        if (!cancelled) {
          setShouldShow(false);
          setChecked(true);
        }
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

  return { entry, shouldShow, checked, dismiss };
}
