import { useCallback, useState, type JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../hooks/useTranslation";
import { useAuthStore } from "../store/authStore";
import { Icon } from "./ui/Icon";

/** One flag per account per browser session; the value itself is irrelevant. */
export const SETUP_INCOMPLETE_BANNER_KEY_PREFIX = "ts.setupIncompleteBanner.dismissed.";

function wasDismissed(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) !== null;
  } catch {
    // Storage blocked (private window, sandboxed frame): treat as not
    // dismissed. The cost is the banner reappearing on the next load, never
    // a crash.
    return false;
  }
}

function markDismissed(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Same trade as `wasDismissed`: without storage the banner cannot
    // remember its dismissal across a reload, which is acceptable.
  }
}

interface SetupIncompleteBannerProps {
  /** The server has confirmed the session — a persisted user is only a claim. */
  sessionConfirmed: boolean;
  /** `null` while `/setup/status` has not answered yet. */
  requiresSetup: boolean | null;
}

/**
 * Tells an authenticated visitor, while the instance still has no admin
 * account, that this is not the finished, configured instance — most
 * relevantly the demo account, which can now sign in before setup exists
 * (owner, 2026-09-27: "Demo soll auch ohne Admin gehen").
 *
 * Deliberately generic rather than demo-only: `useSetupRedirect` no longer
 * bounces ANY authenticated session back to `/setup`, so any account that
 * ends up signed in while setup is still pending gets the same notice — a
 * small, dismissable-per-session banner rather than the DemoBetaNotice
 * dialog's modal interruption, so the two can be on screen at once without
 * fighting for the same space.
 */
export default function SetupIncompleteBanner({
  sessionConfirmed,
  requiresSetup,
}: SetupIncompleteBannerProps): JSX.Element | null {
  const { t } = useTranslation("common");
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [dismissed, setDismissed] = useState(false);

  const visible = sessionConfirmed && requiresSetup === true && userId !== null && !dismissed;

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (userId !== null) {
      markDismissed(`${SETUP_INCOMPLETE_BANNER_KEY_PREFIX}${userId}`);
    }
  }, [userId]);

  if (userId !== null && wasDismissed(`${SETUP_INCOMPLETE_BANNER_KEY_PREFIX}${userId}`)) {
    return null;
  }
  if (!visible) return null;

  return (
    <div
      className="w-full"
      style={{
        background: "var(--ts-surface2, var(--bg-elevated))",
        borderBottom: "1px solid var(--ts-border, var(--color-border))",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="info" size={16} />
          <span className="truncate">{t("common:setupIncompleteBanner.message")}</span>
          <Link to="/setup" className="whitespace-nowrap font-semibold hover:underline">
            {t("common:setupIncompleteBanner.link")}
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common:buttons.close")}
          className="shrink-0 rounded-md p-1 hover:bg-black/5"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
