import type { Flight, Prisma } from "@prisma/client";

import type { CreateFlightInput } from "../schemas/flight";

/**
 * Fields that get filled from incoming data when the existing value is
 * "empty" (null / undefined / empty string). Never overwrites an existing
 * non-empty value — the existing flight wins on every conflict.
 *
 * Rationale: if a user already has a flight from manual entry and re-imports
 * the same flight via boarding-pass scan or email parser, the second import
 * is blocked as a duplicate (issue #84). With merge=true the user can opt
 * to enrich the existing row with fields the first source didn't have
 * (seat, gate, terminal, ticket number, …) without losing curated values.
 */
const STRING_FIELDS = [
  "airline",
  "operatingAirline",
  "callsign",
  "aircraft",
  "seatNumber",
  "seatClass",
  "boardingGroup",
  "gate",
  "terminal",
  "bookingReference",
  "ticketNumber",
  "currency",
  "receiptUrl",
  "baggageAllowance",
  "frequentFlyerNumber",
  "bookingClassLetter",
  "notes",
] as const;

const NUMBER_FIELDS = ["price", "taxes", "fees"] as const;

const DATE_FIELDS = [
  "departureTime",
  "arrivalTime",
  "actualDeparture",
  "actualArrival",
] as const;

const ARRAY_FIELDS = ["tags", "companions", "coPassengers"] as const;

type StringField = (typeof STRING_FIELDS)[number];
type NumberField = (typeof NUMBER_FIELDS)[number];
type DateField = (typeof DATE_FIELDS)[number];
type ArrayField = (typeof ARRAY_FIELDS)[number];

export type MergeableField = StringField | NumberField | DateField | ArrayField;

export interface FlightMergeResult {
  patch: Prisma.FlightUpdateInput;
  mergedFields: MergeableField[];
}

const isEmptyString = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const isMissingNumber = (v: unknown): boolean => v === null || v === undefined;

const isMissingDate = (v: unknown): boolean => v === null || v === undefined;

const normalizeStringInput = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Build a merge patch that only fills fields the existing flight is missing.
 * Returns the patch and the list of field names that were filled — both empty
 * if there is nothing to merge. Caller decides whether to skip the DB update
 * entirely on an empty result.
 *
 * The Zod-validated incoming payload uses string-form ISO dates; the existing
 * Prisma row uses Date. Conversion happens here so the route handler can
 * apply the patch directly via prisma.flight.update.
 */
export function buildFlightMergePatch(
  existing: Flight,
  incoming: CreateFlightInput,
): FlightMergeResult {
  const patch: Prisma.FlightUpdateInput = {};
  const mergedFields: MergeableField[] = [];

  for (const field of STRING_FIELDS) {
    if (!isEmptyString(existing[field])) continue;
    const next = normalizeStringInput(incoming[field]);
    if (next === undefined) continue;
    (patch as Record<string, unknown>)[field] = next;
    mergedFields.push(field);
  }

  for (const field of NUMBER_FIELDS) {
    if (!isMissingNumber(existing[field])) continue;
    const next = incoming[field];
    if (next === undefined || next === null) continue;
    (patch as Record<string, unknown>)[field] = next;
    mergedFields.push(field);
  }

  for (const field of DATE_FIELDS) {
    if (!isMissingDate(existing[field])) continue;
    const next = incoming[field];
    if (next === undefined || next === null) continue;
    (patch as Record<string, unknown>)[field] = new Date(next);
    mergedFields.push(field);
  }

  for (const field of ARRAY_FIELDS) {
    const existingArr = existing[field];
    if (Array.isArray(existingArr) && existingArr.length > 0) continue;
    const incomingArr = incoming[field];
    if (!Array.isArray(incomingArr) || incomingArr.length === 0) continue;
    (patch as Record<string, unknown>)[field] = [...incomingArr];
    mergedFields.push(field);
  }

  // Recompute delayMinutes only if actualDeparture got merged AND we now
  // have both timestamps to compute against. Use the post-merge values:
  // departureTime may also have been filled in the same merge pass.
  const mergedActualDep = mergedFields.includes("actualDeparture");
  if (mergedActualDep) {
    const depRaw =
      mergedFields.includes("departureTime") && incoming.departureTime
        ? new Date(incoming.departureTime)
        : existing.departureTime;
    const actualDepRaw = incoming.actualDeparture
      ? new Date(incoming.actualDeparture)
      : null;
    if (depRaw && actualDepRaw) {
      patch.delayMinutes = Math.round(
        (actualDepRaw.getTime() - depRaw.getTime()) / 60000,
      );
    }
  }

  // Record the merge in enrichmentHistory so downstream UI ("🔍 Angereichert"
  // badge in DataSourceBadges) can surface the fact that a second source
  // contributed data. We don't claim a specific source ("boarding_pass" /
  // "email") because POST /flights doesn't know which scanner produced the
  // payload — only that fields got filled.
  if (mergedFields.length > 0) {
    const prevHistory = Array.isArray(existing.enrichmentHistory)
      ? (existing.enrichmentHistory as Prisma.JsonArray)
      : [];
    const entry: Prisma.JsonObject = {
      type: "merge",
      timestamp: new Date().toISOString(),
      fields: [...mergedFields],
    };
    patch.enrichmentHistory = [...prevHistory, entry] as Prisma.InputJsonValue;
  }

  return { patch, mergedFields };
}
