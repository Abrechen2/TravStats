// The figures a journey route card and a journey stop card print.
//
// Same three questions the flight route card answers — how often, how far,
// when last, with whom — asked of any domain's journeys. Pure: no React, no
// network, so the rules below are pinned by unit tests rather than by a look
// at the map.
//
// ROUTE IDENTITY. A route is the UNORDERED pair of its two places, as a flight
// connection is (`shared/routePair.ts`: HNL-OGG and OGG-HNL are one). A ground
// place has no IATA, so it is keyed by its coordinates to ~100 m — the same
// "closer than this is one station, whatever its spelling" rule the station
// labels use (`stationLabelsLayer.ts`, SAME_STATION_M).
//
// DISTANCE. Summed over the journeys that HAPPENED, and only over the ones
// that recorded one. A journey without a distance is counted and named
// ("2 ohne Strecke"), never added as 0 — a zero would quietly shrink the total
// the reader takes as complete (CLAUDE.md, "Abstention is a result").

import type { JourneyEnd, MapJourney } from "./journeyTypes";

/** ~110 m of latitude: two spellings of one station land on one key. */
const KEY_DECIMALS = 3;

export function endKey(end: Pick<JourneyEnd, "lat" | "lon">): string {
  return `${end.lat.toFixed(KEY_DECIMALS)},${end.lon.toFixed(KEY_DECIMALS)}`;
}

/** The key of the route a journey is on — the same for either direction. */
export function journeyRouteKey(j: Pick<MapJourney, "dep" | "arr">): string {
  const a = endKey(j.dep);
  const b = endKey(j.arr);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Every journey on the same route as `seed`, cancelled ones left out. */
export function journeysOnRoute(
  all: readonly MapJourney[],
  seed: Pick<MapJourney, "dep" | "arr">
): MapJourney[] {
  const key = journeyRouteKey(seed);
  return all.filter((j) => j.status !== "cancelled" && journeyRouteKey(j) === key);
}

/** Every journey starting or ending at the place `stopKey` names. */
/**
 * Every station's journeys at once, keyed by `endKey`, cancelled ones left
 * out, each list in the journeys' own order — what `journeysAtStop` answers
 * for one key, built in one pass. A map decorates every station dot; asking
 * each dot to scan every journey was stations × journeys (Codex review).
 */
export function indexStops(all: readonly MapJourney[]): Map<string, MapJourney[]> {
  const index = new Map<string, MapJourney[]>();
  const add = (key: string, j: MapJourney) => {
    const list = index.get(key);
    if (list) list.push(j);
    else index.set(key, [j]);
  };
  for (const j of all) {
    if (j.status === "cancelled") continue;
    const a = endKey(j.dep);
    const b = endKey(j.arr);
    add(a, j);
    if (b !== a) add(b, j);
  }
  return index;
}

export function journeysAtStop(all: readonly MapJourney[], stopKey: string): MapJourney[] {
  return all.filter(
    (j) => j.status !== "cancelled" && (endKey(j.dep) === stopKey || endKey(j.arr) === stopKey)
  );
}

export interface JourneyTally {
  travelled: number;
  planned: number;
}

export function tallyJourneys(journeys: readonly MapJourney[]): JourneyTally {
  let travelled = 0;
  let planned = 0;
  for (const j of journeys) {
    if (j.travelled) travelled += 1;
    else if (j.planned) planned += 1;
  }
  return { travelled, planned };
}

export interface JourneyDistance {
  /** Sum over the travelled journeys that recorded a distance. */
  knownKm: number;
  /** Travelled journeys whose distance is unknown — named, never added as 0. */
  unknownCount: number;
  /** How many journeys the sum covers. */
  measuredCount: number;
}

export function sumJourneyDistance(journeys: readonly MapJourney[]): JourneyDistance {
  let knownKm = 0;
  let unknownCount = 0;
  let measuredCount = 0;
  for (const j of journeys) {
    if (!j.travelled) continue;
    if (j.distanceKm === null) unknownCount += 1;
    else {
      knownKm += j.distanceKm;
      measuredCount += 1;
    }
  }
  return { knownKm, unknownCount, measuredCount };
}

/** The most frequent non-empty value, or null. Ties go to the first seen. */
export function modeOf(values: ReadonlyArray<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const v of values) {
    const s = v?.trim();
    if (!s) continue;
    const n = (counts.get(s) ?? 0) + 1;
    counts.set(s, n);
    if (n > bestCount) {
      best = s;
      bestCount = n;
    }
  }
  return best;
}

/** Newest first; undated journeys last, in their given order. */
export function byNewest(journeys: readonly MapJourney[]): MapJourney[] {
  return [...journeys].sort((a, b) => {
    if (a.departureTime === b.departureTime) return 0;
    if (a.departureTime === null) return 1;
    if (b.departureTime === null) return -1;
    return a.departureTime < b.departureTime ? 1 : -1;
  });
}

/**
 * The journey the card names: the most recent one that HAPPENED; only if none
 * has, the NEAREST one still ahead, flagged as upcoming — the same rule the
 * lodging card uses for "which stay" (`latestStayFacts`).
 */
export function latestJourney(
  journeys: readonly MapJourney[]
): { journey: MapJourney; upcoming: boolean } | null {
  const done = byNewest(journeys.filter((j) => j.travelled));
  if (done.length > 0) return { journey: done[0], upcoming: false };
  const ahead = byNewest(journeys.filter((j) => j.planned)).reverse();
  const dated = ahead.find((j) => j.departureTime !== null) ?? ahead[0];
  return dated ? { journey: dated, upcoming: true } : null;
}

export interface JourneyRouteStats extends JourneyTally, JourneyDistance {
  latest: { journey: MapJourney; upcoming: boolean } | null;
  topOperator: string | null;
  /** Every journey on the route, newest first — the card's list. */
  list: MapJourney[];
}

export function getJourneyRouteStats(journeys: readonly MapJourney[]): JourneyRouteStats {
  return {
    ...tallyJourneys(journeys),
    ...sumJourneyDistance(journeys),
    latest: latestJourney(journeys),
    topOperator: modeOf(journeys.map((j) => j.operator)),
    list: byNewest(journeys),
  };
}

export interface JourneyStopStats extends JourneyRouteStats {
  /** The place this stop is most often connected to, and how often. */
  topRoute: { name: string; count: number } | null;
}

/** The far end of a journey, seen from `stopKey`. */
function otherEnd(j: MapJourney, stopKey: string): JourneyEnd {
  return endKey(j.dep) === stopKey ? j.arr : j.dep;
}

export function getJourneyStopStats(
  journeys: readonly MapJourney[],
  stopKey: string
): JourneyStopStats {
  const counts = new Map<string, { name: string; count: number }>();
  for (const j of journeys) {
    const far = otherEnd(j, stopKey);
    const key = endKey(far);
    // A same-station rental is a round trip to nowhere — no "route" to name.
    if (key === stopKey) continue;
    const entry = counts.get(key) ?? { name: far.name, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let topRoute: JourneyStopStats["topRoute"] = null;
  for (const entry of counts.values()) {
    if (!topRoute || entry.count > topRoute.count) topRoute = entry;
  }
  return { ...getJourneyRouteStats(journeys), topRoute };
}
