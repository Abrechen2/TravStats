import { prisma } from "../../db";
import {
  TIME_FLAG_ENTITY_TYPES,
  type DataQualityFlagSubject,
  type TimeFlagEntityType,
} from "../../schemas/dataQualityFlag";

/**
 * Names for the rows a time-model question is about (ADR 0002 phase 3b), so
 * the inbox can say which flight, which port call, which visit — and link to
 * the record it is edited on — without a second request.
 *
 * Every query carries the `userId`: a flag names one of the user's own rows,
 * and a stranger must not be able to read its name through an id.
 */

type TimeSubject = Extract<DataQualityFlagSubject, { parentId: string | null }>;

const isTimeEntity = (type: string): type is TimeFlagEntityType =>
  (TIME_FLAG_ENTITY_TYPES as readonly string[]).includes(type);

const arrow = (from: string | null, to: string | null): string => `${from ?? "?"} → ${to ?? "?"}`;

type Loader = (
  userId: string,
  ids: string[]
) => Promise<Array<{ id: string; label: string; parentId: string | null }>>;

const LOADERS: Record<TimeFlagEntityType, Loader> = {
  flight: async (userId, ids) =>
    (
      await prisma.flight.findMany({
        where: { userId, id: { in: ids } },
        select: {
          id: true,
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
        id: f.id,
        label: f.flightNumber ? `${f.flightNumber} ${route}` : route,
        parentId: null,
      };
    }),
  rail_journey: async (userId, ids) =>
    (
      await prisma.railJourney.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, depStationName: true, arrStationName: true },
      })
    ).map((r) => ({ id: r.id, label: arrow(r.depStationName, r.arrStationName), parentId: null })),
  place_visit: async (userId, ids) =>
    (
      await prisma.placeVisit.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, placeId: true, place: { select: { name: true } } },
      })
    ).map((v) => ({ id: v.id, label: v.place.name, parentId: v.placeId })),
  cruise: async (userId, ids) =>
    (
      await prisma.cruise.findMany({
        where: { userId, id: { in: ids } },
        select: {
          id: true,
          routeName: true,
          shipNameOverride: true,
          cruiseLine: true,
          ship: { select: { name: true } },
        },
      })
    ).map((c) => ({
      id: c.id,
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? "",
      parentId: null,
    })),
  cruise_stop: async (userId, ids) =>
    (
      await prisma.cruiseStop.findMany({
        where: { id: { in: ids }, cruise: { userId } },
        select: {
          id: true,
          cruiseId: true,
          unresolvedPortName: true,
          port: { select: { name: true } },
        },
      })
    ).map((s) => ({
      id: s.id,
      label: s.port?.name ?? s.unresolvedPortName ?? "",
      parentId: s.cruiseId,
    })),
  trip: async (userId, ids) =>
    (
      await prisma.trip.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, name: true },
      })
    ).map((t) => ({ id: t.id, label: t.name, parentId: null })),
  trip_stop: async (userId, ids) =>
    (
      await prisma.tripStop.findMany({
        where: {
          id: { in: ids },
          OR: [{ trip: { userId } }, { route: { userId } }],
        },
        select: { id: true, title: true, tripId: true, routeId: true },
      })
    ).map((s) => ({ id: s.id, label: s.title, parentId: s.tripId ?? s.routeId })),
  trip_journal_entry: async (userId, ids) =>
    (
      await prisma.tripJournalEntry.findMany({
        where: { id: { in: ids }, trip: { userId } },
        select: { id: true, title: true, tripId: true, trip: { select: { name: true } } },
      })
    ).map((j) => ({ id: j.id, label: j.title ?? j.trip.name, parentId: j.tripId })),
  lodging_stay: async (userId, ids) =>
    (
      await prisma.lodgingStay.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, lodgingId: true, lodging: { select: { name: true } } },
      })
    ).map((s) => ({ id: s.id, label: s.lodging.name, parentId: s.lodgingId })),
  profile: async (userId, ids) =>
    ids.includes(userId)
      ? (
          await prisma.user.findMany({
            where: { id: userId },
            select: { id: true, username: true },
          })
        ).map((u) => ({ id: u.id, label: u.username, parentId: null }))
      : [],
};

/** Subjects keyed `"<entityType> <entityId>"`, for the flags that are time questions. */
export async function resolveTimeSubjects(
  userId: string,
  flags: ReadonlyArray<{ entityType: string; entityId: string }>
): Promise<Map<string, TimeSubject>> {
  const idsByType = new Map<TimeFlagEntityType, string[]>();
  for (const flag of flags) {
    if (!isTimeEntity(flag.entityType)) continue;
    idsByType.set(flag.entityType, [...(idsByType.get(flag.entityType) ?? []), flag.entityId]);
  }
  const subjects = new Map<string, TimeSubject>();
  for (const [entityType, ids] of idsByType) {
    for (const row of await LOADERS[entityType](userId, ids)) {
      subjects.set(`${entityType} ${row.id}`, {
        entityType,
        entityId: row.id,
        label: row.label,
        parentId: row.parentId,
      });
    }
  }
  return subjects;
}
