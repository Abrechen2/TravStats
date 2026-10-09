import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { canonicalizeCompanionName } from "../../utils/companionName";
import { linkRowsFor, resolveCompanions } from "../companionService";
import { recomputeTripStatus } from "../tripStatusService";
import type { FlightBulkEdit } from "../../schemas/flightBulkEdit";

/**
 * Bulk edit of trip, tags and companions over an explicit list of flights
 * (forgejo#217).
 *
 * Each changed flight is its own unit of work: one transaction per flight,
 * one result per flight. A failure on one never rolls back another, and the
 * answer names exactly which ones failed and why — so the client can offer
 * "retry the failed ones" and send only those. Every mode is idempotent (a
 * set union, a replacement, a trip id), so a retry that reaches a flight which
 * in fact went through answers `unchanged`, never a second change.
 *
 * Built for 200 flights at once (review I2): the selected flights are read in
 * ONE query and the people they name in ONE more; every diff is computed in
 * memory, and only a flight that changes is written. Companions are looked up,
 * not upserted — only a name nobody has yet is created, once — so a bulk edit
 * never renames a person to the spelling some other flight happened to store
 * (the single-flight path's "newest spelling wins" is a per-edit rule, not one
 * for two hundred stored spellings at once). An identical repeat is therefore
 * two reads and no write.
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

interface Person {
  id: string;
  displayName: string;
}

interface NamedPerson {
  canonical: string;
  spelling: string;
}

/** One person per canonical name, in first-seen order, keeping the first spelling. */
function people(names: readonly string[]): NamedPerson[] {
  const seen = new Set<string>();
  const out: NamedPerson[] = [];
  for (const raw of names) {
    const canonical = canonicalizeCompanionName(raw);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ canonical, spelling: raw.trim() });
  }
  return out;
}

/**
 * Every person the request touches, by canonical name: one read, then one
 * find-or-create for the names that have no row yet (with the spelling they
 * were written in). Existing people keep their display name.
 */
async function directory(
  userId: string,
  names: readonly NamedPerson[]
): Promise<Map<string, Person>> {
  const map = new Map<string, Person>();
  if (names.length === 0) return map;
  const canonicals = [...new Set(names.map((n) => n.canonical))];
  const rows = await prisma.companion.findMany({
    where: { userId, canonicalName: { in: canonicals } },
    select: { id: true, displayName: true, canonicalName: true },
  });
  for (const row of rows) map.set(row.canonicalName, { id: row.id, displayName: row.displayName });
  const missing = people(names.filter((n) => !map.has(n.canonical)).map((n) => n.spelling));
  if (missing.length > 0) {
    const created = await resolveCompanions(
      userId,
      missing.map((n) => n.spelling)
    );
    for (const person of created) map.set(canonicalizeCompanionName(person.displayName), person);
  }
  return map;
}

interface FlightRow {
  id: string;
  tripId: string | null;
  tags: string[];
  companions: string[];
}

interface Plan {
  data: { tripId?: string | null; tags?: string[]; companions?: string[] };
  companionIds: string[] | null;
}

function companionPlan(
  flight: FlightRow,
  edit: NonNullable<FlightBulkEdit["companions"]>,
  persons: Map<string, Person>,
  typed: readonly NamedPerson[]
): Pick<Plan, "companionIds"> & { companions?: string[] } {
  const current = people(flight.companions);
  const target =
    edit.mode === "add"
      ? [...current, ...typed.filter((p) => !current.some((c) => c.canonical === p.canonical))]
      : [...typed];
  const unchanged =
    target.length === current.length &&
    target.every((p, i) => p.canonical === current[i].canonical);
  if (unchanged) return { companionIds: null };
  // The flight's own spelling for a person it already lists; the person's
  // stored name for one it gains.
  const own = new Map(current.map((c) => [c.canonical, c.spelling]));
  return {
    companions: target.map(
      (p) => own.get(p.canonical) ?? persons.get(p.canonical)?.displayName ?? p.spelling
    ),
    companionIds: target
      .map((p) => persons.get(p.canonical)?.id)
      .filter((id): id is string => Boolean(id)),
  };
}

/** What one flight becomes, or null when it already is. */
function planFor(
  flight: FlightRow,
  edit: FlightBulkEdit,
  persons: Map<string, Person>,
  typed: readonly NamedPerson[]
): Plan | null {
  const data: Plan["data"] = {};
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
    const plan = companionPlan(flight, edit.companions, persons, typed);
    companionIds = plan.companionIds;
    if (plan.companions) data.companions = plan.companions;
  }
  return Object.keys(data).length === 0 ? null : { data, companionIds };
}

async function writePlan(userId: string, flightId: string, plan: Plan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (plan.companionIds !== null) {
      await tx.flightCompanion.deleteMany({ where: { flightId } });
      if (plan.companionIds.length > 0) {
        await tx.flightCompanion.createMany({
          data: linkRowsFor(plan.companionIds).map((row) => ({ ...row, flightId })),
          skipDuplicates: true,
        });
      }
    }
    await tx.flight.update({
      where: { id: flightId, userId },
      data: { ...plan.data, lastModifiedBy: "user" },
    });
  });
}

export async function bulkEditFlights(
  userId: string,
  edit: FlightBulkEdit
): Promise<BulkEditResult[]> {
  await assertTripOwned(userId, edit);
  const rows = await prisma.flight.findMany({
    where: { id: { in: edit.flightIds }, userId },
    select: { id: true, tripId: true, tags: true, companions: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const typed = edit.companions ? people(edit.companions.values) : [];
  const persons = edit.companions
    ? await directory(userId, [
        ...typed,
        // Names a flight keeps in add mode, so its links can be rebuilt.
        ...(edit.companions.mode === "add" ? rows.flatMap((r) => people(r.companions)) : []),
      ])
    : new Map<string, Person>();

  const touchedTrips = new Set<string>();
  const results: BulkEditResult[] = [];
  for (const flightId of edit.flightIds) {
    const flight = byId.get(flightId);
    if (!flight) {
      results.push({ flightId, status: "failed", code: "FLIGHT_NOT_FOUND" });
      continue;
    }
    const plan = planFor(flight, edit, persons, typed);
    if (!plan) {
      results.push({ flightId, status: "unchanged" });
      continue;
    }
    try {
      await writePlan(userId, flightId, plan);
      if (plan.data.tripId !== undefined) {
        if (flight.tripId) touchedTrips.add(flight.tripId);
        if (plan.data.tripId) touchedTrips.add(plan.data.tripId);
      }
      results.push({ flightId, status: "updated" });
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
