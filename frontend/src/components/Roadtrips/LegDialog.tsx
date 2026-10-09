import { useState } from "react";
import type { CSSProperties, JSX } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { FormErrorBanner, navigateAfterSave, useDirtyGuard, useFormFailure } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import type { RouteFallbackReason, TourLeg } from "../../types/tour";

type Mode = "road" | "ferry";
type Line = "routed" | "straight" | "drawn";

/** What the dialog opens on — the state's start AND the dirty baseline. */
function legChoice(leg: TourLeg): { mode: Mode; line: Line } {
  return {
    mode: leg.mode === "ferry" ? "ferry" : "road",
    line: leg.source === "routed" ? "routed" : leg.source === "drawn" ? "drawn" : "straight",
  };
}

/**
 * One leg's two questions (board 5): travelled by what, and drawn how.
 * A ferry cannot follow a road, so "along the road" is offered only for a
 * road leg and only where a routing provider exists — and says why when it
 * is not. Drawing by hand is the leg editor's job; this dialog sends the
 * reader there instead of growing a second one.
 *
 * "Along the road" is only done when the provider routed it. A fallback keeps
 * the dialog open and says why (tester 2026-09-26: the button "did nothing" —
 * it wrote a straight line, ignored the answer and closed). The leg is not
 * set to straight first either: a drawn line survives a failed attempt, and
 * a straight line is saved only when the reader picks "Gerade Linie".
 *
 * forgejo#246–#248: a refused save is a banner inside the dialog that stays
 * until the next choice (with "Erneut versuchen" where trying again can help),
 * the dialog cannot be dismissed while it saves, and a changed choice asks
 * before Escape, the scrim, the × or "Abbrechen" throw it away.
 */
