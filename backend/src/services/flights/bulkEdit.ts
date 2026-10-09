import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { linkRowsFor, resolveCompanions } from "../companionService";
import { recomputeTripStatus } from "../tripStatusService";
import type { FlightBulkEdit } from "../../schemas/flightBulkEdit";

/**
 * Bulk edit of trip, tags and companions over an explicit list of flights
 * (forgejo#217).
 *
 * Each flight is its own unit of work: one transaction per flight, one result
 * per flight. A failure on one never rolls back another, and the answer names
 * exactly which ones failed and why — so the client can offer "retry the
 * failed ones" and send only those. Every mode is idempotent (a set union, a
 * replacement, a trip id), so a retry that reaches a flight which in fact went
 * through answers `unchanged`, never a second change.
 */

export type BulkEditStatus = "updated" | "unchanged" | "failed";

export interface BulkEditResult {
  flightId: string;
  status: BulkEditStatus;
  /** Why it failed: `FLIGHT_NOT_FOUND`, or `UPDATE_FAILED` for anything the database refused. */
  code?: "FLIGHT_NOT_FOUND" | "UPDATE_FAILED";
}

/** Union in order: what the flight has, then what is new. Exact-match dedupe. */
export function addValues(current: readonly string[], added: readonly string[]): string[] {
  const out = [...current];
  for (const value of added) if (!out.includes(value)) out.push(value);
  return out;
}

const dedupe = (values: readonly string[]): string[] => addValues([], values);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Refuses the whole request before anything is written when the trip is not the caller's. */
export async function assertTripOwned(userId: string, edit: FlightBulkEdit): Promise<void> {
  if (edit.trip?.mode !== "set") return;
  const trip = await prisma.trip.findFirst({
    where: { id: edit.trip.tripId, userId },
    select: { id: true },
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "trip");
}

async function editOne(
  userId: string,
  flightId: string,
  edit: FlightBulkEdit,
  touchedTrips: Set<string>
): Promise<BulkEditResult> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: { id: true, tripId: true, tags: true, companions: true },
  });
  if (!flight) return { flightId, status: "failed", code: "FLIGHT_NOT_FOUND" };

  const data: { tripId?: string | null; tags?: string[]; companions?: string[] } = {};
  if (edit.trip) {
    const tripId = edit.trip.mode === "set" ? edit.trip.tripId : null;
    if (tripId !== flight.tripId) data.tripId = tripId;
  }
  if (edit.tags) {
    const tags =
      edit.tags.mode === "add"
        ? addValues(flight.tags, edit.tags.values)
        : dedupe(edit.tags.values);
    if (!sameList(tags, flight.tags)) data.tags = tags;
  }
  let companionIds: string[] | null = null;
  if (edit.companions) {
    const names =
      edit.companions.mode === "add"
        ? addValues(flight.companions, edit.companions.values)
        : dedupe(edit.companions.values);
    // The same find-or-create the single-flight PUT uses, so "Anna" and
    // "anna" stay one person and the display array matches the links.
    const resolved = await resolveCompanions(userId, names);
    const displayNames = resolved.map((c) => c.displayName);
    if (!sameList(displayNames, flight.companions)) {
      data.companions = displayNames;
      companionIds = resolved.map((c) => c.id);
    }
  }
  if (Object.keys(data).length === 0) return { flightId, status: "unchanged" };

  await prisma.$transaction(async (tx) => {
    if (companionIds !== null) {
      await tx.flightCompanion.deleteMany({ where: { flightId } });
      if (companionIds.length > 0) {
        await tx.flightCompanion.createMany({
          data: linkRowsFor(companionIds).map((row) => ({ ...row, flightId })),
          skipDuplicates: true,
        });
      }
    }
    await tx.flight.update({
      where: { id: flightId, userId },
      data: { ...data, lastModifiedBy: "user" },
    });
  });
  if (data.tripId !== undefined) {
    if (flight.tripId) touchedTrips.add(flight.tripId);
    if (data.tripId) touchedTrips.add(data.tripId);
  }
  return { flightId, status: "updated" };
}

export async function bulkEditFlights(
  userId: string,
  edit: FlightBulkEdit
): Promise<BulkEditResult[]> {
  await assertTripOwned(userId, edit);
  const touchedTrips = new Set<string>();
  const results: BulkEditResult[] = [];
  // Sequential on purpose: one flight's companion upserts must not race
  // another's for the same new person.
  for (const flightId of edit.flightIds) {
    try {
      results.push(await editOne(userId, flightId, edit, touchedTrips));
    } catch (err: unknown) {
      logger.error({
        operation: "flight_bulk_edit_failed",
        userId,
        flightId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      results.push({ flightId, status: "failed", code: "UPDATE_FAILED" });
    }
  }
  // A trip's status follows its flights. A failed recompute does not undo the
  // edits that went through; it is logged and corrected on the trip's next change.
  for (const tripId of touchedTrips) {
    await recomputeTripStatus(tripId).catch((err: unknown) =>
      logger.error({
        operation: "flight_bulk_edit_trip_status_failed",
        userId,
        tripId,
        error: err instanceof Error ? err.message : "Unknown error",
      })
    );
  }
  return results;
}
