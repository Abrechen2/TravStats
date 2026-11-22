/**
 * Every entry a booking sells, of every kind (forgejo#430) — what the booking
 * card lists and what a package split is made across.
 */
import { prisma } from "../../db";
import { getCachedAirports } from "../airportCache";
import type { BookingEntryKind } from "../../schemas/flightBooking";
import { itemKey } from "../flights/bookingPriceSplit";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import { flightTimes } from "../flights/timesDto";
import { stayTimes } from "../lodging/timesDto";
import { cruiseTimes } from "../cruise/timesDto";
import { railTimes } from "../rail/timesDto";
import { rentalTimes } from "../rental/timesDto";

export interface BookingItem {
  kind: BookingEntryKind;
  id: string;
  /** What the user recognises it by: a route, a hotel, a ship, a provider. */
  label: string;
  /** When it starts, as stored; null where the entry has no date. */
  date: Date | null;
  /**
   * The same start in the time model's shape (ADR 0002): an instant at its place's
   * zone, or a calendar day for a stay or cruise. `date` stays as the legacy mirror.
   */
  start: TimeValue | LocalDateValue | null;
  status: string;
  tripId: string | null;
  /** A stay only: the lodging it belongs to, which is where the stay is shown. */
  lodgingId?: string;
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
        depIcao: true,
        arrIata: true,
        departureTime: true,
        depTimeSemantics: true,
        depTimezone: true,
        depPrecision: true,
        status: true,
        tripId: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where,
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        stayZone: true,
        datePrecision: true,
        status: true,
        tripId: true,
        lodgingId: true,
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
        startDay: true,
        startZone: true,
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
        pickupTimezone: true,
        pickupPrecision: true,
        status: true,
        tripId: true,
      },
    }),
  ]);
  // The catalogue zone a flight without a stored one falls back to, in ONE batched
  // airport read — the same resolution the flight DTO uses.
  const depCodes = [
    ...new Set(
      flights
        .filter((f) => !f.depTimezone)
        .flatMap((f) => [f.depIata, f.depIcao])
        .filter(Boolean)
    ),
  ] as string[];
  const airports = depCodes.length
    ? await getCachedAirports(depCodes)
    : new Map<string, { timezone: string | null }>();
  const catalogueDep = (f: { depIata: string | null; depIcao: string | null }): string | null => {
    for (const code of [f.depIata, f.depIcao]) {
      const zone = code ? airports.get(code.toUpperCase())?.timezone : null;
      if (zone) return zone;
    }
    return null;
  };
  const items: BookingItem[] = [
    ...flights.map((f) => ({
      kind: "flight" as const,
      id: f.id,
      label: [f.flightNumber, route(f.depIata, f.arrIata)].filter(Boolean).join(" "),
      date: f.departureTime,
      start: flightTimes(
        {
          ...NO_DEADLINES,
          ...f,
          arrivalTime: null,
          arrTimeSemantics: f.depTimeSemantics,
          arrTimezone: null,
          arrPrecision: null,
          actualDeparture: null,
          actualArrival: null,
          runwayDepartureTime: null,
          runwayArrivalTime: null,
        },
        { dep: catalogueDep(f), arr: null }
      ).departure,
      status: f.status,
      tripId: f.tripId,
    })),
    ...stays.map((s) => ({
      kind: "stay" as const,
      id: s.id,
      label: s.lodging.name,
      lodgingId: s.lodgingId,
      date: s.checkIn,
      start: stayTimes({ ...NO_DEADLINES, ...s, checkInAt: null, checkOutAt: null }).checkIn,
      status: s.status,
      tripId: s.tripId,
    })),
    ...cruises.map((c) => ({
      kind: "cruise" as const,
      id: c.id,
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? "—",
      date: c.startDate,
      start: cruiseTimes({ ...c, endDate: null, endDay: null, endZone: null }).start,
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
      start: rentalTimes({
        ...NO_DEADLINES,
        ...r,
        returnTime: r.pickupTime,
        returnTimezone: r.pickupTimezone,
        returnPrecision: r.pickupPrecision,
        actualPickupTime: null,
        actualReturnTime: null,
        actualPickupPrecision: null,
        actualReturnPrecision: null,
      }).pickup,
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
  depTimezone: true,
  depPrecision: true,
  status: true,
  tripId: true,
} as const;

/** Columns the start reading never looks at, nulled so the shared builders can be reused. */
const NO_DEADLINES = {
  freeCancellationUntil: null,
  freeCancellationOn: null,
  freeCancellationZone: null,
  paymentDueOn: null,
  onlineCheckInOpensAt: null,
  onlineCheckInZone: null,
} as const;

function rides(
  kind: "rail" | "bus" | "ferry",
  rows: {
    id: string;
    depStationName: string;
    arrStationName: string;
    departureTime: Date;
    depTimezone: string | null;
    depPrecision: string | null;
    status: string;
    tripId: string | null;
  }[]
): BookingItem[] {
  return rows.map((r) => ({
    kind,
    id: r.id,
    label: route(r.depStationName, r.arrStationName),
    date: r.departureTime,
    start: railTimes({
      ...r,
      arrivalTime: null,
      actualDepartureTime: null,
      actualArrivalTime: null,
      arrTimezone: null,
      arrPrecision: null,
    }).departure,
    status: r.status,
    tripId: r.tripId,
  }));
}

/** True when the items span more than one kind — a package. */
export const isPackage = (items: readonly BookingItem[]): boolean =>
  new Set(items.map((i) => i.kind)).size > 1;
