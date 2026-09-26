import { useCallback, useEffect, useState, type JSX } from "react";

import Dialog from "./ui/Dialog";
import { useTranslation } from "../hooks/useTranslation";
import { useIsDemoAccount } from "../hooks/useIsDemoAccount";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { useAuthStore } from "../store/authStore";
import { BETA_FEATURE_KEYS } from "../config/betaFeatures";

/** One flag per account per browser session; the value itself is irrelevant. */
export const DEMO_BETA_NOTICE_KEY_PREFIX = "ts.demoBetaNotice.seen.";

function wasSeen(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) !== null;
  } catch {
    // Storage blocked (private window, sandboxed frame): treat as unseen. The
    // cost is the notice appearing again on the next load, never a crash.
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Same trade as `wasSeen`: without storage the notice cannot remember
    // itself across a reload, and that is acceptable.
  }
}

interface DemoBetaNoticeProps {
  /** The server has confirmed the session — a persisted user is only a claim. */
  sessionConfirmed: boolean;
  /** `checked` from `useWhatsNew`: its check has settled, either way. */
  whatsNewChecked: boolean;
  /** `shouldShow` from `useWhatsNew`: its dialog is on screen right now. */
  whatsNewOpen: boolean;
}

/**
 * Tells a visitor of the SHARED demo account, once per browser session, that
 * the demo runs with the beta features switched on (owner requirement
 * 2026-09-26) — so that a half-finished feature reads as "beta" and not as
 * the finished product.
 *
 * Keyed on `isSharedDemo`, not the raw `isDemo` column: the shared account is
 * the one visitors sign in to, while `isDemo` also marks the preview's own
 * admin and the local dev admin, who are not being shown a demo.
 *
 * It only speaks while the instance flag is actually ON. An admin who switched
 * beta off would otherwise have the demo claim features it cannot see.
 *
 * The feature names come from the beta registry via the same translated names
 * the admin's switch lists (`BetaFeatureList`), so the notice cannot drift from
 * what the switch really unlocks — and says nothing when the registry is empty.
 *
 * Waits for the what's-new check to settle and its dialog to close, for the
 * same reason `useTelemetryConsentStep` does: two dialogs never stack.
 */
export default function DemoBetaNotice({
  sessionConfirmed,
  whatsNewChecked,
  whatsNewOpen,
}: DemoBetaNoticeProps): JSX.Element | null {
  const { t } = useTranslation(["common", "admin"]);
  const isSharedDemo = useIsDemoAccount();
  const { betaFeaturesEnabled } = useBetaFeatures();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [open, setOpen] = useState(false);

  const applies =
    sessionConfirmed &&
    isSharedDemo &&
    betaFeaturesEnabled === true &&
    BETA_FEATURE_KEYS.length > 0 &&
    userId !== null;
  const ready = applies && whatsNewChecked && !whatsNewOpen;

  useEffect(() => {
    if (!ready || open || userId === null) return;
    const key = `${DEMO_BETA_NOTICE_KEY_PREFIX}${userId}`;
    if (wasSeen(key)) return;
    // Marked when shown, not when dismissed: a reload with the dialog still
    // up is the same session, and the reader has already seen it.
    markSeen(key);
    setOpen(true);
  }, [ready, open, userId]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog
      open={open && applies}
      onClose={close}
      title={t("common:demoBetaNotice.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:demoBetaNotice.dismiss")}
    >
      <p style={{ margin: "0 0 var(--ts-space-md)" }}>{t("common:demoBetaNotice.body")}</p>
      <p style={{ margin: "0 0 var(--ts-space-sm)" }}>{t("common:demoBetaNotice.listTitle")}</p>
      <ul style={{ margin: 0, paddingLeft: "1.25em", listStyle: "disc" }}>
        {BETA_FEATURE_KEYS.map((key) => (
          <li key={key}>{t(`admin:instance.fields.betaFeatures.features.${key}.name`)}</li>
        ))}
      </ul>
    </Dialog>
  );
}
