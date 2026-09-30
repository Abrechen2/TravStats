import { prisma } from "../../db";
import type { TimeFlagEntityType, TimeParentType } from "../../schemas/timeMigration";

/**
 * Where a row a time question is about can be edited (ADR 0002 phase 3b):
 * its own text to name it, the record it is edited on (`parent`), and the
 * trip it belongs to — for a stop of a tour that is the tour's trip, because
 * the editor opens the stop inside its trip. One home for both readers: the
 * inbox subject (scoped to the account) and the admin report (every account).
 */

export interface RowLink {
  id: string;
  label: string;
  parentType: TimeParentType | null;
  parentId: string | null;
  tripId: string | null;
}

/** `userId` scopes the lookup to one account; null reads every account (admin). */
type Loader = (ids: string[], userId: string | null) => Promise<RowLink[]>;

const owned = (userId: string | null) => (userId ? { userId } : {});
const arrow = (from: string | null, to: string | null): string => `${from ?? "?"} → ${to ?? "?"}`;
const own = (id: string, label: string): RowLink => ({
  id,
  label,
  parentType: null,
  parentId: null,
  tripId: null,
});

const LOADERS: Record<TimeFlagEntityType, Loader> = {
  flight: async (ids, userId) =>
    (
      await prisma.flight.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: {
          id: true,
          tripId: true,
          flightNumber: true,
          depIata: true,
          depIcao: true,
          depName: true,
          arrIata: true,
          arrIcao: true,
          arrName: true,
        },
      })
    ).map((f) => {
      const route = arrow(f.depIata ?? f.depIcao ?? f.depName, f.arrIata ?? f.arrIcao ?? f.arrName);
      return {
        ...own(f.id, f.flightNumber ? `${f.flightNumber} ${route}` : route),
        tripId: f.tripId,
      };
    }),
  rail_journey: async (ids, userId) =>
    (
      await prisma.railJourney.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: { id: true, tripId: true, depStationName: true, arrStationName: true },
      })
    ).map((r) => ({ ...own(r.id, arrow(r.depStationName, r.arrStationName)), tripId: r.tripId })),
  place_visit: async (ids, userId) =>
    (
      await prisma.placeVisit.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: { id: true, placeId: true, tripId: true, place: { select: { name: true } } },
      })
    ).map((v) => ({
      id: v.id,
      label: v.place.name,
      parentType: "place" as const,
      parentId: v.placeId,
      tripId: v.tripId,
    })),
  cruise: async (ids, userId) =>
    (
      await prisma.cruise.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: {
          id: true,
          tripId: true,
          routeName: true,
          shipNameOverride: true,
          cruiseLine: true,
          ship: { select: { name: true } },
        },
      })
    ).map((c) => ({
      ...own(c.id, c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? ""),
      tripId: c.tripId,
    })),
  cruise_stop: async (ids, userId) =>
    (
      await prisma.cruiseStop.findMany({
        where: { id: { in: ids }, ...(userId ? { cruise: { userId } } : {}) },
        select: {
          id: true,
          cruiseId: true,
          unresolvedPortName: true,
          port: { select: { name: true } },
          cruise: { select: { tripId: true } },
        },
      })
    ).map((s) => ({
      id: s.id,
      label: s.port?.name ?? s.unresolvedPortName ?? "",
      parentType: "cruise" as const,
      parentId: s.cruiseId,
      tripId: s.cruise.tripId,
    })),
  trip: async (ids, userId) =>
    (
      await prisma.trip.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: { id: true, name: true },
      })
    ).map((t) => ({ ...own(t.id, t.name), tripId: t.id })),
  trip_stop: async (ids, userId) =>
    (
      await prisma.tripStop.findMany({
        where: {
          id: { in: ids },
          ...(userId ? { OR: [{ trip: { userId } }, { route: { userId } }] } : {}),
        },
        select: {
          id: true,
          title: true,
          tripId: true,
          routeId: true,
          route: { select: { tripId: true } },
        },
      })
    ).map((s) =>
      // A stop on a trip is edited on that trip's timeline — also when it is a
      // point of a tour, because the timeline's stop editor is where its time
      // is. Only a tour's own point (no trip of its own) is edited in the tour
      // editor, which opens inside the tour's trip when it has one.
      s.tripId
        ? {
            id: s.id,
            label: s.title,
            parentType: "trip" as const,
            parentId: s.tripId,
            tripId: s.tripId,
          }
        : {
            id: s.id,
            label: s.title,
            parentType: s.routeId ? ("tour" as const) : null,
            parentId: s.routeId,
            tripId: s.route?.tripId ?? null,
          }
    ),
  trip_journal_entry: async (ids, userId) =>
    (
      await prisma.tripJournalEntry.findMany({
        where: { id: { in: ids }, ...(userId ? { trip: { userId } } : {}) },
        select: { id: true, title: true, tripId: true, trip: { select: { name: true } } },
      })
    ).map((j) => ({
      id: j.id,
      label: j.title ?? j.trip.name,
      parentType: "trip" as const,
      parentId: j.tripId,
      tripId: j.tripId,
    })),
  lodging_stay: async (ids, userId) =>
    (
      await prisma.lodgingStay.findMany({
        where: { id: { in: ids }, ...owned(userId) },
        select: { id: true, lodgingId: true, tripId: true, lodging: { select: { name: true } } },
      })
    ).map((s) => ({
      id: s.id,
      label: s.lodging.name,
      parentType: "lodging" as const,
      parentId: s.lodgingId,
      tripId: s.tripId,
    })),
  profile: async (ids, userId) =>
    (
      await prisma.user.findMany({
        where: { id: { in: userId ? ids.filter((id) => id === userId) : ids } },
        select: { id: true, username: true },
      })
    ).map((u) => own(u.id, u.username)),
};

/** Links keyed by row id. */
export async function loadRowLinks(
  entityType: TimeFlagEntityType,
  ids: string[],
  userId: string | null
): Promise<Map<string, RowLink>> {
  if (ids.length === 0) return new Map();
  return new Map((await LOADERS[entityType](ids, userId)).map((link) => [link.id, link]));
}
