import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";

/**
 * A rental's relations to the user's trips and roadtrips (spec
 * 2026-10-01-rental-domain-design §7.1, §7.2).
 *
 * - Trip: the rental's local days overlapping a trip's span suggest that trip;
 *   a new rental is linked by itself only when EXACTLY one trip overlaps.
 * - Roadtrip: a roadtrip whose vehicle is a car (or campervan, motorhome,
 *   other) and whose stations' days overlap the rental is OFFERED as the
 *   roadtrip this car drove — never linked automatically (D2: offered, not
 *   automatic).
 *
 * Days are compared as `YYYY-MM-DD` keys: the rental's on its stations'
 * calendars, a trip's and a station's as the day columns already hold them.
 */

/** Vehicles a rental car can be (§7.2) — a bike or a train is not one. */
export const RENTAL_ROADTRIP_VEHICLES = ["car", "campervan", "motorhome", "other"] as const;

export interface RentalDays {
  first: string;
  last: string;
}

export function rentalDayRange(r: {
  pickupTime: Date;
  pickupTimezone: string;
  returnTime: Date;
  returnTimezone: string;
}): RentalDays {
  return {
    first: localDay(r.pickupTime, r.pickupTimezone),
    last: localDay(r.returnTime, r.returnTimezone),
  };
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Two closed day ranges overlap when neither ends before the other starts. */
export function overlaps(a: RentalDays, b: { first: string | null; last: string | null }): boolean {
  const first = b.first ?? b.last;
  const last = b.last ?? b.first;
  if (!first || !last) return false;
  return a.first <= last && first <= a.last;
}

export interface TripSuggestion {
  id: string;
  name: string;
}

/** The user's trips whose span overlaps the rental's days. */
export async function overlappingTrips(
  userId: string,
  days: RentalDays
): Promise<TripSuggestion[]> {
  const trips = await prisma.trip.findMany({
    where: { userId, status: { not: "cancelled" } },
    select: { id: true, name: true, startDay: true, endDay: true, startDate: true, endDate: true },
  });
  return trips
    .filter((t) =>
      overlaps(days, {
        first: dayOf(t.startDay) ?? dayOf(t.startDate),
        last: dayOf(t.endDay) ?? dayOf(t.endDate),
      })
    )
    .map((t) => ({ id: t.id, name: t.name }));
}

/** The one trip a new rental joins by itself, or null when none or several overlap (§7.1). */
export async function soleOverlappingTrip(
  userId: string,
  days: RentalDays
): Promise<string | null> {
  const trips = await overlappingTrips(userId, days);
  return trips.length === 1 ? trips[0].id : null;
}

export interface RoadtripSuggestion {
  id: string;
  name: string;
  vehicle: string | null;
  vehicleName: string | null;
  /** True when the roadtrip already names a rental as its car — the user may still pick this one. */
  hasRental: boolean;
}

/** Roadtrips this rental could have been the car of (§7.2). Offered only. */
export async function roadtripSuggestions(
  userId: string,
  days: RentalDays
): Promise<RoadtripSuggestion[]> {
  const routes = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip", vehicle: { in: [...RENTAL_ROADTRIP_VEHICLES] } },
    select: {
      id: true,
      name: true,
      vehicle: true,
      vehicleName: true,
      stops: { select: { startDate: true, endDate: true } },
      _count: { select: { rentals: true } },
    },
  });
  return routes
    .filter((r) => {
      const dates = r.stops
        .flatMap((s) => [dayOf(s.startDate), dayOf(s.endDate)])
        .filter((d): d is string => d !== null)
        .sort();
      return dates.length > 0 && overlaps(days, { first: dates[0], last: dates[dates.length - 1] });
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      vehicle: r.vehicle,
      vehicleName: r.vehicleName,
      hasRental: r._count.rentals > 0,
    }));
}
