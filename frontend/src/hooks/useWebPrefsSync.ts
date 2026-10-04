import { useEffect } from "react";
import i18n from "../i18n/config";
import { webPrefsApi } from "../lib/api/webPrefs";
import { logger } from "../lib/logger";
import { WEB_PREF_SECTIONS } from "../lib/webPrefs/registry";
import { createWebPrefsSync, type WebPrefsFailure } from "../lib/webPrefs/webPrefsSync";
import { useToastStore } from "../store/toastStore";

/** A refocused tab re-reads the server at most this often. */
const REFRESH_MIN_INTERVAL_MS = 30_000;

const FAILURE_COPY: Record<WebPrefsFailure, string> = {
  retrying: "settings:errors.webPrefsRetrying",
  tooLarge: "settings:errors.webPrefsTooLarge",
  rejected: "settings:errors.webPrefsRejected",
};

/**
 * Runs the web-prefs sync (forgejo#200) for the signed-in account: started
 * when `userId` is set, stopped — every pending write dropped from this page,
 * kept for the same account's next visit — when it goes null or changes.
 *
 * Pass null until the server has confirmed the session, and for the shared
 * demo account, whose preferences stay per browser (the server refuses its
 * writes: one visitor's colours would become every visitor's).
 *
 * Two page events: a tab coming back into view re-reads the server, so a
 * colour changed on the phone shows up on the computer without a reload; a
 * tab being hidden sends pending changes at once instead of after the
 * debounce, because a hidden tab is often a tab about to be closed.
 */
export function useWebPrefsSync(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    const sync = createWebPrefsSync({
      sections: WEB_PREF_SECTIONS,
      transport: webPrefsApi,
      storage: window.localStorage,
      userId,
      onFailure: (kind) => {
        useToastStore.getState().addToast("warning", i18n.t(FAILURE_COPY[kind]), 8000);
      },
      warn: (message, detail) => logger.warn(message, detail),
    });
    void sync.start();

    let lastRefresh = Date.now();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void sync.flush();
        return;
      }
      if (Date.now() - lastRefresh < REFRESH_MIN_INTERVAL_MS) return;
      lastRefresh = Date.now();
      void sync.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      sync.stop();
    };
  }, [userId]);
}
