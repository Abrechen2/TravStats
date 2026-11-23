import { haversineKm } from "../../shared/geo/haversine";
import type { DbTransaction } from "../../db";
import type { FerryJourney } from "../../prisma";
import { readSeaGeometry } from "./ferryGeometry";

/**
 * A hand-drawn ferry line belongs to the PAIR of ports, not to one crossing
 * (GitHub #406/#407): the return trip and a second trip on the same corridor
 * draw it too. A crossing carries no port catalogue id, so a port is its
 * normalised name AND its coordinates within `PORT_MATCH_KM`.
 */
export const PORT_MATCH_KM = 1;

export interface PortEnd {
  name: string;
  lat: number;
  lon: number;
}

export interface PairEnds {
  a: PortEnd;
  b: PortEnd;
}

export type PairDirection = "forward" | "reverse";

/** Lower-case, accents folded, punctuation collapsed: "Långnäs, Hamn" = "langnas hamn". */
export function normalizePortName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function samePort(x: PortEnd, y: PortEnd): boolean {
  return (
    normalizePortName(x.name) === normalizePortName(y.name) &&
    haversineKm({ lat: x.lat, lon: x.lon }, { lat: y.lat, lon: y.lon }) <= PORT_MATCH_KM
  );
}

/** How `crossing` sits on `pair`: A to B, B to A, or not on it. */
export function pairDirection(pair: PairEnds, crossing: PairEnds): PairDirection | null {
  if (samePort(pair.a, crossing.a) && samePort(pair.b, crossing.b)) return "forward";
  if (samePort(pair.a, crossing.b) && samePort(pair.b, crossing.a)) return "reverse";
  return null;
}

export interface CrossingRow {
  depStationName: string;
  depLat: number;
  depLon: number;
  arrStationName: string;
  arrLat: number;
  arrLon: number;
}

export function crossingEnds(row: CrossingRow): PairEnds {
  return {
    a: { name: row.depStationName, lat: row.depLat, lon: row.depLon },
    b: { name: row.arrStationName, lat: row.arrLat, lon: row.arrLon },
  };
}

interface PairRouteRow {
  id: string;
  aName: string;
  aLat: number;
  aLon: number;
  bName: string;
  bLat: number;
  bLon: number;
  waypoints: unknown;
}

export const pairRouteEnds = (row: PairRouteRow): PairEnds => ({
  a: { name: row.aName, lat: row.aLat, lon: row.aLon },
  b: { name: row.bName, lat: row.bLat, lon: row.bLon },
});

type Db = DbTransaction;

/** The user's stored pair line that a crossing sits on, with the direction it reads it in. */
export async function findPairRoute(
  db: Db,
  userId: string,
  crossing: CrossingRow
): Promise<{ row: PairRouteRow; direction: PairDirection } | null> {
  const rows = (await db.ferryPairRoute.findMany({ where: { userId } })) as PairRouteRow[];
  const ends = crossingEnds(crossing);
  for (const row of rows) {
    const direction = pairDirection(pairRouteEnds(row), ends);
    if (direction) return { row, direction };
  }
  return null;
}

/** The user's crossings between the same two ports, in either direction. */
export async function crossingsOnPair(
  db: Db,
  userId: string,
  ends: PairEnds
): Promise<Array<{ ride: FerryJourney; direction: PairDirection }>> {
  // Bounding box first (about 0.05 degrees around either port), exact match after.
  const near = (p: PortEnd, latKey: "depLat" | "arrLat", lonKey: "depLon" | "arrLon") => ({
    [latKey]: { gte: p.lat - 0.05, lte: p.lat + 0.05 },
    [lonKey]: { gte: p.lon - 0.1, lte: p.lon + 0.1 },
  });
  const rides = (await db.ferryJourney.findMany({
    where: {
      userId,
      OR: [
        { AND: [near(ends.a, "depLat", "depLon"), near(ends.b, "arrLat", "arrLon")] },
        { AND: [near(ends.b, "depLat", "depLon"), near(ends.a, "arrLat", "arrLon")] },
      ],
    },
  })) as FerryJourney[];
  const out: Array<{ ride: FerryJourney; direction: PairDirection }> = [];
  for (const ride of rides) {
    const direction = pairDirection(ends, crossingEnds(ride));
    if (direction) out.push({ ride, direction });
  }
  return out;
}

/**
 * The line a crossing draws for a pair line: the via points in the crossing's
 * direction, both ends snapped onto the crossing's own terminals. Null when the
 * stored points are not a usable sea line.
 */
export function lineForCrossing(
  stored: unknown,
  direction: PairDirection,
  crossing: CrossingRow
): Array<[number, number]> | null {
  const points = readSeaGeometry(stored);
  if (!points) return null;
  const ordered = direction === "forward" ? points : [...points].reverse();
  return [
    [crossing.depLon, crossing.depLat],
    ...ordered.slice(1, -1),
    [crossing.arrLon, crossing.arrLat],
  ];
}
