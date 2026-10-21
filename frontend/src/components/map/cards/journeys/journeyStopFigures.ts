// What a station, terminal, port or rental branch card adds about the place
// itself (owner, 2026-10-21): departures from here, where they went, and the
// last time the user was here. Pure; counted over the journeys that HAPPENED,
// like the hero tally, so the two cannot disagree.

import type { TimeValue } from "../../../../shared/time";
import { endKey } from "./journeyStats";
import type { MapJourney } from "./journeyTypes";

export interface StopDestination {
  name: string;
  count: number;
}

export interface JourneyStopFigures {
  /** Travelled journeys that started here (a rental: picked up here). */
  departures: number;
  /** Travelled journeys that ended here (a rental: returned here). */
  arrivals: number;
  /** Where the departures from here went, most frequent first, at most three. */
  destinations: StopDestination[];
  /** The last time the user was HERE, on this place's clock; null when undated. */
  lastVisit: TimeValue | null;
}

const MAX_DESTINATIONS = 3;

export function getJourneyStopFigures(
  journeys: readonly MapJourney[],
  stopKey: string
): JourneyStopFigures {
  let departures = 0;
  let arrivals = 0;
  const destinations = new Map<string, StopDestination>();
  let lastVisit: TimeValue | null = null;
  for (const j of journeys) {
    if (!j.travelled) continue;
    const startsHere = endKey(j.dep) === stopKey;
    const endsHere = endKey(j.arr) === stopKey;
    if (startsHere) departures += 1;
    if (endsHere) arrivals += 1;
    if (startsHere && !endsHere) {
      const key = endKey(j.arr);
      const entry = destinations.get(key) ?? { name: j.arr.name, count: 0 };
      destinations.set(key, { ...entry, count: entry.count + 1 });
    }
    // Leaving, the visit is the departure; arriving (or bringing a rental
    // back), the arrival — the later of the two that are known. An arrival
    // without a time is not dated by its departure: abstain instead.
    for (const here of [startsHere ? j.departure : null, endsHere ? j.arrival : null]) {
      if (here && (!lastVisit || Date.parse(here.utc) > Date.parse(lastVisit.utc))) {
        lastVisit = here;
      }
    }
  }
  return {
    departures,
    arrivals,
    destinations: [...destinations.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, MAX_DESTINATIONS),
    lastVisit,
  };
}
