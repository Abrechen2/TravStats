import { useState, type JSX } from "react";
import { Link, useLocation } from "react-router-dom";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { snoozeInvitation } from "../../lib/api/readiness";
import { logger } from "../../lib/logger";
import { refreshReadinessShell, useReadinessShellStore } from "../../store/readinessShellStore";
import Button from "../ui/Button";

export const READINESS_PAGE_PATH = "/settings/einrichtung";

/** Both actions share one height, so the pair reads as a pair. */
const BUTTON_HEIGHT = (coarse: boolean): number => (coarse ? 44 : 36);

/** Mirrors the `primary` skin in `ui/Button.tsx`, for a link. */
const PRIMARY_LINK_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 var(--ts-space-xl)",
  borderRadius: "var(--ts-radius-button)",
  fontWeight: 700,
  fontSize: 16,
  fontFamily: "var(--ts-font-ui)",
  whiteSpace: "nowrap",
  textDecoration: "none",
  background: "var(--ts-accent)",
  color: "var(--ts-accent-text)",
  border: "1px solid var(--ts-accent)",
} as const;

interface SurfaceState {
  /** `checked` from `useWhatsNew`. */
  whatsNewChecked: boolean;
  /** The what's-new modal is on screen. */
  whatsNewOpen: boolean;
  /** `settled` from `useTelemetryConsentStep`. */
  consentSettled: boolean;
  /** The telemetry consent step is on screen. */
  consentOpen: boolean;
}

/**
 * The card waits until the what's-new modal and the telemetry consent step
 * have both SETTLED, not merely until neither is open: both flags are false
 * while their request is in flight, and a card shown then would be on screen
 * together with the dialog that follows it (spec §4.2, "never more than one of
 * these surfaces at a time").
 */
export function invitationBlocked(s: SurfaceState): boolean {
  return !s.whatsNewChecked || s.whatsNewOpen || !s.consentSettled || s.consentOpen;
}

/**
 * The invitation card (spec 2026-11-14-setup-readiness-design §4.2, §12): not a
 * modal, no question, no consent. "Jetzt ansehen" opens the page, which marks
 * the card's content as seen; "Morgen erinnern" snoozes it for a day.
 *
 * The shared demo account gets no card: both ways out of it are writes, and
 * the demo refuses writes, so the card could never be dismissed.
 */
export default function ReadinessInvitationCard({
  blocked,
}: {
  blocked: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["readiness"]);
  const coarse = useCoarsePointer();
  const demo = useIsDemoAccount();
  const location = useLocation();
  const invitation = useReadinessShellStore((s) => s.invitation);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onPage = location.pathname.startsWith(READINESS_PAGE_PATH);
  if (!invitation?.show || !invitation.reason || blocked || demo || onPage) return null;

  const snooze = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      await snoozeInvitation();
    } catch (error) {
      // Keep the card and say so: a snooze that did nothing must not look done.
      logger.warn("readiness invitation snooze failed", error);
      setFailed(true);
      setBusy(false);
      return;
    }
    setBusy(false);
    useReadinessShellStore.getState().hideInvitation();
    void refreshReadinessShell();
  };

  return (
    <aside
      aria-label={t("readiness:invitation.label")}
      data-testid="readiness-invitation"
      className="fixed flex flex-col"
      style={{
        // Bottom-CENTRE: the dashboard's map panel sits bottom-left (the card
        // covered it there), its key and domain filter bottom-right, the time
        // bar top-centre. Toasts share the bottom-centre but are short-lived.
        // Capped at 360 so it stays clear of both corners at 820 px.
        bottom: "var(--ts-space-lg)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(360px, calc(100vw - 2 * var(--ts-space-lg)))",
        gap: "var(--ts-space-sm)",
        padding: "var(--ts-space-md)",
        background: "var(--ts-surface2, var(--ts-tile))",
        border: "1px solid var(--ts-border, var(--color-border))",
        borderRadius: "var(--ts-radius-card)",
        zIndex: 40,
      }}
    >
      <strong>{t("readiness:invitation.title")}</strong>
      <p className="t-caption">{t(`readiness:invitation.reason.${invitation.reason}`)}</p>
      {failed && (
        <p role="alert" className="t-caption">
          {t("readiness:invitation.snoozeFailed")}
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        {/* A Link that wears the primary button's skin. The old text link used
            --ts-accent-text, which is the label colour FOR an accent fill, so it
            drew dark on the dark card. */}
        <Link
          to={READINESS_PAGE_PATH}
          className="ts-button"
          data-variant="primary"
          style={{ ...PRIMARY_LINK_STYLE, height: BUTTON_HEIGHT(coarse) }}
        >
          {t("readiness:invitation.view")}
        </Link>
        <Button
          variant="secondary"
          style={{ height: BUTTON_HEIGHT(coarse) }}
          disabled={busy}
          onClick={() => void snooze()}
        >
          {t("readiness:snooze")}
        </Button>
      </div>
    </aside>
  );
}
