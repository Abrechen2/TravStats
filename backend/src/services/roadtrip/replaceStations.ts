import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { StationsInput } from "../../schemas/roadtrip";
import { recomputeLegs, type StopCoords } from "../tour/legRecompute";
import { autoRouteNewLegs } from "../tour/routing/autoRouteLegs";
import { STATION_DTO_SELECT } from "./roadtripSummary";
import { readRouteAndLegs, ROUTE_SELECT } from "../../routes/trips/tourRoutes";
import { stationTimeColumns } from "../timeModel/tripColumns";

export type Station = StationsInput["stations"][number];

/**
 * The columns a station's night is stored in — see `TripStop.overnight` and
 * `TripStop.viaPoint`.
 */
function nightColumns(station: Station): {
  lodgingStayId: string | null;
  overnight: boolean;
  viaPoint: boolean;
  placeId: string | null;
} {
  switch (station.night.kind) {
    case "stay":
      return {
        lodgingStayId: station.night.lodgingStayId,
        overnight: true,
        viaPoint: false,
        placeId: null,
      };
    case "free":
      return { lodgingStayId: null, overnight: true, viaPoint: false, placeId: null };
    case "pass":
      return {
        lodgingStayId: null,
        overnight: false,
        viaPoint: false,
        placeId: station.night.placeId ?? null,
      };
    case "via":
      return { lodgingStayId: null, overnight: false, viaPoint: true, placeId: null };
  }
}

/**
 * Every linked place must be the caller's — the same rule, and the same 404,
 * as the stays: a foreign key proves the place exists, not whose it is, and
 * the station would read its name back.
 */
export async function assertPlacesOwned(
  userId: string,
  stations: readonly Station[]
): Promise<void> {
  const ids = [
    ...new Set(
      stations.flatMap((s) => (s.night.kind === "pass" && s.night.placeId ? [s.night.placeId] : []))
    ),
  ];
  if (ids.length === 0) return;
  const owned = await prisma.place.count({ where: { id: { in: ids }, userId } });
  if (owned !== ids.length) throw new AppError("Place not found", 404);
}

/**
 * Every linked stay must be the caller's. A foreign key proves the stay
 * exists, not whose it is — without this, a station could point at another
 * user's stay and read its name, dates and price class back through the
 * detail call.
 */
export async function assertStaysOwned(
  userId: string,
  stations: readonly Station[]
): Promise<void> {
  const ids = [
    ...new Set(stations.flatMap((s) => (s.night.kind === "stay" ? [s.night.lodgingStayId] : []))),
  ];
  if (ids.length === 0) return;
  const owned = await prisma.lodgingStay.count({ where: { id: { in: ids }, userId } });
  if (owned !== ids.length) throw new AppError("Stay not found", 404);
}

/**
 * The complete, ordered station list of one roadtrip — added, moved,
 * removed, renumbered and re-linked in one write. Legs are recomputed in the
 * same transaction and keyed by endpoint station, so a hand-drawn or routed
 * leg survives an unrelated insertion; legs the write created are routed
 * along the road afterwards when a provider exists.
 *
 * The ONE writer of a station list: the station editor (`PUT
 * /roadtrips/:id/stations`) and the spreadsheet import both come here, so a
 * rule about stations cannot hold on one path and not the other.
 *
 * A station that existed on a trip's timeline before the 2.7 classification
 * keeps its `tripId`; a new station is owned by the roadtrip alone. Removing
 * a timeline stop from the list releases it back to the timeline rather than
 * deleting it — the trip's timeline is not the roadtrip's to destroy.
 *
 * `routeId` must already be resolved as the caller's roadtrip.
 */
export async function replaceStations(
  userId: string,
  routeId: string,
  stations: readonly Station[]
) {
  const givenIds = stations.flatMap((s) => (s.id === undefined ? [] : [s.id]));
  if (new Set(givenIds).size !== givenIds.length) {
    throw new AppError("A station may appear once — a return visit is its own station", 400);
  }
  await assertStaysOwned(userId, stations);
  await assertPlacesOwned(userId, stations);

  const mode = (
    await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, select: { mode: true } })
  ).mode;

  const result = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.tripStop.findMany({
        where: { routeId },
        select: { id: true, tripId: true },
      });
      const known = new Set(existing.map((s) => s.id));
      const unknown = givenIds.find((id) => !known.has(id));
      if (unknown !== undefined) {
        throw new AppError("A station id does not belong to this roadtrip", 400);
      }
      // A trip's timeline stop is a place the traveller was; turning it into
      // a nameless bend in the line would take it off the trip's timeline
      // without saying so. A route correction is always a point of its own.
      const onTimeline = new Set(existing.flatMap((s) => (s.tripId !== null ? [s.id] : [])));
      if (
        stations.some((s) => s.night.kind === "via" && s.id !== undefined && onTimeline.has(s.id))
      ) {
        throw new AppError(
          "A stop of the trip's timeline cannot become a route correction",
          400,
          "VIA_POINT_ON_TIMELINE"
        );
      }

      // Free every position first: `@@unique([routeId, routeOrderIdx])`
      // would otherwise collide mid-reorder.
      await tx.tripStop.updateMany({ where: { routeId }, data: { routeOrderIdx: null } });

      const ordered: StopCoords[] = [];
      for (const [index, station] of stations.entries()) {
        const data = {
          title: station.title,
          lat: station.lat,
          lon: station.lon,
          startDate: station.startDate ?? null,
          endDate: station.endDate ?? null,
          ...stationTimeColumns({
            startDate: station.startDate ?? null,
            endDate: station.endDate ?? null,
            lat: station.lat,
            lon: station.lon,
          }),
          notes: station.notes ?? null,
          ...nightColumns(station),
          routeId,
          routeOrderIdx: index,
        };
        const row =
          station.id === undefined
            ? await tx.tripStop.create({
                data: { ...data, tripId: null, domain: "roadtrip" },
                select: { id: true, lat: true, lon: true },
              })
            : await tx.tripStop.update({
                where: { id: station.id },
                data,
                select: { id: true, lat: true, lon: true },
              });
        ordered.push(row);
      }

      // Dropped stations: a timeline stop goes back to its trip, a
      // roadtrip-owned one is deleted with its legs.
      await tx.tripStop.updateMany({
        where: { routeId, routeOrderIdx: null, tripId: { not: null } },
        data: {
          routeId: null,
          lodgingStayId: null,
          overnight: false,
          viaPoint: false,
          placeId: null,
        },
      });
      await tx.tripStop.deleteMany({ where: { routeId, routeOrderIdx: null } });

      const createdLegs = await recomputeLegs(tx, routeId, mode, ordered);

      return {
        createdLegs,
        route: await tx.tripRoute.findUniqueOrThrow({
          where: { id: routeId },
          include: ROUTE_SELECT,
        }),
        stations: await tx.tripStop.findMany({
          where: { routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: STATION_DTO_SELECT,
        }),
        legs: await tx.tripRouteLeg.findMany({
          where: { routeId },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
      };
    },
    { timeout: 20_000 }
  );

  const routedCount = await autoRouteNewLegs(userId, routeId, result.createdLegs);
  const { route, legs } = routedCount > 0 ? await readRouteAndLegs(routeId) : result;
  return { route, legs, stations: result.stations };
}
