import { WEATHER_SERVICE_FAILURES, type WeatherOutcome } from "../api/openData";
import type { RoadtripStation, StationWeather } from "../../types/roadtrip";
import { dayKey } from "./roadtripView";

/** What the page knows about one station's weather. */
export interface StationWeatherState {
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
  weather: StationWeather | null
): StationWeatherState {
  if (outcome === "observed" && weather) return { weather, problem: null };
  if (WEATHER_SERVICE_FAILURES.has(outcome)) {
    return { weather: prev?.weather ?? null, problem: outcome };
  }
  return { weather: null, problem: outcome };
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
