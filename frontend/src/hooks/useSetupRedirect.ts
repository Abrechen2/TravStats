import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { setupApi } from "../lib/api";
import { logger } from "../lib/logger";

interface UseSetupRedirectParams {
  /** `sessionChecked` from `useSessionValidation` — a persisted user is only
   * a claim until the server has confirmed the cookie. */
  sessionChecked: boolean;
  /** A persisted user exists, confirmed or not — same meaning `App.tsx`
   * already gives the name everywhere else in this file. */
  isAuthenticated: boolean;
}

interface UseSetupRedirectResult {
  /** The setup-status request has settled, success or failure. */
  setupChecked: boolean;
  /** `null` while the request is still in flight. */
  requiresSetup: boolean | null;
}

/**
 * Decides whether this visitor gets bounced to `/setup`.
 *
 * The bounce used to fire on every app mount regardless of session state —
 * `requiresSetup && navigate("/setup")`, no other condition — which meant an
 * already-authenticated session (the shared demo account, most importantly)
 * was yanked back to `/setup` on every load, and there was no way to reach
 * the demo account at all before an admin existed (owner, 2026-09-27: "Demo
 * soll auch ohne Admin gehen" / "vor setup muss es eine Demo Option geben").
 *
 * The redirect now applies to an ANONYMOUS visitor only — unchanged from
 * before. An authenticated session (demo or otherwise) is left alone: it may
 * use the app normally while setup is still pending, and `SetupIncompleteBanner`
 * is what tells it so instead of a forced bounce.
 *
 * Waiting for `sessionChecked` before deciding is what makes that safe: a
 * persisted user is a CLAIM, not a confirmed session, so deciding "already
 * authenticated" off it alone could let a stale, already-invalidated cookie
 * skip the setup requirement for the one tick before the server's 401 clears
 * it. The status FETCH itself is not gated on `sessionChecked` — it still
 * runs as soon as the app mounts, same as before, so a slow session check
 * never also delays learning whether setup is required.
 */
export function useSetupRedirect({
  sessionChecked,
  isAuthenticated,
}: UseSetupRedirectParams): UseSetupRedirectResult {
  const navigate = useNavigate();
  const [setupChecked, setSetupChecked] = useState(false);
  const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkSetup = async () => {
      try {
        const { requiresSetup: needsSetup } = await setupApi.getStatus();
        if (!cancelled) setRequiresSetup(needsSetup);
      } catch (error) {
        logger.error("Setup status check failed:", error);
      } finally {
        if (!cancelled) setSetupChecked(true);
      }
    };

    void checkSetup();
    return () => {
      cancelled = true;
    };
    // Re-asked whenever the session flips. The answer is not fixed for the
    // lifetime of the tab: finishing `/setup` signs the new admin in WITHOUT
    // a reload, and a status read once on mount then kept saying "setup
    // required" — the brand-new admin landed on a dashboard whose banner
    // said "This instance has not been set up yet" (forgejo#88 acceptance,
    // 2026-10-10).
  }, [isAuthenticated]);

  useEffect(() => {
    if (!sessionChecked) return;
    if (requiresSetup && !isAuthenticated) {
      navigate("/setup");
    }
  }, [sessionChecked, requiresSetup, isAuthenticated, navigate]);

  return { setupChecked, requiresSetup };
}
