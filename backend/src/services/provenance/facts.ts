import { prisma } from "../../db";
import type { ProvenanceEntryType } from "../../schemas/provenance";

/**
 * One entry reduced to what the contradiction check needs: its kind, a label the user
 * recognises, how it was entered, and the span of time it claims (UTC instants; a trip's
 * date-only days are widened to whole days).
 */
export interface EntryFact {
  type: ProvenanceEntryType;
  id: string;
  tripId: string | null;
  label: string;
  provenance: string | null;
  from: Date | null;
  to: Date | null;
}

const DAY_MS = 86_400_000;
const arrow = (a?: string | null, b?: string | null): string => [a, b].filter(Boolean).join(" → ");

/** An account's entries that a trip pairing could involve, by kind. `tripWhere` narrows each query. */
export async function loadEntryFacts(
  userId: string,
  narrow: object
): Promise<{ trips: EntryFact[]; entries: EntryFact[] }> {
  const where = { userId, tripId: { not: null }, ...narrow } as const;
  const [trips, flights, stays, rail, bus, ferry, rentals, cruises, visits] = await Promise.all([
    prisma.trip.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        provenance: true,
        startDay: true,
        endDay: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.flight.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        depIata: true,
        arrIata: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        checkIn: true,
        checkOut: true,
        lodging: { select: { name: true } },
      },
    }),
    prisma.railJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        depStationName: true,
        arrStationName: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
    prisma.busJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        depStationName: true,
        arrStationName: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
    prisma.ferryJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        depStationName: true,
        arrStationName: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
    prisma.rentalBooking.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        provider: true,
        pickupTime: true,
        returnTime: true,
      },
    }),
    prisma.cruise.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        routeName: true,
        cruiseLine: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.placeVisit.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        provenance: true,
        visitedAt: true,
        place: { select: { name: true } },
      },
    }),
  ]);

  const entry = (
    type: ProvenanceEntryType,
    r: { id: string; tripId: string | null; provenance: string | null },
    label: string,
    from: Date | null,
    to: Date | null
  ): EntryFact => ({
    type,
    id: r.id,
    tripId: r.tripId,
    label,
    provenance: r.provenance,
    from,
    to: to ?? from,
  });

  return {
    trips: trips.map((t) => ({
      type: "trip" as const,
      id: t.id,
      tripId: t.id,
      label: t.name,
      provenance: t.provenance,
      from: t.startDay ?? t.startDate,
      // A date-only end day runs to the end of that day.
      to: t.endDay ? new Date(t.endDay.getTime() + DAY_MS) : t.endDate,
    })),
    entries: [
      ...flights.map((r) =>
        entry("flight", r, arrow(r.depIata, r.arrIata), r.departureTime, r.arrivalTime)
      ),
      ...stays.map((r) => entry("lodgingStay", r, r.lodging.name, r.checkIn, r.checkOut)),
      ...rail.map((r) =>
        entry(
          "railJourney",
          r,
          arrow(r.depStationName, r.arrStationName),
          r.departureTime,
          r.arrivalTime
        )
      ),
      ...bus.map((r) =>
        entry(
          "busJourney",
          r,
          arrow(r.depStationName, r.arrStationName),
          r.departureTime,
          r.arrivalTime
        )
      ),
      ...ferry.map((r) =>
        entry(
          "ferryJourney",
          r,
          arrow(r.depStationName, r.arrStationName),
          r.departureTime,
          r.arrivalTime
        )
      ),
      ...rentals.map((r) => entry("rentalBooking", r, r.provider, r.pickupTime, r.returnTime)),
      ...cruises.map((r) =>
        entry("cruise", r, r.routeName ?? r.cruiseLine ?? "Cruise", r.startDate, r.endDate)
      ),
      ...visits.map((r) => entry("placeVisit", r, r.place.name, r.visitedAt, r.visitedAt)),
    ],
  };
}
