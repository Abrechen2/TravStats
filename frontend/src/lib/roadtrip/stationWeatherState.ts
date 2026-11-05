import { WEATHER_SERVICE_FAILURES, type WeatherOutcome } from "../api/openData";
import type { RoadtripStation, StationWeather } from "../../types/roadtrip";
import { dayKey } from "./roadtripView";

/** What the page knows about one station's weather. */
export interface StationWeatherState {
  /** The day and point the lookup was for; a station edited since no longer matches it. */
  sig?: string;
  /** The last measurement obtained; null if none ever was. */
  weather: StationWeather | null;
  /** Why the latest lookup brought no new weather; null when it did. */
  problem: WeatherOutcome | null;
}

/**
 * The state after a lookup. A failure of the weather SERVICE (`timeout`,
 * `rateLimited`, `unavailable`) says nothing about the day, so the measurement
 * already held stays; an answer about the day or the station replaces it —
 * a value for a day that has since no weather would be a stale claim.
 */
export function afterLookup(
  prev: StationWeatherState | undefined,
  outcome: WeatherOutcome,
  weather: StationWeather | null,
  sig?: string
): StationWeatherState {
  if (outcome === "observed" && weather) return { weather, problem: null, sig };
  // What was held for another day or point is not this station's to keep.
  const held = prev && prev.sig === sig ? prev.weather : null;
  if (WEATHER_SERVICE_FAILURES.has(outcome)) return { weather: held, problem: outcome, sig };
  return { weather: null, problem: outcome, sig };
}

/** What a lookup depends on: the arrival day and the point. */
export function weatherSig(s: Pick<RoadtripStation, "startDate" | "lat" | "lon">): string {
  return `${dayKey(s.startDate) ?? ""}|${s.lat ?? ""}|${s.lon ?? ""}`;
}

/**
 * The stations whose weather can be asked: placed, dated, and their arrival
 * day already past — today and later have no measurement, and asking for them
 * would only fill the page with "not yet". Route corrections are no station.
 */
export function weatherStations(
  stations: readonly RoadtripStation[],
  today: string
): RoadtripStation[] {
  return stations.filter((s) => {
    const day = dayKey(s.startDate);
    return s.state !== "via" && s.lat !== null && s.lon !== null && day !== null && day < today;
  });
}
