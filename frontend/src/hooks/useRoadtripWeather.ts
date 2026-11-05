import { useCallback, useMemo, useRef, useState } from "react";

import { roadtripsApi } from "../lib/api/roadtrips";
import { logger } from "../lib/logger";
import {
  afterLookup,
  weatherSig,
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
  const [held, setHeld] = useState<ReadonlyMap<string, StationWeatherState>>(new Map());
  const [running, setRunning] = useState(false);
  const [asked, setAsked] = useState(false);
  const busy = useRef(false);
  const eligible = weatherStations(stations, today);
  // A measurement belongs to the day and point it was asked for: a station
  // edited since no longer shows (or keeps) the old one.
  const byStation = useMemo(() => {
    const current = new Map<string, StationWeatherState>();
    for (const s of stations) {
      const state = held.get(s.id);
      if (state && state.sig === weatherSig(s)) current.set(s.id, state);
    }
    return current;
  }, [held, stations]);

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
            // Our own limiter answers 429 before Open-Meteo is asked at all:
            // the rest would be refused the same way.
            outcome =
              (err as { response?: { status?: number } }).response?.status === 429
                ? "rateLimited"
                : "unavailable";
          }
        }
        if (outcome === "rateLimited") limited = true;
        const sig = weatherSig(station);
        setHeld((prev) =>
          new Map(prev).set(station.id, afterLookup(prev.get(station.id), outcome, weather, sig))
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
