import { useState } from "react";
import type { CSSProperties, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { isProtectedSource } from "../../lib/roadtrip/reorderImpact";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { LegMode, TourLeg } from "../../types/tour";

const MODES = ["road", "ferry"] as const satisfies readonly LegMode[];

const chip = (on: boolean): CSSProperties => ({
  minHeight: "var(--ts-size-touch-min)",
  padding: "0 14px",
  borderRadius: "var(--ts-radius-button)",
  border: `1px solid ${on ? "var(--domain-roadtrip)" : "var(--ts-border-button)"}`,
  background: on ? "var(--domain-roadtrip-soft)" : "transparent",
  color: "var(--ts-text)",
  fontSize: 13,
  fontWeight: on ? 700 : 500,
  cursor: "pointer",
});

/**
 * The leg's transport as two chips in the editor, so a ferry hop is one tap
 * instead of a dialog. A line somebody recorded or drew is never replaced from
 * here: that tap opens the leg dialog, which says what it would replace. A
 * routed road leg that becomes a ferry turns straight (a ferry follows no
 * road); a ferry that becomes a road leg is routed again, and when the
 * provider cannot, the notice says the line is now straight — never a silent
 * downgrade.
 */
export default function LegModeChips({
  routeId,
  leg,
  from,
  to,
  routingAvailable,
  onOpenDialog,
  onChanged,
}: {
  routeId: string;
  leg: TourLeg;
  from: string;
  to: string;
  routingAvailable: boolean;
  onOpenDialog: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const protectedLine = isProtectedSource(leg.source);

  const pick = async (mode: (typeof MODES)[number]): Promise<void> => {
    if (mode === leg.mode || busy) return;
    if (protectedLine) {
      onOpenDialog();
      return;
    }
    setBusy(true);
    setNotice(null);
    // A ferry leg is always straight, so "was routed" cannot be asked of it:
    // becoming a road leg is routed again either way.
    const wantsRoute =
      mode === "road" && routingAvailable && (leg.source === "routed" || leg.mode === "ferry");
    try {
      await toursApi.setLeg(undefined, routeId, from, to, { source: "straight", mode });
    } catch (err) {
      logger.warn("Changing a roadtrip leg's transport failed", err);
      setNotice(t(saveErrorKey(err, "roadtrips:editor.legMode.failed")));
      setBusy(false);
      return;
    }
    let routedBack = true;
    if (wantsRoute) {
      try {
        routedBack =
          (await toursApi.routeLeg(undefined, routeId, from, to)).fallbackReason === null;
      } catch (err) {
        logger.warn("Re-routing a roadtrip leg after a mode change failed", err);
        routedBack = false;
      }
    }
    if (wantsRoute && !routedBack) setNotice(t("roadtrips:editor.legMode.routeFailed"));
    setBusy(false);
    onChanged();
  };

  return (
    <div className="flex flex-col self-start" style={{ gap: 4 }}>
      <div
        role="group"
        aria-label={t("roadtrips:editor.legMode.label")}
        className="flex"
        style={{ gap: 6 }}
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={leg.mode === m}
            disabled={busy}
            onClick={() => void pick(m)}
            style={chip(leg.mode === m)}
          >
            {t(`roadtrips:editor.legMode.${m}`)}
          </button>
        ))}
      </div>
      {protectedLine && (
        <span className="t-caption">{t("roadtrips:editor.legMode.protected")}</span>
      )}
      {notice && (
        <span role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {notice}
        </span>
      )}
    </div>
  );
}
