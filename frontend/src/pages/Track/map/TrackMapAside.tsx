import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDayLong } from "../../../shared/time/calendar";
import TrackCoverageBar from "../TrackCoverageBar";
import TrackLegList from "../TrackLegList";
import TrackTimeline from "../TrackTimeline";
import type { SelectedFlight } from "../flight/TrackFlightPanel";
import TrackFloatingCard from "./TrackFloatingCard";
import type { TrackSelection } from "./trackLegs";
import { pillStyle } from "./trackMapStyle";
import type { DayResult } from "./trackRange";
import type { TrackSpan } from "./trackSpan";

type Loaded = Extract<DayResult, { kind: "loaded" }>;
type Tab = "legs" | "log";
const TABS: Tab[] = ["legs", "log"];

/**
 * „Tagesverlauf", the right card (web redesign 2026-11-05): the tab „Etappen &
 * Stopps" lists each day's legs and stops, the tab „Logbuch" the timeline of
 * entries, trips and inbox suggestions (a flight in it opens the flight
 * panel). While something is selected — a leg, a stop, a point, a photo, a
 * flight — the card shows that detail instead (`detail`) and its own „Ganzer
 * Tag" returns. A month, a year or a Zeitraum has no per-day labels — the
 * range read is the line alone — so the card says where the days are.
 */
export default function TrackMapAside({
  span,
  loaded,
  long,
  flightId,
  onFlight,
  selection,
  onSelect,
  onStopPlaceChanged,
  detail,
  collapsed,
  onToggle,
}: {
  span: TrackSpan;
  loaded: readonly Loaded[];
  long: boolean;
  flightId: string | null;
  onFlight: (flight: SelectedFlight) => void;
  selection: TrackSelection | null;
  /** A stop of this day was named or un-named: read that day again. */
  onStopPlaceChanged?: (date: string) => void;
  onSelect: (selection: TrackSelection | null) => void;
  /** The selected thing's own view; replaces the tabs while present. */
  detail: ReactNode | null;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [tab, setTab] = useState<Tab>("legs");
  const multi = span.kind !== "day";
  // In a week, a day with nothing recorded and nothing known is one name in a line, not a card.
  const isQuiet = (r: Loaded) => r.day.pointCount === 0 && r.day.context.length === 0;
  const quiet = loaded.filter(isQuiet);
  const busy = loaded.filter((r) => !isQuiet(r));
  const days = multi ? busy : loaded;
  const hasLegs = loaded.some((r) => (r.day.legs?.length ?? 0) + (r.day.stops?.length ?? 0) > 0);
  return (
    <TrackFloatingCard
      testId="track-day-card"
      title={t("track:map.dayCard.title")}
      collapsed={collapsed}
      onToggle={onToggle}
      coarse={coarse}
      style={{ maxHeight: "100%" }}
    >
      {detail ? (
        <div className="flex flex-col gap-3" data-testid="track-detail">
          {detail}
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t("track:map.dayCard.tabs")}
            className="flex gap-1"
            style={{ flexShrink: 0 }}
          >
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                style={pillStyle(tab === id, coarse ? 44 : 36)}
              >
                {t(`track:map.dayCard.${id}`)}
              </button>
            ))}
          </div>
          {long && (
            <p className="t-caption" data-testid="track-range-days-note">
              {t("track:map.rangeNoTimeline")}
            </p>
          )}
          {multi && quiet.length > 0 && (
            <p className="t-caption" data-testid="track-quiet-days">
              {t("track:map.quietDays", {
                days: quiet
                  .map((r) =>
                    formatDayLong(r.date, i18n.language, { weekday: "short", day: "numeric" })
                  )
                  .join(", "),
              })}
            </p>
          )}
          {tab === "legs" && !long && !hasLegs && (
            <p className="t-caption" data-testid="track-no-legs">
              {t("track:map.dayCard.noLegs")}
            </p>
          )}
          {days.map((r) => (
            <section key={r.date} className="flex flex-col gap-3">
              {multi && <h2 className="t-card-title">{formatDayLong(r.date, i18n.language)}</h2>}
              {multi && (
                <TrackCoverageBar
                  coverage={r.day.coverage}
                  zone={r.day.zone}
                  context={r.day.context}
                />
              )}
              {tab === "legs" ? (
                (r.day.legs?.length ?? 0) + (r.day.stops?.length ?? 0) > 0 && (
                  <TrackLegList
                    date={r.date}
                    zone={r.day.zone}
                    legs={r.day.legs ?? []}
                    stops={r.day.stops ?? []}
                    selection={selection}
                    onSelect={onSelect}
                    onStopPlaceChanged={() => onStopPlaceChanged?.(r.date)}
                  />
                )
              ) : (
                <TrackTimeline day={r.day} onFlight={onFlight} selectedFlightId={flightId} />
              )}
            </section>
          ))}
        </>
      )}
    </TrackFloatingCard>
  );
}
