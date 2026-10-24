import { prisma } from "../../db";
import { recorderWindow, scheduledInstants } from "../flightDevice/flightWindow";
import { flightTrackColumns } from "../flightDevice/flightTrackIngest";
import { observationOf, TRAVTRACK_OBSERVATION_SELECT } from "../locationProvider/travtrackProvider";
import type { LocationObservation } from "../locationProvider/types";
import { byDevice } from "../locationProvider/entryTrack";
import { cutFlightTrackWith } from "./flightTrackView";
import type { CircleSet } from "./privacyCircles";

/**
 * TravTrack lines for the map's flights without an own recording (TravTrack
 * plan T5): each flight's points — linked to it, or inside its recorder window
 * — drawn the way a phone's upload is drawn, then privacy-cut. ONE query for
 * the windows' points and one for the links, never one per flight.
 */

export type TravTrackFlightLine = {
  flightId: string;
  geometry: Array<[number, number]>;
  segmentStarts: number[];
  origin: "travtrack";
};

const FLIGHT_SELECT = {
  id: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
} as const;

export async function travTrackFlightLines(
  userId: string,
  circles: CircleSet
): Promise<TravTrackFlightLine[]> {
  const flights = await prisma.flight.findMany({
    where: { userId, track: null, status: { not: "cancelled" } },
    select: FLIGHT_SELECT,
  });
  if (flights.length === 0) return [];
  const windows = new Map<string, [number, number]>();
  for (const f of flights) {
    const w = recorderWindow(await scheduledInstants(f));
    if (w) windows.set(f.id, w);
  }
  const [inWindows, linked] = await Promise.all([
    windows.size === 0
      ? []
      : prisma.travTrackPoint.findMany({
          where: {
            userId,
            OR: [...windows.values()].map(([from, to]) => ({
              t: { gte: new Date(from), lte: new Date(to) },
            })),
          },
          select: TRAVTRACK_OBSERVATION_SELECT,
        }),
    prisma.travTrackPointLink.findMany({
      where: { userId, entryKind: "flight", entryId: { in: flights.map((f) => f.id) } },
      select: { entryId: true, point: { select: TRAVTRACK_OBSERVATION_SELECT } },
    }),
  ]);

  const perFlight = new Map<string, Map<string, LocationObservation>>();
  const add = (flightId: string, o: LocationObservation) => {
    const map = perFlight.get(flightId) ?? new Map<string, LocationObservation>();
    map.set(o.ref, o);
    perFlight.set(flightId, map);
  };
  for (const row of inWindows) {
    const o = observationOf(row);
    for (const [flightId, [from, to]] of windows) {
      if (o.atMs >= from && o.atMs <= to) add(flightId, o);
    }
  }
  for (const link of linked) add(link.entryId, observationOf(link.point));

  const lines: TravTrackFlightLine[] = [];
  for (const [flightId, map] of perFlight) {
    const points = [...map.values()].sort((a, b) => a.atMs - b.atMs);
    const device = byDevice(points).sort((a, b) => b.points.length - a.points.length)[0];
    if (!device || device.points.length < 2) continue;
    const columns = flightTrackColumns(
      device.points.map((p) => ({ t: p.atMs, lat: p.lat, lon: p.lon }))
    );
    if (!columns) continue;
    const cut = cutFlightTrackWith(columns, circles(columns.startedAt.getTime()));
    const geometry = cut.geometry as Array<[number, number]>;
    if (geometry.length < 2) continue;
    lines.push({
      flightId,
      geometry,
      segmentStarts: cut.segmentStarts as number[],
      origin: "travtrack",
    });
  }
  return lines.sort((a, b) => a.flightId.localeCompare(b.flightId));
}