export default function LegDialog({
  routeId,
  leg,
  from,
  to,
  routingAvailable,
  onClose,
  onSaved,
  onChanged,
}: {
  routeId: string;
  leg: TourLeg;
  from: { id: string; title: string };
  to: { id: string; title: string };
  routingAvailable: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The leg changed on the server but the dialog stays open (a mode switch before a failed route). */
  onChanged?: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "trips", "common"]);
  const navigate = useNavigate();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const initial = legChoice(leg);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [line, setLine] = useState<Line>(initial.line);
  const [saving, setSaving] = useState(false);
  const [fallback, setFallback] = useState<RouteFallbackReason | null>(null);
  const { dirty, markSaved } = useDirtyGuard(initial, { mode, line });
  const failure = useFormFailure(`${mode}|${line}`);

  const routedOff = mode === "ferry" || !routingAvailable;
  const effectiveLine: Line = routedOff && line === "routed" ? "straight" : line;

  const apply = async (): Promise<void> => {
    if (effectiveLine === "drawn") {
      // Leaving with a changed choice: the guard's history entry is replaced,
      // never raced by a plain `navigate` (see `navigateAfterSave`).
      void navigateAfterSave(navigate, `/tours/${routeId}`);
      return;
    }
    setSaving(true);
    failure.clear();
    setFallback(null);
    try {
      if (effectiveLine === "straight") {
        await toursApi.setLeg(undefined, routeId, from.id, to.id, { source: "straight", mode });
        markSaved();
        onSaved();
        return;
      }
      // Routing reads the stored mode, so a changed mode is stored first.
      const modeChanged = mode !== leg.mode;
      if (modeChanged) {
        await toursApi.setLeg(undefined, routeId, from.id, to.id, { source: "straight", mode });
      }
      const { fallbackReason } = await toursApi.routeLeg(undefined, routeId, from.id, to.id);
      if (fallbackReason === null) {
        markSaved();
        onSaved();
        return;
      }
      setFallback(fallbackReason);
      if (modeChanged) onChanged?.();
    } catch (err) {
      logger.warn("Saving a roadtrip leg failed", err);
      failure.fail(saveErrorKey(err, "roadtrips:legDialog.error"));
    } finally {
      setSaving(false);
    }
  };

  const tile = (on: boolean, hue: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    border: `2px solid ${on ? hue : "var(--ts-border)"}`,
    background: on ? "var(--ts-tile)" : "var(--ts-surface)",
    color: "inherit",
    cursor: "pointer",
  });

  const lines: Array<{ id: Line; label: string; hint: string; off: boolean }> = [
    {
      id: "routed",
      label: t("roadtrips:legDialog.routed"),
      hint:
        mode === "ferry"
          ? t("roadtrips:legDialog.routedFerry")
          : routingAvailable
            ? t("roadtrips:legDialog.routedHint")
            : t("roadtrips:legDialog.routedUnavailable"),
      off: routedOff,
    },
    {
      id: "straight",
      label: t("roadtrips:legDialog.straight"),
      hint: t("roadtrips:legDialog.straightHint"),
      off: false,
    },
    {
      id: "drawn",
      label: t("roadtrips:legDialog.drawn"),
      hint: t("roadtrips:legDialog.drawnHint"),
      off: false,
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      busy={saving}
      dirty={dirty}
      maxWidth={540}
      title={
        <span className="flex flex-col" style={{ gap: 4 }}>
          <span>{t("roadtrips:legDialog.title")}</span>
          <span className="t-caption" style={{ fontSize: 15 }}>
            {from.title} → {to.title}
          </span>
        </span>
      }
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" disabled={saving} onClick={() => void apply()}>
          {t("roadtrips:legDialog.apply")}
        </Button>
      }
    >
      <div ref={failure.rootRef} className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-caption" style={{ marginBottom: 8 }}>
            {t("roadtrips:legDialog.mode")}
          </legend>
          <div className="grid grid-cols-2" style={{ gap: 10 }}>
            <button
              type="button"
              aria-pressed={mode === "road"}
              onClick={() => setMode("road")}
              style={tile(mode === "road", "var(--domain-roadtrip)")}
            >
              <svg width="80" height="8" aria-hidden>
                <path
                  d="M2 4h76"
                  stroke="var(--domain-roadtrip)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontWeight: 800 }}>{t("roadtrips:timeline.leg.road")}</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === "ferry"}
              onClick={() => setMode("ferry")}
              style={tile(mode === "ferry", "var(--domain-cruise)")}
            >
              <svg width="80" height="8" aria-hidden>
                <path
                  d="M2 4h76"
                  stroke="var(--domain-cruise)"
                  strokeWidth="3"
                  strokeDasharray="1 7"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontWeight: 800 }}>{t("roadtrips:timeline.leg.ferry")}</span>
            </button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend className="t-caption" style={{ marginBottom: 8 }}>
            {t("roadtrips:legDialog.line")}
          </legend>
          {lines.map((l) => {
            const on = l.id === effectiveLine;
            return (
              <label
                key={l.id}
                className="flex items-center"
                style={{
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: "var(--ts-radius-button)",
                  border: `1px solid ${on ? "color-mix(in srgb, var(--ts-accent) 45%, transparent)" : "var(--ts-border)"}`,
                  background: on ? "var(--ts-tile)" : "transparent",
                  opacity: l.off ? 0.5 : 1,
                  cursor: l.off ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="radio"
                  name="leg-line"
                  value={l.id}
                  checked={on}
                  disabled={l.off}
                  onChange={() => setLine(l.id)}
                />
                <span className="flex flex-col" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{l.label}</span>
                  <span className="t-caption">{l.hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <p className="t-caption">
          {t("roadtrips:legDialog.distance", { km: nf.format(leg.distanceKm) })}
        </p>
        <FormErrorBanner
          message={failure.failureKey ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey && isTransientSaveError(failure.failureKey)
              ? () => void apply()
              : undefined
          }
          retryDisabled={saving}
        />
        {fallback !== null && (
          <div role="alert" className="flex flex-col" style={{ gap: 4, fontSize: 13 }}>
            <span style={{ color: "var(--ts-warn)", fontWeight: 700 }}>
              {t("roadtrips:legDialog.fallback", {
                reason: t(`trips:tours.routing.reason.${fallback}`),
              })}
            </span>
            <span className="t-caption">{t("roadtrips:legDialog.fallbackKept")}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
