import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { emptyReasons } from "./trackEmptyReason";
import { pillStyle } from "./trackMapStyle";
import type { DayResult } from "./trackRange";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * A day or range with nothing drawn says WHY, each reason with its own action: nothing was
 * recorded (check the Companion or an import), a privacy zone hides it (zone settings), or
 * the fixes were filtered as implausible (show them). A range read carries no reason, so it
 * says only what it knows. A failed read is never shown here: it has its own message and retry.
 */
export default function TrackEmptyReasons({
  long,
  single,
  loaded,
  shownImplausible,
  onShowImplausible,
}: {
  long: boolean;
  /** One day, so the text says "this day". */
  single: boolean;
  loaded: readonly Loaded[];
  shownImplausible: boolean;
  onShowImplausible: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const action = {
    ...pillStyle(false, coarse ? 44 : 36),
    display: "inline-flex",
    alignItems: "center",
  };
  const reasons = long ? [] : emptyReasons(loaded, shownImplausible);
  const scope = single ? "day" : "range";
  return (
    <div className="flex flex-col gap-2" data-testid="track-day-empty">
      {reasons.length === 0 || reasons[0].kind === "unknown" ? (
        <p className="t-body">{t(single ? "track:day.empty" : "track:map.rangeEmpty")}</p>
      ) : (
        reasons.map((r) =>
          r.kind === "unknown" ? null : (
            <div key={r.kind} className="flex flex-col items-start gap-1" data-reason={r.kind}>
              <p className="t-body">
                {r.kind === "noRecording"
                  ? t(`track:empty.${scope}.noRecording`)
                  : r.kind === "privacyZone"
                    ? t(`track:empty.${scope}.privacyZone`, { count: r.count })
                    : t(`track:empty.${scope}.implausible`, { count: r.count })}
              </p>
              {r.kind === "noRecording" && (
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/settings/telefone#devices"
                    style={action}
                    data-testid="track-empty-companion"
                  >
                    {t("track:empty.actions.companion")}
                  </Link>
                  <Link to="/track/imports" style={action} data-testid="track-empty-import">
                    {t("track:empty.actions.import")}
                  </Link>
                </div>
              )}
              {r.kind === "privacyZone" && (
                <Link to="/settings/tt-aufz#ttZones" style={action} data-testid="track-empty-zones">
                  {t("track:empty.actions.zones")}
                </Link>
              )}
              {r.kind === "implausible" && (
                <button
                  type="button"
                  onClick={onShowImplausible}
                  style={action}
                  data-testid="track-empty-show-filtered"
                >
                  {t("track:empty.actions.showFiltered")}
                </button>
              )}
            </div>
          )
        )
      )}
    </div>
  );
}
