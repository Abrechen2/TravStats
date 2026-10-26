import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDayLong } from "../../../shared/time/calendar";
import TrackCoverageBar from "../TrackCoverageBar";
import TrackTimeline from "../TrackTimeline";
import type { SelectedFlight } from "../flight/TrackFlightPanel";
import TrackTotalsPanel from "./TrackTotalsPanel";
import type { RangeTotals } from "./trackGeometry";
import { panelStyle } from "./trackMapStyle";
import type { DayResult } from "./trackRange";
import type { TrackSpan } from "./trackSpan";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * Beside the map: the span's totals, then for a day or a week each day's
 * coverage and the logbook's timeline (a flight in it opens the flight
 * panel). A month, a year or a Zeitraum has no per-day labels — the range
 * read is the line alone — so the aside says where the days are.
 */
export default function TrackMapAside({
  span,
  totals,
  loaded,
  long,
  flightId,
  onFlight,
}: {
  span: TrackSpan;
  totals: RangeTotals;
  loaded: readonly Loaded[];
  long: boolean;
  flightId: string | null;
  onFlight: (flight: SelectedFlight) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const multi = span.kind !== "day";
  // In a week, a day with nothing recorded and nothing known is one name in a line, not a card.
  const isQuiet = (r: Loaded) => r.day.pointCount === 0 && r.day.context.length === 0;
  const quiet = loaded.filter(isQuiet);
  const busy = loaded.filter((r) => !isQuiet(r));
  return (
    <aside className="flex flex-col gap-3" style={{ flex: "1 1 280px", maxWidth: 360 }}>
      <TrackTotalsPanel totals={totals} />
      {long && (
        <p className="t-caption" style={panelStyle} data-testid="track-range-days-note">
          {t("track:map.rangeNoTimeline")}
        </p>
      )}
      {multi && quiet.length > 0 && (
        <p className="t-caption" style={panelStyle} data-testid="track-quiet-days">
          {t("track:map.quietDays", {
            days: quiet
              .map((r) =>
                formatDayLong(r.date, i18n.language, { weekday: "short", day: "numeric" })
              )
              .join(", "),
          })}
        </p>
      )}
      {(multi ? busy : loaded).map((r) => (
        <section key={r.date} className="flex flex-col gap-3" style={panelStyle}>
          {multi && <h2 className="t-card-title">{formatDayLong(r.date, i18n.language)}</h2>}
          <TrackCoverageBar coverage={r.day.coverage} zone={r.day.zone} />
          <TrackTimeline day={r.day} onFlight={onFlight} selectedFlightId={flightId} />
        </section>
      ))}
    </aside>
  );
}
