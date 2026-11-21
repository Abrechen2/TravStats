/**
 * Every entry a booking sells, of every kind (forgejo#430) — what the booking
 * card lists and what a package split is made across.
 */
import { prisma } from "../../db";
import type { BookingEntryKind } from "../../schemas/flightBooking";
import { itemKey } from "../flights/bookingPriceSplit";

export interface BookingItem {
  kind: BookingEntryKind;
  id: string;
  /** What the user recognises it by: a route, a hotel, a ship, a provider. */
  label: string;
  /** When it starts, as stored; null where the entry has no date. */
  date: Date | null;
  status: string;
  tripId: string | null;
}

const route = (from: string | null, to: string | null): string =>
  [from, to].filter((s): s is string => Boolean(s)).join(" → ") || "—";

export async function loadBookingItems(userId: string, bookingId: string): Promise<BookingItem[]> {
  const where = { userId, bookingId };
  const [flights, stays, cruises, rail, bus, ferry, rentals] = await Promise.all([
    prisma.flight.findMany({
      where,
      select: {
        id: true,
        flightNumber: true,
        depIata: true,
        arrIata: true,
        departureTime: true,
        status: true,
        tripId: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where,
      select: {
        id: true,
        checkIn: true,
        status: true,
        tripId: true,
        lodging: { select: { name: true } },
      },
    }),
    prisma.cruise.findMany({
      where,
      select: {
        id: true,
        routeName: true,
        shipNameOverride: true,
        startDate: true,
        status: true,
        tripId: true,
        ship: { select: { name: true } },
      },
    }),
    prisma.railJourney.findMany({ where, select: RIDE }),
    prisma.busJourney.findMany({ where, select: RIDE }),
    prisma.ferryJourney.findMany({ where, select: RIDE }),
    prisma.rentalBooking.findMany({
      where,
      select: {
        id: true,
        provider: true,
        vehicleClass: true,
        pickupTime: true,
        status: true,
        tripId: true,
      },
    }),
  ]);
  const items: BookingItem[] = [
    ...flights.map((f) => ({
      kind: "flight" as const,
      id: f.id,
      label: [f.flightNumber, route(f.depIata, f.arrIata)].filter(Boolean).join(" "),
      date: f.departureTime,
      status: f.status,
      tripId: f.tripId,
    })),
    ...stays.map((s) => ({
      kind: "stay" as const,
      id: s.id,
      label: s.lodging.name,
      date: s.checkIn,
      status: s.status,
      tripId: s.tripId,
    })),
    ...cruises.map((c) => ({
      kind: "cruise" as const,
      id: c.id,
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? "—",
      date: c.startDate,
      status: c.status,
      tripId: c.tripId,
    })),
    ...rides("rail", rail),
    ...rides("bus", bus),
    ...rides("ferry", ferry),
    ...rentals.map((r) => ({
      kind: "rental" as const,
      id: r.id,
      label: [r.provider, r.vehicleClass].filter(Boolean).join(" · "),
      date: r.pickupTime,
      status: r.status,
      tripId: r.tripId,
    })),
  ];
  // Chronological, undated last, then by kind and id so the order is stable.
  return items.sort(
    (a, b) =>
      (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) ||
      itemKey(a.kind, a.id).localeCompare(itemKey(b.kind, b.id))
  );
}

const RIDE = {
  id: true,
  depStationName: true,
  arrStationName: true,
  departureTime: true,
  status: true,
  tripId: true,
} as const;

function rides(
  kind: "rail" | "bus" | "ferry",
  rows: {
    id: string;
    depStationName: string;
    arrStationName: string;
    departureTime: Date;
    status: string;
    tripId: string | null;
  }[]
): BookingItem[] {
  return rows.map((r) => ({
    kind,
    id: r.id,
    label: route(r.depStationName, r.arrStationName),
    date: r.departureTime,
    status: r.status,
    tripId: r.tripId,
  }));
}

/** True when the items span more than one kind — a package. */
export const isPackage = (items: readonly BookingItem[]): boolean =>
  new Set(items.map((i) => i.kind)).size > 1;
