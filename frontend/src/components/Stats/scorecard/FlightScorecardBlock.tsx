import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
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
  if (window === "year") return { period: "year", year: selectedYear ?? undefined };
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
  const tiles: ScorecardTileVM[] = [
    {
      key: "flights",
      label: t("stats:scorecard.flights"),
      value: String(cur.count),
      takeaway,
      points: counts,
      current: cur.count,
      previous: prev.count,
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
      evidence: { kind: "metric", key: "scorecardFlightTimeMinutes", scope },
    },
  ];
  return (
    <>
      <TimeRangeControl value={rangeWindow} onChange={onRangeChange} />
      <KpiScorecard tiles={tiles} />
      <CanonicalTimeSeries
        series={timeseries?.series ?? []}
        title={t("stats:canonicalChart.flightsTitle")}
      />
    </>
  );
}
