import { useCallback, useRef, useState } from "react";

import { roadtripsApi } from "../lib/api/roadtrips";
import { logger } from "../lib/logger";
import {
  afterLookup,
  weatherStations,
  type StationWeatherState,
} from "../lib/roadtrip/stationWeatherState";
import type { RoadtripStation } from "../types/roadtrip";

/**
 * The measured weather of a roadtrip's past stations, asked on request and one
 * station after another (each is an Open-Meteo call). Once the weather
 * service answers 429 the rest is not asked — they are marked `rateLimited`
 * and keep what they had. A lookup that fails never removes a measurement
 * already shown (`afterLookup`).
 */
export function useRoadtripWeather(
  routeId: string,
  stations: readonly RoadtripStation[],
  today: string
): {
  byStation: ReadonlyMap<string, StationWeatherState>;
  running: boolean;
  asked: boolean;
  eligible: number;
  load: () => Promise<void>;
} {
  const [byStation, setByStation] = useState<ReadonlyMap<string, StationWeatherState>>(new Map());
  const [running, setRunning] = useState(false);
  const [asked, setAsked] = useState(false);
  const busy = useRef(false);
  const eligible = weatherStations(stations, today);

  const load = useCallback(async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setAsked(true);
    let limited = false;
    try {
      for (const station of weatherStations(stations, today)) {
        let outcome: Awaited<ReturnType<typeof roadtripsApi.stationWeather>>["outcome"];
        let weather = null;
        if (limited) {
          outcome = "rateLimited";
        } else {
          try {
            ({ outcome, weather } = await roadtripsApi.stationWeather(routeId, station.id));
          } catch (err) {
            logger.warn("Loading a roadtrip station's weather failed", err);
            outcome = "unavailable";
          }
        }
        if (outcome === "rateLimited") limited = true;
        setByStation((prev) =>
          new Map(prev).set(station.id, afterLookup(prev.get(station.id), outcome, weather))
        );
        // The switch is off for everyone: no point asking the other stations.
        if (outcome === "disabled") break;
      }
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [routeId, stations, today]);

  return { byStation, running, asked, eligible: eligible.length, load };
}
