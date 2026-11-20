import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { JSX, ReactNode } from "react";
import { token } from "../../../components/ui/tokens";
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
 * What the day card remembers while it is re-created: rotating a tablet moves it between the
 * docked column and the sheet, which are two different places in the tree. The owner (the map
 * view) holds this, so the tab and the scroll position survive the move.
 */
export interface AsideMemory {
  tab: Tab;
  scrollTop: number;
}
export const newAsideMemory = (): AsideMemory => ({ tab: "legs", scrollTop: 0 });

/** Restores `memory.scrollTop` on the scrolling parent of `root` and records every scroll. */
function useScrollMemory(
  memory: AsideMemory,
  root: MutableRefObject<HTMLElement | null>,
  docked: boolean,
  active: boolean
): void {
  useEffect(() => {
    // Docked: the list scrolls in its own region. Floating: the card's body scrolls.
    const el = docked ? root.current : (root.current?.parentElement ?? null);
    if (!el || !active) return;
    el.scrollTop = memory.scrollTop;
    const onScroll = (): void => {
      memory.scrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [memory, root, docked, active]);
}

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
  docked = false,
  memory,
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
  /**
   * A tablet held landscape: the card is a column beside the map, the legs and stops stay in
   * it and the selected thing's detail sits above them instead of replacing them.
   */
  docked?: boolean;
  memory?: AsideMemory;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const own = useRef<AsideMemory>(newAsideMemory());
  const kept = memory ?? own.current;
  const [tab, setTabState] = useState<Tab>(kept.tab);
  const setTab = (next: Tab): void => {
    kept.tab = next;
    setTabState(next);
  };
  const root = useRef<HTMLDivElement | null>(null);
  useScrollMemory(kept, root, docked, docked || !detail);
  // A selection made on the map shows in the docked list.
  useEffect(() => {
    if (!docked) return;
    root.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"][data-testid$="-row"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [docked, selection]);
  const multi = span.kind !== "day";
  // In a week, a day with nothing recorded and nothing known is one name in a line, not a card.
  const isQuiet = (r: Loaded) => r.day.pointCount === 0 && r.day.context.length === 0;
  const quiet = loaded.filter(isQuiet);
  const busy = loaded.filter((r) => !isQuiet(r));
  const days = multi ? busy : loaded;
  const hasLegs = loaded.some((r) => (r.day.legs?.length ?? 0) + (r.day.stops?.length ?? 0) > 0);
  const list = (
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
            <TrackCoverageBar coverage={r.day.coverage} zone={r.day.zone} context={r.day.context} />
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
  );
  if (docked) {
    return (
      <section
        data-testid="track-day-card"
        data-docked="true"
        aria-label={t("track:map.dayCard.title")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <h2 className="t-card-title" style={{ padding: "10px 14px 6px", flexShrink: 0 }}>
          {t("track:map.dayCard.title")}
        </h2>
        {detail && (
          <div
            className="flex flex-col gap-3 overflow-y-auto"
            data-testid="track-detail"
            style={{
              flexShrink: 0,
              maxHeight: "45%",
              padding: "0 14px 12px",
              borderBottom: `1px solid ${token("border")}`,
            }}
          >
            {detail}
          </div>
        )}
        <div
          ref={root}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          data-testid="track-docked-list"
          style={{ padding: "8px 14px 14px" }}
        >
          {list}
        </div>
      </section>
    );
  }
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
        <div ref={root} className="flex flex-col gap-3">
          {list}
        </div>
      )}
    </TrackFloatingCard>
  );
}
