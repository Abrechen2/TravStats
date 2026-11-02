import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import type { TripFile } from "./format";

/**
 * Writes the roadtrips of a `.travstats` file (format version 4, forgejo#404):
 * the route section, its stations and legs, and the ferry↔leg links. Runs
 * inside `writeAll`'s transaction after the ferries and stays exist, so the
 * keys the file names resolve to this account's rows; `writeAll` propagates
 * the returned ids to the other members of a shared trip.
 *
 * The notes and odometer readings of a private file are written; expenses and
 * tracks are never in the file. A station whose stay was skipped by the import
 * keeps its night as a free one.
 */
export async function writeRoadtrips(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  roadtrips: TripFile["roadtrips"],
  ids: { stay: Map<string, string>; ferry: Map<string, string> }
): Promise<Map<string, string>> {
  const created = new Map<string, string>();
  for (const r of roadtrips) {
    // share-exempt: returns the id to writeAll, which propagates ids.roadtrip after every kind is written
    const route = await tx.tripRoute.create({
      data: {
        userId,
        tripId,
        kind: "roadtrip",
        name: r.name,
        mode: r.mode,
        orderIdx: r.orderIdx,
        vehicle: r.vehicle,
        vehicleName: r.vehicleName,
        ...(r.private
          ? {
              notes: r.private.notes,
              startOdometerKm: r.private.startOdometerKm,
              endOdometerKm: r.private.endOdometerKm,
            }
          : {}),
      },
      select: { id: true },
    });
    created.set(r.key, route.id);
    const stopIds = new Map<string, string>();
    for (const s of r.stations) {
      // share-exempt: a station of the route created above, propagated with it by writeAll
      const stop = await tx.tripStop.create({
        data: {
          routeId: route.id,
          tripId: null,
          routeOrderIdx: s.routeOrderIdx,
          orderIdx: s.orderIdx,
          domain: s.domain,
          title: s.title,
          description: s.description,
          startDate: s.startDate ? new Date(s.startDate) : null,
          endDate: s.endDate ? new Date(s.endDate) : null,
          startUtc: s.startUtc ? new Date(s.startUtc) : null,
          endUtc: s.endUtc ? new Date(s.endUtc) : null,
          stopZone: s.stopZone,
          precision: s.precision,
          lat: s.lat,
          lon: s.lon,
          overnight: s.overnight,
          viaPoint: s.viaPoint,
          countryVisitKind: s.countryVisitKind,
          lodgingStayId: s.stayKey ? (ids.stay.get(s.stayKey) ?? null) : null,
          ...(s.private ? { notes: s.private.notes } : {}),
        },
        select: { id: true },
      });
      stopIds.set(s.key, stop.id);
    }
    for (const l of r.legs) {
      const fromStopId = stopIds.get(l.fromKey);
      const toStopId = stopIds.get(l.toKey);
      if (!fromStopId || !toStopId) continue;
      // share-exempt: a leg of the route created above, propagated with it by writeAll
      const leg = await tx.tripRouteLeg.create({
        data: {
          routeId: route.id,
          fromStopId,
          toStopId,
          distanceKm: l.distanceKm,
          source: l.source,
          mode: l.mode,
          confidence: l.confidence,
          waypoints: (l.waypoints ?? undefined) as Prisma.InputJsonValue | undefined,
          drivingMinutes: l.drivingMinutes,
        },
        select: { id: true },
      });
      const ferryId = l.ferryKey ? ids.ferry.get(l.ferryKey) : undefined;
      if (ferryId) {
        // share-exempt: the ferry link is not a ferry fact; the leg is propagated with its roadtrip
        await tx.ferryJourney.updateMany({
          where: { id: ferryId, userId, roadtripLegId: null },
          data: { roadtripLegId: leg.id },
        });
      }
    }
  }
  return created;
}
