import type { Flight, Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";

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

// On the existing Prisma row the column names are *Time / actual*; on the
// validated incoming payload they come as (local + timezone) pairs and we
// resolve them to a Date via fromZonedTime before comparing.
const DATE_FIELDS = [
  { existing: "departureTime", local: "departureLocal", tz: "depTimezone" },
  { existing: "arrivalTime", local: "arrivalLocal", tz: "arrTimezone" },
  { existing: "actualDeparture", local: "actualDepartureLocal", tz: "actualDepartureTz" },
  { existing: "actualArrival", local: "actualArrivalLocal", tz: "actualArrivalTz" },
] as const;

const ARRAY_FIELDS = ["tags", "coPassengers"] as const;

// "companions" is handled by name (not via ARRAY_FIELDS) below. It follows
// the exact same fill-if-empty rule as the generic array fields, but is
// pinned explicitly on purpose: companions are also materialised as
// FlightCompanion join rows written by the routes layer, so a future change
// to the generic array handling (e.g. switching it to a union) must not be
// able to silently change companion semantics too and overwrite curated
// links or union parser output into them.
const COMPANIONS_FIELD = "companions" as const;

type StringField = (typeof STRING_FIELDS)[number];
type NumberField = (typeof NUMBER_FIELDS)[number];
type DateField = (typeof DATE_FIELDS)[number]["existing"];
type ArrayField = (typeof ARRAY_FIELDS)[number] | typeof COMPANIONS_FIELD;

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

  for (const { existing: existingField, local: localField, tz: tzField } of DATE_FIELDS) {
    if (!isMissingDate((existing as Record<string, unknown>)[existingField])) continue;
    const localValue = (incoming as Record<string, unknown>)[localField];
    const tzValue = (incoming as Record<string, unknown>)[tzField];
    if (typeof localValue !== "string" || typeof tzValue !== "string") continue;
    (patch as Record<string, unknown>)[existingField] = fromZonedTime(localValue, tzValue);
    mergedFields.push(existingField);
  }

  for (const field of ARRAY_FIELDS) {
    const existingArr = existing[field];
    if (Array.isArray(existingArr) && existingArr.length > 0) continue;
    const incomingArr = incoming[field];
    if (!Array.isArray(incomingArr) || incomingArr.length === 0) continue;
    (patch as Record<string, unknown>)[field] = [...incomingArr];
    mergedFields.push(field);
  }

  // companions: fill-if-empty, same rule as the generic ARRAY_FIELDS above,
  // spelled out on purpose — see the comment on COMPANIONS_FIELD.
  {
    const existingCompanions = existing[COMPANIONS_FIELD];
    const incomingCompanions = incoming[COMPANIONS_FIELD];
    const existingIsEmpty = !Array.isArray(existingCompanions) || existingCompanions.length === 0;
    const incomingHasValue = Array.isArray(incomingCompanions) && incomingCompanions.length > 0;
    if (existingIsEmpty && incomingHasValue) {
      (patch as Record<string, unknown>)[COMPANIONS_FIELD] = [...incomingCompanions];
      mergedFields.push(COMPANIONS_FIELD);
    }
  }

  // Recompute delayMinutes only if actualDeparture got merged AND we now
  // have both timestamps to compute against. Use the post-merge values:
  // departureTime may also have been filled in the same merge pass (we read
  // it back from the patch we just built rather than from incoming, which
  // only carries the unresolved local+tz pair).
  if (mergedFields.includes("actualDeparture")) {
    const patchRecord = patch as Record<string, unknown>;
    const depRaw =
      mergedFields.includes("departureTime") && patchRecord.departureTime instanceof Date
        ? patchRecord.departureTime
        : existing.departureTime;
    const actualDepRaw = patchRecord.actualDeparture instanceof Date
      ? patchRecord.actualDeparture
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
