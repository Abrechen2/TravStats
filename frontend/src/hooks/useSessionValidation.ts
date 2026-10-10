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
 * Derives the session from the SERVER once per app start: verifies a
 * persisted login, and restores one that only the cookie still knows about.
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
      // No persisted user is NOT "signed out": the session is the HttpOnly
      // cookie, and localStorage can be gone while it is not — cleared site
      // data, a storage-partitioned browser, a second profile sharing
      // cookies. Deciding off localStorage alone sent such a browser to the
      // login page with a perfectly good session (forgejo#88 acceptance,
      // 2026-10-10). So the server is asked; a 401 is the ordinary anonymous
      // answer and changes nothing (the persisted user is already null, so
      // the interceptor's logout path has nothing to clear or redirect).
      const restore = async () => {
        try {
          const { user } = await authApi.me();
          useAuthStore.getState().setAuth(user);
        } catch {
          // Anonymous (401), or the server is unreachable: stay signed out.
        } finally {
          setSessionChecked(true);
        }
      };
      void restore();
      return;
    }

    const validate = async () => {
      try {
        // The persisted user predates fields the server has since started
        // returning (e.g. `isSharedDemo`) — refresh it from /auth/me rather than
        // trusting the copy localStorage rehydrated with.
        const { user } = await authApi.me();
        useAuthStore.getState().setAuth(user);
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
