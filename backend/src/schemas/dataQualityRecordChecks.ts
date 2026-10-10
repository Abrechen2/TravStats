import { z } from "./zod";

/**
 * The `details` of the record checks (forgejo#282): duplicates, chronology,
 * a missing flight number, an unknown airport, an incomplete trip.
 *
 * Kept beside `dataQualityFlag.ts` rather than inside it so that file stays the
 * vocabulary and this one the payloads. The same wording rule binds every shape
 * here: **a flag is a question, not a verdict.** Two copies of a flight are a
 * question ("is this the same flight twice?"), not a deletion; an overlap is a
 * question ("which one is right?"), not a correction.
 */

/** The rows a record check can sit on — each is its own page, or its lodging's. */
export const RECORD_CHECK_DOMAINS = [
  "flight",
  "rail_journey",
  "bus_journey",
  "cruise",
  "lodging_stay",
] as const;
export const recordCheckDomainSchema = z.enum(RECORD_CHECK_DOMAINS);
export type RecordCheckDomain = (typeof RECORD_CHECK_DOMAINS)[number];

/**
 * Another row a finding names, so the inbox can link to it without a second
 * request. `parentId` is the lodging of a stay (the page it is edited on) and
 * null for a row that is its own page.
 */
export const relatedRecordSchema = z.object({
  entityType: recordCheckDomainSchema,
  entityId: z.string(),
  /** The row's own text ("LH 400 FRA → JFK", a lodging's name). */
  label: z.string(),
  parentId: z.string().nullable(),
});
export type RelatedRecord = z.infer<typeof relatedRecordSchema>;

/**
 * The fields two rows agreed on. Named so the question can say WHY they look
 * like one entry ("same flight number, route and day") rather than assert it.
 */
export const DUPLICATE_MATCH_FIELDS = [
  "flightNumber",
  "trainNumber",
  "lineName",
  "route",
  "departureDay",
  "departureTime",
  "lodging",
  "stayDates",
  "ship",
  "cruiseDates",
] as const;
export const duplicateMatchFieldSchema = z.enum(DUPLICATE_MATCH_FIELDS);

/**
 * The earlier entries this row looks like a second copy of.
 *
 * The flag sits on every copy EXCEPT the earliest-created one, so the question
 * is asked where the newer entry is ("this looks like a second copy of …").
 * `dataSource` and `createdAt` travel so the user can tell the mail import from
 * the hand-typed one.
 */
export const duplicateCandidateDetailsSchema = z.object({
  matchedOn: z.array(duplicateMatchFieldSchema),
  copies: z.array(
    relatedRecordSchema.extend({
      dataSource: z.string().nullable(),
      createdAt: z.string().datetime(),
    })
  ),
  /** This row's own source, for the same comparison. */
  dataSource: z.string().nullable(),
});

/**
 * Two entries that cannot both be true for one traveller.
 *
 * `domain` says which clock the four values are on: for flights they are ISO
 * instants, for stays they are calendar days (`YYYY-MM-DD`). Exactly one of the
 * two overlap figures is set — minutes for flights, nights for stays.
 */
export const chronologyConflictDetailsSchema = z.object({
  domain: z.enum(["flight", "lodging_stay"]),
  conflictWith: relatedRecordSchema,
  thisStart: z.string(),
  thisEnd: z.string(),
  otherStart: z.string(),
  otherEnd: z.string(),
  overlapMinutes: z.number().int().nullable(),
  overlapNights: z.number().int().nullable(),
});

/** The carrier the flight names — the reason a number is expected. */
export const flightNumberMissingDetailsSchema = z.object({
  airline: z.string(),
  status: z.string(),
});

/** One end of a flight whose code the catalogue does not know. */
export const airportUnknownDetailsSchema = z.object({
  endpoints: z.array(
    z.object({
      side: z.enum(["departure", "arrival"]),
      iata: z.string().nullable(),
      icao: z.string().nullable(),
      name: z.string().nullable(),
    })
  ),
});

/** A trip with a start and no end, long enough ago that it is not still running. */
export const tripEndMissingDetailsSchema = z.object({
  startDay: z.string(),
  /** The last day any linked entry reaches — a suggestion for the end, never written. */
  lastEntryDay: z.string().nullable(),
});

/** Entries linked to a trip whose days fall outside the trip's own days. */
export const tripEntriesOutsideDetailsSchema = z.object({
  startDay: z.string(),
  endDay: z.string(),
  entries: z.array(
    relatedRecordSchema.extend({
      firstDay: z.string(),
      lastDay: z.string(),
    })
  ),
});
