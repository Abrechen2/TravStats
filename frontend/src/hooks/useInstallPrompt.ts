import { useCallback, useSyncExternalStore } from "react";
import { logger } from "../lib/logger";
import {
  hasInstallPrompt,
  showInstallPrompt,
  subscribeToInstallPrompt,
} from "../lib/installPrompt";

export interface InstallPrompt {
  /** True only once the browser has offered; render no entry otherwise. */
  canInstall: boolean;
  /** Shows the browser's own dialog. Must be called from a user gesture. */
  promptInstall: () => void;
}

/**
 * The browser's own "install this app" offer, if it has made one.
 *
 * The listener does NOT live here. `beforeinstallprompt` fires once and
 * early, so a listener that waits for a component to mount misses it — this
 * hook used to register its own, and the entry appeared only when the user
 * menu happened to mount first, which on a cold load it does not (review,
 * 2026-09-19). `lib/installPrompt.ts` listens at module scope, imported from
 * `main.tsx`, and this subscribes to what it caught.
 *
 * `false` — no offer — is the common case, not an error: Safari and Firefox
 * never fire the event, and Chromium does not fire it for an app that is
 * already installed or that fails an installability criterion. A caller
 * renders nothing then; an "Install" entry a browser cannot honour is the
 * passkey button all over again (`passkeyUnavailableReason`).
 */
export function useInstallPrompt(): InstallPrompt {
  const canInstall = useSyncExternalStore(
    subscribeToInstallPrompt,
    hasInstallPrompt,
    // Server snapshot: nothing is installable while there is no browser.
    () => false
  );

  const promptInstall = useCallback(() => {
    showInstallPrompt().catch((error: unknown) => {
      logger.warn("The install prompt could not be shown", error);
    });
  }, []);

  return { canInstall, promptInstall };
}
