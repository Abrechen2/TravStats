import { prisma } from "../../../db";
import { normalizeName, normalizeToken } from "./evidence";
import type { EntryFacts } from "./match";

const utcDay = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
const token = (v: string | null | undefined): string | null =>
  v ? normalizeToken(v) || null : null;

/**
 * Every suggestable entry of the account that sits in a trip, keyed
 * `type:id`. The account's own entries only (`userId` on every query): a trip
 * shared with the account holds entries of someone else, which are never
 * proposed and never read.
 */
export async function loadTripEntries(userId: string): Promise<Map<string, EntryFacts>> {
  const where = { userId, tripId: { not: null } } as const;
  const [flights, trains, buses, ferries, stays, rentals] = await Promise.all([
    prisma.flight.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        flightNumber: true,
        bookingReference: true,
        departureTime: true,
        depIata: true,
        arrIata: true,
      },
    }),
    prisma.railJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        trainNumber: true,
        bookingReference: true,
        departureTime: true,
        depStationName: true,
        arrStationName: true,
      },
    }),
    prisma.busJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        lineName: true,
        bookingReference: true,
        departureTime: true,
        depStationName: true,
        arrStationName: true,
      },
    }),
    prisma.ferryJourney.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        bookingReference: true,
        departureTime: true,
        depStationName: true,
        arrStationName: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        bookingReference: true,
        checkIn: true,
        checkOut: true,
        lodging: { select: { name: true } },
      },
    }),
    prisma.rentalBooking.findMany({
      where,
      select: {
        id: true,
        tripId: true,
        confirmationNumber: true,
        pickupTime: true,
        pickupStationName: true,
        returnStationName: true,
      },
    }),
  ]);

  const out = new Map<string, EntryFacts>();
  const put = (facts: EntryFacts): void => {
    out.set(`${facts.type}:${facts.id}`, facts);
  };
  const route = (a: string | null, b: string | null): string => [a, b].filter(Boolean).join(" → ");

  for (const r of flights) {
    put({
      type: "flight",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.bookingReference),
      number: token(r.flightNumber),
      day: utcDay(r.departureTime),
      checkOut: null,
      name: null,
      label: r.flightNumber || route(r.depIata, r.arrIata) || r.id,
    });
  }
  for (const r of trains) {
    put({
      type: "railJourney",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.bookingReference),
      number: token(r.trainNumber),
      day: utcDay(r.departureTime),
      checkOut: null,
      name: null,
      label: r.trainNumber || route(r.depStationName, r.arrStationName) || r.id,
    });
  }
  for (const r of buses) {
    put({
      type: "busJourney",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.bookingReference),
      number: token(r.lineName),
      day: utcDay(r.departureTime),
      checkOut: null,
      name: null,
      label: r.lineName || route(r.depStationName, r.arrStationName) || r.id,
    });
  }
  for (const r of ferries) {
    put({
      type: "ferryJourney",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.bookingReference),
      number: null,
      day: utcDay(r.departureTime),
      checkOut: null,
      name: null,
      label: route(r.depStationName, r.arrStationName) || r.id,
    });
  }
  for (const r of stays) {
    put({
      type: "lodgingStay",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.bookingReference),
      number: null,
      day: utcDay(r.checkIn),
      checkOut: utcDay(r.checkOut),
      name: normalizeName(r.lodging.name),
      label: r.lodging.name,
    });
  }
  for (const r of rentals) {
    put({
      type: "rentalBooking",
      id: r.id,
      tripId: r.tripId!,
      reference: token(r.confirmationNumber),
      number: null,
      day: utcDay(r.pickupTime),
      checkOut: null,
      name: null,
      label: route(r.pickupStationName, r.returnStationName) || r.id,
    });
  }
  return out;
}
