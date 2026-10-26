import { z } from "./zod";
import { timeValueSchema } from "../shared/time/wire";

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
  /**
   * The flagged row's first calendar day on its own clock (`YYYY-MM-DD`), so
   * the inbox files the question under that travel day. Optional: flags
   * written before it existed carry none.
   */
  day: z.string().nullable().optional(),
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
  /**
   * The flagged row's first calendar day on its own clock (`YYYY-MM-DD`) — for
   * a flight the local departure day, which `thisStart` (an instant) is not.
   * Optional: flags written before it existed carry none.
   */
  day: z.string().nullable().optional(),
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

/**
 * What a trip can hold that its days are checked against: the record-check
 * rows plus a place visit (edited on its place, which is its `parentId`).
 */
export const TRIP_ENTRY_TYPES = [...RECORD_CHECK_DOMAINS, "place_visit"] as const;
export type TripEntryType = (typeof TRIP_ENTRY_TYPES)[number];

/** Entries linked to a trip whose days fall outside the trip's own days. */
export const tripEntriesOutsideDetailsSchema = z.object({
  startDay: z.string(),
  endDay: z.string(),
  entries: z.array(
    relatedRecordSchema.extend({
      entityType: z.enum(TRIP_ENTRY_TYPES),
      firstDay: z.string(),
      lastDay: z.string(),
    })
  ),
});

/** Why a ferry ride is offered to a trip. One rule today. */
export const FERRY_MATCH_REASONS = [
  /** The crossing's days lie inside exactly one trip's days, and it is on no trip. */
  "insideTripWindow",
] as const;

/**
 * A ferry ride on no trip, whose crossing lies inside one trip's days (spec
 * 2026-10-25 C3, `ferryMatch`). Answered with `link`, which puts the ride on
 * `candidateTripId`. Trip suggestions do not cover ferries, so this is the
 * only place the question is asked.
 */
export const ferryMatchDetailsSchema = z.object({
  ferryId: z.string(),
  candidateTripId: z.string(),
  /** The trip's own name, so the question can say which trip. */
  candidateTripName: z.string(),
  departurePort: z.string().nullable(),
  arrivalPort: z.string().nullable(),
  /**
   * The departure on the port's own clock, as a `TimeValue` — the time
   * model's wire shape (ADR 0002), not a bare instant a client would have to
   * guess a zone for.
   */
  departureTime: timeValueSchema,
  reason: z.enum(FERRY_MATCH_REASONS),
});
