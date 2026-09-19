import { useCallback, useEffect, useState } from "react";
import { logger } from "../lib/logger";

/**
 * The browser's own "install this app" offer, kept so the app can make it.
 *
 * TravStats ships a web manifest and a service worker, so a Chromium browser
 * fires `beforeinstallprompt` and then hides its own install affordance
 * behind a menu the average reader never opens — and the app said nothing at
 * all (auditor 3, 2026-09-19). The event is the ONLY handle on that offer:
 * `prompt()` cannot be called later from nowhere, and cannot be called at all
 * without a user gesture, which is why the event is stored rather than acted
 * on.
 *
 * `null` means there is nothing to offer, and that is the common case, not an
 * error: Safari and Firefox never fire the event, and Chromium does not fire
 * it for an app that is already installed or that fails an installability
 * criterion. A caller must render nothing then — an "Install" entry that a
 * browser cannot honour is the passkey button all over again
 * (`passkeyUnavailableReason`).
 *
 * The event is deliberately not typed against `BeforeInstallPromptEvent`:
 * that interface is Chromium-only and absent from lib.dom, so the shape is
 * declared here, narrowly, for exactly the two members that are used.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof (event as InstallPromptEvent).prompt === "function";
}

export interface InstallPrompt {
  /** True only once the browser has offered; render no entry otherwise. */
  canInstall: boolean;
  /** Shows the browser's own dialog. Must be called from a user gesture. */
  promptInstall: () => void;
}

export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event): void => {
      if (!isInstallPromptEvent(event)) return;
      // Without this the browser shows its own bar as well, and the reader
      // gets the same offer twice.
      event.preventDefault();
      setDeferred(event);
    };
    // Once installed the offer is spent — the event never fires again, and a
    // stale one would open a dialog that answers "already installed".
    const onInstalled = (): void => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(() => {
    if (!deferred) return;
    // One event, one prompt: a second `prompt()` on the same event rejects.
    setDeferred(null);
    deferred.prompt().catch((error: unknown) => {
      logger.warn("The install prompt could not be shown", error);
    });
  }, [deferred]);

  return { canInstall: deferred !== null, promptInstall };
}
