import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { trackErrorKey } from "../../../lib/api/travtrack";
import {
  PICKABLE_MODES,
  travTrackLegsApi,
  type PickableMode,
  type TravTrackLeg,
} from "../../../lib/api/travtrackLegs";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import { legFigures, legModeLabel, makeNumber, spanText } from "./trackLegFormat";
import { panelStyle, pillStyle } from "./trackMapStyle";

/**
 * One leg in numbers (spec 2026-11-03-travtrack-legs, W1/W2): its mode and
 * where that mode came from, the figures (a dash where the server could not
 * derive one), the logbook entry behind it, and the mode chips. A chip writes
 * the correction to the server and only then does the leg change — a failed
 * save toasts that it was not saved and the card keeps the server's mode.
 */
export default function TrackLegCard({
  leg,
  zone,
  entryHref,
  onClose,
  onChanged,
  onReplay,
  pointsShown,
  onTogglePoints,
}: {
  leg: TravTrackLeg;
  zone: string;
  /** The logbook page of `leg.entryRef`, when the day's timeline names it. */
  entryHref: string | null;
  onClose: () => void;
  /** Reads the day again after a saved correction. */
  onChanged: () => Promise<void>;
  /** Starts the replay limited to this leg; null where there is nothing to replay (or no replay at this span). */
  onReplay: (() => void) | null;
  /** Whether the leg's vertices are drawn as markers. */
  pointsShown: boolean;
  onTogglePoints: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [busy, setBusy] = useState(false);
  const number = makeNumber(i18n.language);

  const choose = async (mode: PickableMode | null) => {
    setBusy(true);
    try {
      await travTrackLegsApi.setMode({ fromMs: leg.fromMs, untilMs: leg.untilMs }, mode);
    } catch (err: unknown) {
      logger.warn("TravTrack leg mode could not be saved", err);
      useToastStore
        .getState()
        .addToast("error", t("track:legs.modeFailed", { reason: t(trackErrorKey(err)) }), 8000);
      // The leg is gone (re-derived after late points): read the day so the stale one goes.
      if (apiErrorMachineCode(err) === "TRAVTRACK_LEG_NOT_FOUND") await onChanged().catch(() => {});
      setBusy(false);
      return;
    }
    try {
      await onChanged();
    } catch (err: unknown) {
      logger.warn("TravTrack day could not be read after a leg correction", err);
      useToastStore.getState().addToast("warning", t("track:legs.reloadFailed"), 8000);
    } finally {
      setBusy(false);
    }
  };

  const manual = leg.modeSource === "manual";
  return (
    <div
      role="dialog"
      aria-label={t("track:legs.cardTitle")}
      data-testid="track-leg-card"
      className="flex flex-col gap-2"
      style={{ ...panelStyle, padding: 14, width: 320, maxWidth: "100%" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="t-card-title" data-testid="track-leg-mode">
          {legModeLabel(leg, t)}
        </h3>
        <span className="t-caption tabular-nums">{spanText(leg.fromMs, leg.untilMs, zone, t)}</span>
      </div>
      <p className="t-caption" data-testid="track-leg-source">
        {t(`track:legs.source.${leg.modeSource}`)}
        {entryHref && (
          <>
            {" · "}
            <Link to={entryHref}>{t("track:legs.openEntry")}</Link>
          </>
        )}
      </p>
      <dl className="grid grid-cols-2 gap-2" data-testid="track-leg-figures">
        {legFigures(leg, t, number).map(({ key, value }) => (
          <div
            key={key}
            data-figure={key}
            style={{ background: token("surface2"), borderRadius: 10, padding: 8 }}
          >
            <dt className="t-caption">{t(`track:legs.figure.${key}`)}</dt>
            <dd className="tabular-nums" style={{ fontWeight: 700 }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div role="group" aria-label={t("track:legs.modeGroup")} className="flex flex-wrap gap-2">
        {PICKABLE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={busy}
            aria-pressed={manual && leg.mode === mode}
            data-mode={mode}
            onClick={() => void choose(mode)}
            style={pillStyle(manual && leg.mode === mode, coarse ? 44 : 36)}
          >
            {t(`track:legs.mode.${mode}`)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          aria-pressed={!manual}
          data-mode="auto"
          onClick={() => void choose(null)}
          style={pillStyle(!manual, coarse ? 44 : 36)}
        >
          {t("track:legs.mode.auto")}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {onReplay && (
          <button
            type="button"
            data-testid="track-leg-replay"
            onClick={onReplay}
            style={pillStyle(false, coarse ? 44 : 36)}
          >
            {t("track:legs.replay")}
          </button>
        )}
        <button
          type="button"
          data-testid="track-leg-points"
          aria-pressed={pointsShown}
          onClick={onTogglePoints}
          style={pillStyle(pointsShown, coarse ? 44 : 36)}
        >
          {t(pointsShown ? "track:legs.hidePoints" : "track:legs.showPoints")}
        </button>
      </div>
      <button
        type="button"
        className="underline"
        onClick={onClose}
        style={{ alignSelf: "flex-start", minHeight: coarse ? 44 : 32 }}
      >
        {t("track:legs.wholeDay")}
      </button>
    </div>
  );
}
