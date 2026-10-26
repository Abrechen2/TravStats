import { useEffect, useState } from "react";
import type { Feature, Geometry } from "geojson";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackMonthsApi } from "../../../lib/api/travtrackMonths";
import { loadWorldCountries } from "../../../lib/geo/worldCountries";
import { logger } from "../../../lib/logger";
import { visitedCountriesOf, visitedShapes, yearsOfSpan } from "./visitedCountries";

export type CountriesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; codes: string[]; pending: string[]; shapes: Feature<Geometry>[] }
  | { kind: "failed"; key: string };

/**
 * The countries layer's data while it is on: the touched years' monthly
 * values and the shipped boundaries. Read again with the map's generation (a
 * deletion changes the months). A failure is its own reason, never an empty
 * layer: no country coloured would read as "nowhere".
 */
export function useVisitedCountries(
  span: { fromDay: string; toDay: string } | null,
  generation = 0
): CountriesState {
  const [state, setState] = useState<CountriesState>({ kind: "idle" });
  const fromDay = span?.fromDay;
  const toDay = span?.toDay;
  useEffect(() => {
    if (!fromDay || !toDay) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    const values = Promise.all(
      yearsOfSpan(fromDay, toDay).map((y) => travTrackMonthsApi.months(y))
    );
    values
      .then(async (years) => {
        const visited = visitedCountriesOf(years, fromDay, toDay);
        let world;
        try {
          world = await loadWorldCountries();
        } catch (err: unknown) {
          logger.warn("Country shapes could not be loaded", err);
          if (live) setState({ kind: "failed", key: "track:map.countries.shapesFailed" });
          return;
        }
        if (live) {
          setState({ kind: "loaded", ...visited, shapes: visitedShapes(world, visited.codes) });
        }
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack countries could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [fromDay, toDay, generation]);
  return state;
}
