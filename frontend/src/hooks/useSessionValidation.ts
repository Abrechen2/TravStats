import { useEffect, useRef, useState } from "react";

import { authApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";

/**
 * Reads an HTTP status off an unknown rejection value. Works for real
 * AxiosErrors without forcing callers to depend on axios internals.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }
  const { response } = error as { response?: { status?: unknown } };
  return typeof response?.status === "number" ? response.status : undefined;
}

/**
 * Verifies a persisted login against the server once per app start.
 *
 * The persisted user in localStorage has no expiry; the auth cookie expires
 * after 7 days. Without this check the app boots as "logged in" with a dead
 * cookie and fires its whole dashboard fetch burst into 401s before anything
 * redirects. Gate protected rendering on `sessionChecked`.
 */
export function useSessionValidation(): { sessionChecked: boolean } {
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [sessionChecked, setSessionChecked] = useState(false);
  const alreadyValidated = useRef(false);

  useEffect(() => {
    // The persisted user only exists after rehydration — deciding earlier
    // would read `null` for every logged-in user and skip the check.
    if (!hasHydrated || alreadyValidated.current) return;
    alreadyValidated.current = true;

    // Read the user imperatively. This is a ONE-SHOT boot check, and depending
    // on `user` made the axios interceptor's logout — triggered by the very
    // 401 being handled here — re-run the effect, cancel the in-flight check
    // and leave the app on the loading screen forever.
    if (!useAuthStore.getState().user) {
      setSessionChecked(true);
      return;
    }

    const validate = async () => {
      try {
        await authApi.me();
      } catch (error) {
        if (httpStatusOf(error) === 401) {
          clearSession();
        } else {
          // A network error or a 5xx is an outage, not a rejected session.
          // Signing everybody out over a blip would be the worse failure.
          logger.warn("Session validation failed, keeping the cached session:", error);
        }
      } finally {
        // Unconditional on purpose: the boot gate must open on every path.
        setSessionChecked(true);
      }
    };

    void validate();
  }, [hasHydrated, clearSession]);

  return { sessionChecked };
}
