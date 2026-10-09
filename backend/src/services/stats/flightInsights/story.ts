/**
 * The year's story (forgejo#256) — built from extremes the other insights
 * already proved, never from a measure of its own. Pure.
 *
 * Three beats, each of which may be absent rather than invented:
 *
 * 1. NEW GROUND — the airports the year first recorded (`./airports.ts`).
 * 2. THE BIGGEST CHANGE — of four figures (flights, kilometres, airports
 *    used, connections), the one that moved most, relatively, against the
 *    CALENDAR year before. A year after a year with no counted flight has no
 *    comparison: a change from nothing would be infinite and say nothing.
 * 3. THE CURIOUS REPETITION — the longest return to an airport that ended
 *    this year, when at least a whole year lay between; otherwise the
 *    connection flown most often this year, when it was flown at least three
 *    times. Neither: nothing is claimed.
 *
 * The fun facts are the fun-facts calculator's own answer
 * (`utils/stats/funStats.ts`), run over the year's flights by the caller —
 * "include, don't recompute".
 */

import type { FlightYearStory, StoryMeasure } from "../../../schemas/statsFlightInsights";
import type { AirportVisit, YearAirports } from "./airports";
import { reunionsEndingIn } from "./airports";
import type { ConnectionFlight, YearConnections } from "./connections";
import type { YearTransfers } from "./transfers";

/** A return counts as the year's curiosity from one whole year away. */
export const STORY_REUNION_MIN_YEARS = 1; // threshold: proposal forgejo#256, owner to confirm
/** A connection counts as the year's curiosity from three flights on it. */
export const STORY_CONNECTION_MIN_FLIGHTS = 3; // threshold: proposal forgejo#256, owner to confirm

export interface YearFigures {
  year: number;
  flights: number;
  distanceKm: number;
}

export interface StoryInputs {
  year: number;
  availableYears: number[];
  figures: readonly YearFigures[];
  airports: readonly YearAirports[];
  connections: readonly YearConnections[];
  connectionFlights: readonly ConnectionFlight[];
  visits: readonly AirportVisit[];
  transfers: readonly YearTransfers[];
  funFacts: FlightYearStory["funFacts"];
}

function measuresOf(inputs: StoryInputs, year: number): Record<StoryMeasure, number> | null {
  const figures = inputs.figures.find((f) => f.year === year);
  if (!figures || figures.flights === 0) return null;
  const airports = inputs.airports.find((a) => a.year === year);
  const connections = inputs.connections.find((c) => c.year === year);
  return {
    flights: figures.flights,
    distanceKm: Math.round(figures.distanceKm),
    airports: airports?.used.length ?? 0,
    connections: (connections?.discovered.length ?? 0) + (connections?.repeated.length ?? 0),
  };
}

const MEASURE_ORDER: StoryMeasure[] = ["flights", "distanceKm", "airports", "connections"];

function biggestChange(inputs: StoryInputs): FlightYearStory["biggestChange"] {
  const current = measuresOf(inputs, inputs.year);
  const previous = measuresOf(inputs, inputs.year - 1);
  if (!current || !previous) return null;
  let best: FlightYearStory["biggestChange"] = null;
  for (const measure of MEASURE_ORDER) {
    if (previous[measure] === 0) continue;
    const ratio = (current[measure] - previous[measure]) / previous[measure];
    if (ratio !== 0 && (best === null || Math.abs(ratio) > Math.abs(best.ratio))) {
      best = {
        measure,
        previousYear: inputs.year - 1,
        previous: previous[measure],
        current: current[measure],
        ratio,
      };
    }
  }
  return best;
}

function curiousRepetition(inputs: StoryInputs): FlightYearStory["curiousRepetition"] {
  const reunion = reunionsEndingIn(inputs.visits, inputs.year)[0];
  if (reunion && reunion.years >= STORY_REUNION_MIN_YEARS) return { kind: "reunion", reunion };
  const counts = new Map<string, number>();
  for (const f of inputs.connectionFlights) {
    if (f.year === inputs.year) counts.set(f.connection, (counts.get(f.connection) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  if (top && top[1] >= STORY_CONNECTION_MIN_FLIGHTS) {
    return { kind: "connection", connection: top[0], flights: top[1] };
  }
  return null;
}

export function buildYearStory(inputs: StoryInputs): FlightYearStory {
  const transfers = inputs.transfers.find((t) => t.year === inputs.year);
  return {
    year: inputs.year,
    availableYears: inputs.availableYears,
    newAirports: inputs.airports.find((a) => a.year === inputs.year)?.discovered ?? [],
    biggestChange: biggestChange(inputs),
    curiousRepetition: curiousRepetition(inputs),
    funFacts: inputs.funFacts,
    transfers: {
      count: transfers?.count ?? 0,
      shortestMinutes: transfers ? transfers.shortest.minutes : null,
    },
  };
}
