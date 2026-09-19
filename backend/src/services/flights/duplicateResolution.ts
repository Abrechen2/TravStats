import type { Flight } from "../../prisma";

import { prisma } from "../../db";
import type { CreateFlightInput } from "../../schemas/flight";
import { buildFlightMergePatch, type MergeableField } from "../../utils/flightMerge";
import { linkRowsFor, resolveCompanions } from "../companionService";

/**
 * Deciding whether an incoming flight is one the user already has, and — when
 * asked to — folding the two together.
 *
 * Split out of the POST /flights handler on 2026-09-15: the route was doing
 * two lookups, a merge patch, a companion resolution and a transaction inline,
 * which is database choreography rather than routing. The handler now asks a
 * question and answers with a status code.
 */

/**
 * What the duplicate check reads, and what it hands back in a 409.
 *
 * Both lookups select the same columns so a client that handles a day-window
 * duplicate does not have to handle a booking-reference one differently.
 */
export const DEDUPE_SELECT = {
  id: true,
  flightNumber: true,
  airline: true,
  depIata: true,
  arrIata: true,
  departureTime: true,
} as const;

export type DedupeCandidate = {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: Date | null;
};

export type DuplicateOutcome =
  /** Nothing matched — the caller should create the flight. */
  | { kind: "none" }
  /** The incoming data was folded into the existing row. */
  | { kind: "merged"; flight: Flight; mergedFields: MergeableField[] }
  /** A match the caller did not ask to merge, or could no longer read. */
  | { kind: "duplicate"; existing: DedupeCandidate; message: string };

const normalizeFlightNumber = (value: string | null): string =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Find the flight this one already is, if any.
 *
 * Two keys, in this order:
 *
 * 1. **The booking reference WITH the route.** This finds what a day window
 *    cannot: the same booking moved to another date, or reissued under another
 *    flight number. Both arrive as an updated confirmation, which the Companion
 *    posts through this very path, so without it a rebooking landed as a second
 *    flight and the logbook grew a trip nobody took (forgejo#119).
 *
 *    Never the reference alone. One PNR covers every leg of a through ticket —
 *    FRA-JFK and JFK-LAX share it — so the endpoints are what tell a rebooking
 *    apart from the next leg, and a reference-only match would fold a
 *    connection into one row.
 *
 * 2. **Normalised flight number on the same UTC day.** Pre-existing rows can
 *    hold non-canonical strings ("LH 123", "lh123") from before the
 *    schema-level normalisation landed, so the day's candidates are compared
 *    in JS rather than through a WHERE (#84).
 */
async function findExisting(
  userId: string,
  data: CreateFlightInput,
  departureUtc: Date | null
): Promise<{ existing: DedupeCandidate | null; sameBooking: boolean }> {
  if (data.bookingReference && data.departure.iata && data.arrival.iata) {
    const byBooking = await prisma.flight.findFirst({
      where: {
        userId,
        bookingReference: data.bookingReference,
        depIata: data.departure.iata,
        arrIata: data.arrival.iata,
      },
      select: DEDUPE_SELECT,
    });
    if (byBooking) return { existing: byBooking, sameBooking: true };
  }

  if (data.flightNumber && departureUtc) {
    const dayStart = new Date(departureUtc);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(departureUtc);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const dayCandidates = await prisma.flight.findMany({
      where: { userId, departureTime: { gte: dayStart, lte: dayEnd } },
      select: DEDUPE_SELECT,
    });

    const wanted = data.flightNumber; // already normalised by the schema
    const match =
      dayCandidates.find((c) => normalizeFlightNumber(c.flightNumber) === wanted) ?? null;
    if (match) return { existing: match, sameBooking: false };
  }

  return { existing: null, sameBooking: false };
}

/**
 * Fold the incoming data into an existing flight.
 *
 * Companions are resolved up front, for the same reason the create and update
 * handlers do it: `resolveCompanions` uses the top-level client and cannot join
 * a passed `tx`. They are only touched when the merge actually adopted them
 * (i.e. the existing flight had none) — otherwise `resolved` stays undefined
 * and the existing links are left completely alone, which is what fill-if-empty
 * means for a field that is also a join table.
 */
async function mergeInto(
  userId: string,
  existing: DedupeCandidate,
  data: CreateFlightInput,
  sameBooking: boolean
): Promise<DuplicateOutcome> {
  const existingFull = await prisma.flight.findUnique({ where: { id: existing.id } });
  if (!existingFull) {
    return {
      kind: "duplicate",
      existing,
      message: `Flight ${data.flightNumber} on this day already exists`,
    };
  }

  const { patch, mergedFields } = buildFlightMergePatch(existingFull, data, {
    rebooking: sameBooking,
  });

  let resolved: { id: string; displayName: string }[] | undefined;
  if (mergedFields.includes("companions")) {
    resolved = await resolveCompanions(userId, data.companions ?? []);
    patch.companions = resolved.map((c) => c.displayName);
  }

  const flight =
    mergedFields.length === 0
      ? existingFull
      : await prisma.$transaction(async (tx) => {
          if (resolved !== undefined) {
            await tx.flightCompanion.deleteMany({ where: { flightId: existing.id } });
            if (resolved.length > 0) {
              await tx.flightCompanion.createMany({
                data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
                  ...row,
                  flightId: existing.id,
                })),
                skipDuplicates: true,
              });
            }
          }
          return tx.flight.update({
            where: { id: existing.id },
            data: { ...patch, lastModifiedBy: "user" },
          });
        });

  return { kind: "merged", flight, mergedFields };
}

/**
 * The whole duplicate decision for POST /flights.
 *
 * `merge` is the caller's `?merge=true`; `?force=true` is handled before this
 * is reached, by not calling it at all.
 */
export async function resolveDuplicateFlight(args: {
  userId: string;
  data: CreateFlightInput;
  departureUtc: Date | null;
  merge: boolean;
}): Promise<DuplicateOutcome> {
  const { userId, data, departureUtc, merge } = args;

  const { existing, sameBooking } = await findExisting(userId, data, departureUtc);
  if (!existing) return { kind: "none" };

  if (merge) return mergeInto(userId, existing, data, sameBooking);

  return {
    kind: "duplicate",
    existing,
    message: sameBooking
      ? `Booking ${data.bookingReference} already has a flight on this route`
      : `Flight ${data.flightNumber} on this day already exists`,
  };
}
