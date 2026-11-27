import { prisma } from "../../../db";
import { ENTRY_WINDOW_ADAPTERS } from "../../locationEvidence/journeys/entryWindows";
import { ENTRY_SLACK_MS } from "./jumps";
import type { TravelEntry, TravelKind, Window } from "./types";

/**
 * The logged journeys a day's jumps and gaps are read against: flights,
 * trains, buses and ferries, with their windows from the entry-window
 * adapters (the same windows the rest of TravTrack labels a day with) and
 * their departure and arrival coordinates.
 */

const KINDS: readonly TravelKind[] = ["flight", "rail", "bus", "ferry"];

type Ends = { id: string; depLat: number; depLon: number; arrLat: number; arrLon: number };
const ENDS = { id: true, depLat: true, depLon: true, arrLat: true, arrLon: true } as const;

function endsOf(kind: TravelKind, userId: string, ids: string[]): Promise<Ends[]> {
  const where = { userId, id: { in: ids } };
  if (kind === "flight") return prisma.flight.findMany({ where, select: ENDS });
  if (kind === "rail") return prisma.railJourney.findMany({ where, select: ENDS });
  if (kind === "bus") return prisma.busJourney.findMany({ where, select: ENDS });
  return prisma.ferryJourney.findMany({ where, select: ENDS });
}

export async function travelEntriesIn(userId: string, window: Window): Promise<TravelEntry[]> {
  const wide = { fromMs: window.fromMs - ENTRY_SLACK_MS, untilMs: window.untilMs + ENTRY_SLACK_MS };
  const lists = await Promise.all(
    KINDS.map(async (kind) => {
      const adapter = ENTRY_WINDOW_ADAPTERS[kind];
      if ("none" in adapter) return [];
      const windows = await adapter.read(userId, wide);
      if (windows.length === 0) return [];
      const ends = new Map(
        (
          await endsOf(
            kind,
            userId,
            windows.map((w) => w.id)
          )
        ).map((e) => [e.id, e])
      );
      return windows.flatMap((w): TravelEntry[] => {
        const e = ends.get(w.id);
        return e
          ? [
              {
                kind,
                id: w.id,
                fromMs: w.fromMs,
                untilMs: w.untilMs,
                dep: { lat: e.depLat, lon: e.depLon },
                arr: { lat: e.arrLat, lon: e.arrLon },
              },
            ]
          : [];
      });
    })
  );
  return lists.flat();
}

/** `[lon, lat]` vertices of a great circle, for a flight bridge. */
function greatCircle(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * rad, a.lon * rad, b.lat * rad, b.lon * rad];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 +
          Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
      )
    );
  if (d === 0) return [[a.lon, a.lat]];
  const out: number[][] = [];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    out.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad]);
  }
  return out;
}

const isLine = (g: unknown): g is number[][] =>
  Array.isArray(g) &&
  g.length >= 2 &&
  g.every((v) => Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number"));

/**
 * The line a bridge is drawn with: the entry's own geometry where it has one
 * (a ride's road or rail line), a great circle for a flight, else the straight
 * line between its ends — always labelled with the entry, never as points.
 */
export async function entryGeometry(
  userId: string,
  kind: TravelKind,
  id: string
): Promise<number[][] | null> {
  const where = { userId, id };
  const sel = { ...ENDS, geometry: true } as const;
  const row =
    kind === "flight"
      ? await prisma.flight.findFirst({ where, select: ENDS })
      : kind === "rail"
        ? await prisma.railJourney.findFirst({ where, select: sel })
        : kind === "bus"
          ? await prisma.busJourney.findFirst({ where, select: sel })
          : await prisma.ferryJourney.findFirst({ where, select: sel });
  if (!row) return null;
  const dep = { lat: row.depLat, lon: row.depLon };
  const arr = { lat: row.arrLat, lon: row.arrLon };
  if ("geometry" in row && isLine(row.geometry)) return row.geometry;
  return kind === "flight"
    ? greatCircle(dep, arr)
    : [
        [dep.lon, dep.lat],
        [arr.lon, arr.lat],
      ];
}
