import { useEffect, useMemo } from "react";
import { useTimeSliderStore } from "../../store/timeSliderStore";
import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import {
  computeCruiseLegDates,
  computeMonthlyBuckets,
  computeTimeRange,
  NO_ACTIVITY,
  type ActivityDates,
  flightVisibleFilter,
  flightVisibleLive,
  type CruiseLegDates,
  type MonthBucket,
} from "./timeSliderUtils";

const safeTime = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function useGlobeTimeSlider(
  flights: GeoJSONFeature[],
  cruises: Cruise[],
  activity: readonly ActivityDates[] = NO_ACTIVITY
) {
  // don't re-render the whole component. The store mode drives whether
  // flights / cruise legs / ports get filtered before they reach the
  // deck.gl layers.
  const sliderMode = useTimeSliderStore((s) => s.mode);
  const sliderCurrent = useTimeSliderStore((s) => s.currentDate);
  const sliderFilterStart = useTimeSliderStore((s) => s.filterStart);
  const sliderFilterEnd = useTimeSliderStore((s) => s.filterEnd);
  const setSliderRange = useTimeSliderStore((s) => s.setRange);

  // Push the data-driven [min, max] into the store every time flights
  // or cruises change identity. The store dedupes if the bounds didn't
  // actually move, so this stays O(1) on the hot selection-change path.
  useEffect(() => {
    const range = computeTimeRange(flights, cruises, activity);
    if (range) setSliderRange(range.min, range.max);
  }, [flights, cruises, activity, setSliderRange]);

  // Monthly activity buckets for the time histogram (every domain with dated entries).
  const monthBuckets = useMemo<MonthBucket[]>(() => {
    const range = computeTimeRange(flights, cruises, activity);
    return range ? computeMonthlyBuckets(flights, cruises, range.min, range.max, activity) : [];
  }, [flights, cruises, activity]);

  // Per-leg date metadata for every cruise. Computed once per cruises
  // identity. Keyed by cruiseId so the live-mode partial-draw can pair
  // a leg's geometry with its (start, end) dates in O(1).
  const cruiseLegDatesByCruise = useMemo<Map<string, CruiseLegDates[]>>(() => {
    const out = new Map<string, CruiseLegDates[]>();
    for (const c of cruises) out.set(c.id, computeCruiseLegDates(c));
    return out;
  }, [cruises]);

  // The pre-aggregation flight set, filtered by slider state. The arc
  // builder downstream still groups same-route flights together so a
  // city pair only renders one arc however many flights are visible.
  const filteredFlights = useMemo<GeoJSONFeature[]>(() => {
    if (sliderMode === "off") return flights;
    if (sliderMode === "live") {
      if (!sliderCurrent) return flights;
      return flights.filter((f) => flightVisibleLive(f, sliderCurrent));
    }
    if (!sliderFilterStart || !sliderFilterEnd) return flights;
    return flights.filter((f) => flightVisibleFilter(f, sliderFilterStart, sliderFilterEnd));
  }, [flights, sliderMode, sliderCurrent, sliderFilterStart, sliderFilterEnd]);

  // Live playback (forgejo#352): the arcs are aggregated ONCE over every dated
  // flight and the GPU hides what has not departed yet, instead of re-filtering,
  // re-aggregating and re-tessellating ten times a second. `arcFlights` therefore
  // does not depend on the cursor; `filteredFlights` still does and feeds every
  // number that is read off the screen (stats card, histogram, airports).
  const arcTimeline = sliderMode === "live" && sliderCurrent !== null;
  const arcFlights = useMemo<GeoJSONFeature[]>(
    () => (arcTimeline ? flights.filter((f) => safeTime(f.properties.departureTime) !== null) : []),
    [flights, arcTimeline]
  );
  return {
    arcTimeline,
    arcFlights: arcTimeline ? arcFlights : filteredFlights,
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
    monthBuckets,
    cruiseLegDatesByCruise,
    filteredFlights,
  };
}
