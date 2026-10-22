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
  /** The last time the user was HERE, on this place's clock; null when undated or unknown. */
  lastVisit: TimeValue | null;
  /**
   * Set (and `lastVisit` null) when the latest ride that ended here has no
   * recorded arrival: the visit is on or after this day — the departure's day
   * — but which day is unknown, so no older visit may pass for the last one.
   */
  lastVisitUnknownFrom: TimeValue | null;
}

const MAX_DESTINATIONS = 3;

/** The value cut to its calendar day — shown without a time (ADR 0002 D3). */
function dayOnly(value: TimeValue): TimeValue {
  return value.precision === "minute" ? { ...value, precision: "day" } : value;
}

/**
 * A ride recorded by its date alone, by train or coach: the record says it
 * happened on that day, so the day is the arrival's too (beta.23 UAT,
 * München Hbf 01.07.2025). A timed departure, a ferry, a flight or a rental
 * says no such thing — an overnight ride arrives the next day.
 */
const DATE_ONLY_DAY_RIDE: ReadonlySet<MapJourney["domain"]> = new Set(["rail", "bus"]);

const later = (a: TimeValue | null, b: TimeValue | null): boolean =>
  a !== null && (b === null || Date.parse(a.utc) > Date.parse(b.utc));

export function getJourneyStopFigures(
  journeys: readonly MapJourney[],
  stopKey: string
): JourneyStopFigures {
  let departures = 0;
  let arrivals = 0;
  const destinations = new Map<string, StopDestination>();
  let lastVisit: TimeValue | null = null;
  let unknownFrom: TimeValue | null = null;
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
    // never recorded is not skipped (that let an older visit pass for the
    // last one, beta.23 UAT): a date-only train or coach ride is dated by its
    // day; any other is a visit on an unknown day from the departure's on.
    let arrived = endsHere ? j.arrival : null;
    if (endsHere && !arrived && j.departure) {
      if (j.departure.precision === "day" && DATE_ONLY_DAY_RIDE.has(j.domain)) {
        arrived = j.departure;
      } else if (later(dayOnly(j.departure), unknownFrom)) {
        unknownFrom = dayOnly(j.departure);
      }
    }
    for (const here of [startsHere ? j.departure : null, arrived]) {
      if (later(here, lastVisit)) lastVisit = here;
    }
  }
  // The unknown arrival stands unless a known visit came after its departure.
  const unknown = unknownFrom !== null && !later(lastVisit, unknownFrom);
  return {
    departures,
    arrivals,
    destinations: [...destinations.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, MAX_DESTINATIONS),
    lastVisit: unknown ? null : lastVisit,
    lastVisitUnknownFrom: unknown ? unknownFrom : null,
  };
}
