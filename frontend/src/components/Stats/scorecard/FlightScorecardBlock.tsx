import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { comparisonWindow } from "../../../lib/stats/comparisonWindow";
import { useSettingsStore } from "../../../store/settingsStore";
import { formatDistance, formatHours } from "../../../lib/units";
import type { TimeseriesResponse } from "../../../lib/api/types";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import KpiScorecard from "./KpiScorecard";
import type { ScorecardTileVM } from "./ScorecardTile";
import TimeRangeControl, { type WindowKind } from "./TimeRangeControl";
import CanonicalTimeSeries from "./CanonicalTimeSeries";

/**
 * `WindowKind`'s `"all"` is this component's own spelling; the evidence
 * contract (mirrored backend/frontend, `shared/evidence.ts`) spells the same
 * period `"allTime"`. Two vocabularies for one thing, so one function
 * translates rather than leaving every caller to remember the mismatch.
 */
function scorecardScope(window: WindowKind, selectedYear: number | null): EvidenceScopeParams {
  // `selectedYear` is legitimately null — the page's year picker sits on "all
  // years" — but the tile still SHOWS a year, because `resolveWindow`
  // (`utils/stats/timeseries.ts`) falls back to the current UTC year for
  // `window === "year"`. Sending `year: undefined` asked the evidence
  // endpoint for a scope its schema rejects (`period=year` requires a year),
  // so the tile rendered a number and then answered 400 when clicked. The
  // default has to be the SAME one the tile measured with, not merely a
  // valid year.
  if (window === "year") {
    return { period: "year", year: selectedYear ?? new Date().getUTCFullYear() };
  }
  if (window === "all") return { period: "allTime" };
  return { period: "rolling12m" };
}

interface FlightScorecardBlockProps {
  timeseries: TimeseriesResponse | null;
  rangeWindow: WindowKind;
  onRangeChange: (w: WindowKind) => void;
  /** The page's year picker — "year" reuses it, so there is no second one here. */
  selectedYear: number | null;
}

/**
 * Scorecard: time-range control + KPI tiles + canonical chart. Replaces the
 * old separate "Yearly Trend"/"Monthly Flights" charts with one range-driven
 * view. The tiles are derived from the canonical timeseries the page fetches
 * for the chosen window; this block only shapes them.
 */
export default function FlightScorecardBlock({
  timeseries,
  rangeWindow,
  onRangeChange,
  selectedYear,
}: FlightScorecardBlockProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const { units } = useSettingsStore();

  const takeaway =
    rangeWindow === "rolling12m"
      ? t("stats:scorecard.takeawayRolling")
      : rangeWindow === "year"
        ? t("stats:scorecard.takeawayYear", { year: selectedYear ?? "" })
        : t("stats:scorecard.takeawayAll");
  const counts = timeseries?.series.map((p) => p.count) ?? [];
  const distances = timeseries?.series.map((p) => Math.round(p.distanceKm)) ?? [];
  const durations = timeseries?.series.map((p) => Math.round(p.durationMin / 60)) ?? [];
  const cur = timeseries?.current ?? { count: 0, distanceKm: 0, durationMin: 0 };
  const prev = timeseries?.previous ?? { count: 0, distanceKm: 0, durationMin: 0 };
  const scope = scorecardScope(rangeWindow, selectedYear);

  // The "Jahr" range sets this year against the WHOLE previous calendar year
  // (`resolveWindow` in the backend's `utils/stats/timeseries.ts`), so in
  // September the pill reads "-78 %" for eight months against twelve. The
  // rolling range does not have the problem: its two windows are the same
  // length by construction, and "all" has no previous window at all.
  //
  // The figures come from the server and this component cannot narrow them —
  // a true same-period comparison needs the timeseries endpoint to accept an
  // END DATE, not just a window kind. Until it does, the pill says what it is
  // comparing instead of presenting it as like-for-like.
  // `null` for every range but "year" — the same fallback `scorecardScope`
  // makes, because the tile shows a year even when the page's picker is on
  // "all years".
  const scorecardYear =
    rangeWindow === "year" ? (selectedYear ?? new Date().getUTCFullYear()) : null;
  // `null` as the compare year: this range always sets a year against the one
  // before it, whatever the page's compare picker says.
  const runningYear =
    scorecardYear === null ? null : comparisonWindow(scorecardYear, null).runningYear;
  const compareLabel =
    scorecardYear === null || runningYear === null
      ? undefined
      : t("stats:yearFilter.vsFullYear", { year: scorecardYear - 1 });
  const tiles: ScorecardTileVM[] = [
    {
      key: "flights",
      label: t("stats:scorecard.flights"),
      value: String(cur.count),
      takeaway,
      points: counts,
      current: cur.count,
      previous: prev.count,
      compareLabel,
      evidence: { kind: "metric", key: "scorecardFlightCount", scope },
    },
    {
      key: "distance",
      label: t("stats:scorecard.distance"),
      value: formatDistance(cur.distanceKm, units.distanceUnit, t, i18n.language),
      takeaway,
      points: distances,
      current: cur.distanceKm,
      previous: prev.distanceKm,
      compareLabel,
      evidence: { kind: "metric", key: "scorecardDistanceKm", scope },
    },
    {
      key: "flightTime",
      label: t("stats:scorecard.flightTime"),
      value: formatHours(cur.durationMin / 60, i18n.language),
      takeaway,
      points: durations,
      current: cur.durationMin,
      previous: prev.durationMin,
      compareLabel,
      evidence: { kind: "metric", key: "scorecardFlightTimeMinutes", scope },
    },
  ];
  return (
    <>
      <TimeRangeControl value={rangeWindow} onChange={onRangeChange} />
      <KpiScorecard tiles={tiles} />
      {runningYear !== null && (
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          {t("stats:yearFilter.partialYearNote", { year: runningYear })}
        </p>
      )}
      <CanonicalTimeSeries
        series={timeseries?.series ?? []}
        title={t("stats:canonicalChart.flightsTitle")}
      />
    </>
  );
}
