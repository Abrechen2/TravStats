/**
 * Which entries a booking covers (#356; every kind since forgejo#430: flights,
 * stays, cruises, train/bus/ferry rides and rentals) — one writer for
 * the booking routes, so creating a package by hand, editing its entries and
 * deleting it file and unfile entries by the same rules.
 *
 * Rules:
 *   - Ownership first, all or nothing: one id that is not the caller's
 *     refuses the whole write with 404, before anything moves.
 *   - An entry filed on the booking joins the booking's trip when it has no
 *     trip yet; one on another trip keeps it, because a booking says who
 *     paid, not where the user grouped the journey. Creating a booking with
 *     `moveToTrip` keeps the older create behaviour for flights it names.
 *   - `replace` takes every entry of a GIVEN kind that is not listed off the
 *     booking; a kind whose list is absent is left alone.
 *   - Shared entries are snapshotted and propagated like every other write.
 */
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";
import type { DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { propagateWrites, shareSnapshots } from "../sharing/propagate";
import type { ShareEntity } from "../sharing/adapters/types";

export interface BookingEntryLists {
  flightIds?: readonly string[];
  stayIds?: readonly string[];
  cruiseIds?: readonly string[];
  railIds?: readonly string[];
  busIds?: readonly string[];
  ferryIds?: readonly string[];
  rentalIds?: readonly string[];
}

export interface BookingEntryCounts {
  flights: number;
  stays: number;
  cruises: number;
  rail: number;
  bus: number;
  ferry: number;
  rentals: number;
}

type EntryModel =
  | "flight"
  | "lodgingStay"
  | "cruise"
  | "railJourney"
  | "busJourney"
  | "ferryJourney"
  | "rentalBooking";

/** Every list, empty — what un-files a booking's entries of every kind. */
export const NO_BOOKING_ENTRIES: Required<BookingEntryLists> = {
  flightIds: [],
  stayIds: [],
  cruiseIds: [],
  railIds: [],
  busIds: [],
  ferryIds: [],
  rentalIds: [],
};

interface Delegate {
  count(args: { where: object }): Promise<number>;
  findMany(args: { where: object; select: { id: true } }): Promise<{ id: string }[]>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
}

const KINDS: readonly {
  list: keyof BookingEntryLists;
  model: EntryModel;
  share: ShareEntity;
  code: ApiErrorCode;
  count: keyof BookingEntryCounts;
}[] = [
  {
    list: "flightIds",
    model: "flight",
    share: "flight",
    code: "FLIGHT_NOT_FOUND",
    count: "flights",
  },
  {
    list: "stayIds",
    model: "lodgingStay",
    share: "lodgingStay",
    code: "STAY_NOT_FOUND",
    count: "stays",
  },
  {
    list: "cruiseIds",
    model: "cruise",
    share: "cruise",
    code: "CRUISE_NOT_FOUND",
    count: "cruises",
  },
  { list: "railIds", model: "railJourney", share: "rail", code: "RAIL_NOT_FOUND", count: "rail" },
  { list: "busIds", model: "busJourney", share: "bus", code: "BUS_NOT_FOUND", count: "bus" },
  {
    list: "ferryIds",
    model: "ferryJourney",
    share: "ferry",
    code: "FERRY_NOT_FOUND",
    count: "ferry",
  },
  {
    list: "rentalIds",
    model: "rentalBooking",
    share: "rental",
    code: "RENTAL_NOT_FOUND",
    count: "rentals",
  },
];

/**
 * The day a booking's FX snapshot is rated on: the day it was booked when the
 * user (or the imported document) said so, else the day it was recorded —
 * the only day a booking without one carries.
 */
export function bookingFxDay(bookedOn: Date | null, recordedAt: Date): Date {
  return bookedOn ?? recordedAt;
}

export async function setBookingEntries(
  tx: DbTransaction,
  userId: string,
  booking: { id: string; tripId: string | null },
  lists: BookingEntryLists,
  options: { replace?: boolean; moveToTrip?: boolean } = {}
): Promise<BookingEntryCounts> {
  let membershipChanged = false;
  const counts: BookingEntryCounts = {
    flights: 0,
    stays: 0,
    cruises: 0,
    rail: 0,
    bus: 0,
    ferry: 0,
    rentals: 0,
  };

  // Ownership of every listed id before any write.
  for (const kind of KINDS) {
    const ids = lists[kind.list];
    if (!ids || ids.length === 0) continue;
    const unique = [...new Set(ids)];
    const delegate = tx[kind.model] as unknown as Delegate;
    const owned = await delegate.count({ where: { id: { in: unique }, userId } });
    if (owned !== unique.length) {
      throw new AppError(`${kind.model} not found`, 404, kind.code, kind.list);
    }
  }

  for (const kind of KINDS) {
    const ids = lists[kind.list];
    if (ids === undefined) continue;
    const unique = [...new Set(ids)];
    const delegate = tx[kind.model] as unknown as Delegate;
    const leaving = options.replace
      ? (
          await delegate.findMany({
            where: { userId, bookingId: booking.id, id: { notIn: unique } },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [];
    const touched = [...unique, ...leaving];
    if (touched.length === 0) continue;
    const joining =
      unique.length === 0
        ? 0
        : await delegate.count({
            where: { id: { in: unique }, userId, NOT: { bookingId: booking.id } },
          });
    if (leaving.length > 0 || joining > 0) membershipChanged = true;

    const before = await shareSnapshots(tx, kind.share, touched);
    if (leaving.length > 0) {
      await delegate.updateMany({
        where: { id: { in: leaving }, userId },
        data: { bookingId: null },
      });
    }
    if (unique.length > 0) {
      const filed = await delegate.updateMany({
        where: { id: { in: unique }, userId },
        data: {
          bookingId: booking.id,
          ...(options.moveToTrip && booking.tripId ? { tripId: booking.tripId } : {}),
        },
      });
      counts[kind.count] = filed.count;
      if (booking.tripId && !options.moveToTrip) {
        await delegate.updateMany({
          where: { id: { in: unique }, userId, tripId: null },
          data: { tripId: booking.tripId },
        });
      }
    }
    await propagateWrites(tx, userId, kind.share, touched, before);
  }
  // A package split names the items it was made across (forgejo#430). Once
  // they change it no longer describes the booking; the statistics can only
  // check its item COUNT, so a swapped item would keep stale shares counting.
  // Clearing it here makes the package read "not split" everywhere at once.
  if (membershipChanged) {
    await tx.booking.updateMany({
      where: { id: booking.id, userId },
      data: { priceSplit: Prisma.DbNull },
    });
  }
  return counts;
}
