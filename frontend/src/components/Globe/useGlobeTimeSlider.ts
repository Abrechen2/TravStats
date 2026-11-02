import { useEffect, useMemo } from "react";
import { useTimeSliderStore } from "../../store/timeSliderStore";
import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import {
  computeCruiseLegDates,
  computeMonthlyBuckets,
  computeTimeRange,
  flightVisibleFilter,
  flightVisibleLive,
  type CruiseLegDates,
  type MonthBucket,
} from "./timeSliderUtils";

export function useGlobeTimeSlider(flights: GeoJSONFeature[], cruises: Cruise[]) {
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
    const range = computeTimeRange(flights, cruises);
    if (range) setSliderRange(range.min, range.max);
  }, [flights, cruises, setSliderRange]);

  // Monthly activity buckets for the time histogram (flights + cruises).
  const monthBuckets = useMemo<MonthBucket[]>(() => {
    const range = computeTimeRange(flights, cruises);
    return range ? computeMonthlyBuckets(flights, cruises, range.min, range.max) : [];
  }, [flights, cruises]);

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
  return {
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
    monthBuckets,
    cruiseLegDatesByCruise,
    filteredFlights,
  };
}
