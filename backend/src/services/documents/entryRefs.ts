import { prisma } from "../../db";
import type { EntryType } from "./documentFormats";
import type { EntryRef } from "./documentLinks";

/**
 * What a client shows for an entry a document is linked to (plan D2): a short
 * human label and, where the entry's own page needs a second id, that id.
 * Resolved for the caller's OWN entries only — every query carries `userId`, so
 * a link to anything else describes nothing and is left out of the answer.
 */
export interface EntryInfo extends EntryRef {
  label: string;
  /** The id of the page that shows this entry: a stay's lodging, a visit's place, an expense's trip. */
  parentId: string | null;
  /** The trip the entry sits in, if any — "trip entries first" in the picker. */
  tripId: string | null;
}

export const entryKey = (entry: EntryRef): string => `${entry.type}:${entry.id}`;

const route = (a: string | null, b: string | null): string => [a, b].filter(Boolean).join(" → ");

type Described = Omit<EntryInfo, "type" | "id">;

/** Day printed in a label; UTC, the same day the entry carries. */
const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");

/** `info` for every entry in `refs` that exists and belongs to `userId`. */
export async function describeEntries(
  userId: string,
  refs: readonly EntryRef[]
): Promise<Map<string, EntryInfo>> {
  const out = new Map<string, EntryInfo>();
  const ids = (type: EntryType): string[] => [
    ...new Set(refs.filter((r) => r.type === type).map((r) => r.id)),
  ];
  const put = (type: EntryType, id: string, info: Described): void => {
    out.set(entryKey({ type, id }), { type, id, ...info });
  };
  const where = (type: EntryType) => ({ id: { in: ids(type) }, userId });
  const wanted = (type: EntryType): boolean => ids(type).length > 0;

  await Promise.all([
    wanted("flight") &&
      prisma.flight
        .findMany({
          where: where("flight"),
          select: {
            id: true,
            depIata: true,
            arrIata: true,
            flightNumber: true,
            departureTime: true,
            tripId: true,
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("flight", r.id, {
              label: [r.flightNumber, route(r.depIata, r.arrIata), day(r.departureTime)]
                .filter(Boolean)
                .join(" · "),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("cruise") &&
      prisma.cruise
        .findMany({
          where: where("cruise"),
          select: { id: true, routeName: true, startDate: true, tripId: true },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("cruise", r.id, {
              label: [r.routeName, day(r.startDate)].filter(Boolean).join(" · "),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("lodgingStay") &&
      prisma.lodgingStay
        .findMany({
          where: where("lodgingStay"),
          select: {
            id: true,
            lodgingId: true,
            checkIn: true,
            tripId: true,
            lodging: { select: { name: true } },
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("lodgingStay", r.id, {
              label: [r.lodging.name, day(r.checkIn)].filter(Boolean).join(" · "),
              parentId: r.lodgingId,
              tripId: r.tripId,
            })
          )
        ),
    wanted("trip") &&
      prisma.trip
        .findMany({ where: where("trip"), select: { id: true, name: true } })
        .then((rows) =>
          rows.forEach((r) => put("trip", r.id, { label: r.name, parentId: null, tripId: r.id }))
        ),
    wanted("placeVisit") &&
      prisma.placeVisit
        .findMany({
          where: where("placeVisit"),
          select: {
            id: true,
            placeId: true,
            visitedAt: true,
            tripId: true,
            place: { select: { name: true } },
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("placeVisit", r.id, {
              label: [r.place.name, day(r.visitedAt)].filter(Boolean).join(" · "),
              parentId: r.placeId,
              tripId: r.tripId,
            })
          )
        ),
    wanted("railJourney") &&
      prisma.railJourney
        .findMany({
          where: where("railJourney"),
          select: {
            id: true,
            depStationName: true,
            arrStationName: true,
            departureTime: true,
            tripId: true,
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("railJourney", r.id, {
              label: [route(r.depStationName, r.arrStationName), day(r.departureTime)]
                .filter(Boolean)
                .join(" · "),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("rentalBooking") &&
      prisma.rentalBooking
        .findMany({
          where: where("rentalBooking"),
          select: { id: true, pickupStationName: true, returnStationName: true, tripId: true },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("rentalBooking", r.id, {
              label: route(r.pickupStationName, r.returnStationName),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("busJourney") &&
      prisma.busJourney
        .findMany({
          where: where("busJourney"),
          select: {
            id: true,
            lineName: true,
            depStationName: true,
            arrStationName: true,
            departureTime: true,
            tripId: true,
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("busJourney", r.id, {
              label: [r.lineName, route(r.depStationName, r.arrStationName), day(r.departureTime)]
                .filter(Boolean)
                .join(" · "),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("ferryJourney") &&
      prisma.ferryJourney
        .findMany({
          where: where("ferryJourney"),
          select: {
            id: true,
            vesselName: true,
            depStationName: true,
            arrStationName: true,
            departureTime: true,
            tripId: true,
          },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("ferryJourney", r.id, {
              label: [r.vesselName, route(r.depStationName, r.arrStationName), day(r.departureTime)]
                .filter(Boolean)
                .join(" · "),
              parentId: null,
              tripId: r.tripId,
            })
          )
        ),
    wanted("tripExpense") &&
      prisma.tripExpense
        .findMany({
          where: where("tripExpense"),
          select: { id: true, note: true, kind: true, date: true, tripId: true },
        })
        .then((rows) =>
          rows.forEach((r) =>
            put("tripExpense", r.id, {
              label: [r.note ?? r.kind, day(r.date)].filter(Boolean).join(" · "),
              parentId: r.tripId,
              tripId: r.tripId,
            })
          )
        ),
  ]);
  return out;
}
