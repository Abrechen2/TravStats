/**
 * Route corrections folded out of a station list (tester 2026-09-26).
 * Mirrored at `frontend/src/shared/tour/viaPoints.ts` — change both together.
 *
 * A via point bends the route: the legs run A → via → B. A reader that lists
 * STATIONS must see A → B instead, as one leg whose distance and driving time
 * are the sum of the pieces and whose line runs through the via point. That
 * fold lives here, once, for every such reader (the web timeline, the phone).
 */

export interface ViaFoldStop {
  id: string;
  lat: number | null;
  lon: number | null;
  viaPoint?: boolean;
  /** The DTO shape says it with `state` instead of the column. */
  state?: string;
}

export interface ViaFoldLeg {
  id: string;
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  drivingMinutes: number | null;
  tollCost: number | null;
  currency: string | null;
  waypoints: unknown;
}

function isVia(stop: ViaFoldStop): boolean {
  return stop.viaPoint === true || stop.state === "via";
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  return values.some((v) => v === null) ? null : (values as number[]).reduce((a, b) => a + b, 0);
}

function lineOf(leg: ViaFoldLeg, from: ViaFoldStop, to: ViaFoldStop): Array<[number, number]> {
  if (Array.isArray(leg.waypoints) && leg.waypoints.length >= 2) {
    return leg.waypoints as Array<[number, number]>;
  }
  if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) return [];
  return [
    [from.lon, from.lat],
    [to.lon, to.lat],
  ];
}

/**
 * The stations without their via points, and the legs between consecutive
 * stations with every via chain merged into one. A chain whose pieces are not
 * all present (a leg still missing) is left out rather than invented — the
 * same as a missing leg between two stations.
 */
export function foldViaPoints<S extends ViaFoldStop, L extends ViaFoldLeg>(
  stops: readonly S[],
  legs: readonly L[]
): { stations: S[]; legs: L[] } {
  if (!stops.some(isVia)) return { stations: [...stops], legs: [...legs] };
  const byId = new Map(stops.map((s) => [s.id, s]));
  const legFrom = new Map(legs.map((l) => [l.fromStopId, l]));
  const stations = stops.filter((s) => !isVia(s));
  const merged: L[] = [];

  for (const [index, station] of stations.entries()) {
    const next = stations[index + 1];
    if (!next) break;
    const chain: L[] = [];
    let at = station.id;
    while (at !== next.id) {
      const leg = legFrom.get(at);
      if (!leg) break;
      chain.push(leg);
      at = leg.toStopId;
      const stop = byId.get(at);
      if (!stop || (at !== next.id && !isVia(stop))) break;
    }
    if (chain.length === 0 || at !== next.id) continue;
    if (chain.length === 1) {
      merged.push(chain[0]);
      continue;
    }
    const first = chain[0];
    const currencies = new Set(chain.map((l) => l.currency));
    merged.push({
      ...first,
      toStopId: next.id,
      distanceKm: chain.reduce((sum, l) => sum + l.distanceKm, 0),
      drivingMinutes: sumOrNull(chain.map((l) => l.drivingMinutes)),
      tollCost: currencies.size === 1 ? sumOrNull(chain.map((l) => l.tollCost)) : null,
      currency: currencies.size === 1 ? first.currency : null,
      waypoints: chain.flatMap((l, i) => {
        const line = lineOf(l, byId.get(l.fromStopId) as S, byId.get(l.toStopId) as S);
        return i === 0 ? line : line.slice(1);
      }),
    });
  }
  return { stations, legs: merged };
}
