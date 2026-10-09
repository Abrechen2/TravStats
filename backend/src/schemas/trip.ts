import { z } from "./zod";
import { legacyDayFieldSchema, timeFieldSchema } from "../shared/time/timeInput";

export const TRIP_COLORS = [
  "#818cf8",
  "#38bdf8",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#86efac",
  "#fbbf24",
  "#f87171",
];

export const TRIP_STATUSES = ["planned", "in_progress", "completed"] as const;
export const TRIP_CATEGORIES = ["vacation", "business", "weekend", "family", "other"] as const;

const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/**
 * A trip's start/end and a journal entry's date are CALENDAR DAYS (ADR 0002
 * D1): `YYYY-MM-DD`, or an offset-bearing string read as the day it writes.
 * `z.coerce.date()` used to take any string, so "2027-05-02T00:30" was read in
 * the server's zone and could land on the neighbouring day; an offset-less
 * datetime is now refused with TIME_SHAPE_REQUIRED. Handed on as the
 * UTC-midnight `Date` the legacy columns hold.
 */
const ISO_DATE = legacyDayFieldSchema().transform((iso) => new Date(iso));

/**
 * A trip stop's start/end: the stop's wall clock — `{local}` (zone from the
 * stop's coordinates or the entry it wraps), `{local, zone}`, `YYYY-MM-DD`
 * for a day, or an instant from a token. Formerly fake UTC, so a browser's
 * bare ISO-Z is refused by the route (`routes/trips/stopTime.ts`).
 */
const STOP_TIME = timeFieldSchema({ allowDate: true, impliedPlace: true });

/**
 * Start before end, where the two can be compared without a zone: two wall
 * clocks (or days) at the same stop as written, or two instants. A mix waits
 * for the route, which has the zone.
 */
function stopTimesInOrder(start: unknown, end: unknown): boolean {
  type Parsed = { kind?: string; local?: string; date?: string; utc?: Date } | null | undefined;
  const a = start as Parsed;
  const b = end as Parsed;
  if (!a || !b) return true;
  if (a.kind === "instant" || b.kind === "instant") {
    return a.kind !== b.kind || (b.utc as Date).getTime() >= (a.utc as Date).getTime();
  }
  const wall = (t: NonNullable<Parsed>): string =>
    (t.kind === "date" ? `${t.date}T00:00` : (t.local ?? "")).slice(0, 16);
  return wall(b) >= wall(a);
}
const STRING_LIST = z.array(z.string().trim().min(1).max(80)).max(40);
const COUNTRY_LIST = z.array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")).max(60);

export const TRIP_DATE_ORDER_MESSAGE = "endDate must not precede startDate";

/**
 * A span is in order, or one of its ends is unknown.
 *
 * Trips had no such check at all: the 2026-09-20 audit created a trip running
 * 10.08.2025 to 01.08.2025 through POST (201) and again through the real web
 * form (PATCH 200), and both Web and Companion then showed "10. – 1. August
 * 2025" (SRV-TRIP-DATE-001). Cruises and stays had refused this since their
 * first schema; trips are simply where nobody wrote it down.
 *
 * Same day is allowed — a day trip is a trip. Only an end strictly BEFORE the
 * start is a span that cannot have happened.
 *
 * Exported because a PATCH has to be judged on the span it LEAVES BEHIND, not
 * on the one or two dates it happens to carry; `routes/trips.ts` asks the same
 * question of the merged row.
 */
export function tripDatesInOrder(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
): boolean {
  if (startDate == null || endDate == null) return true;
  return endDate.getTime() >= startDate.getTime();
}

const DATE_ORDER_ISSUE = { message: TRIP_DATE_ORDER_MESSAGE, path: ["endDate"] };

export const createTripSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000).optional(),
    color: HEX_COLOR.optional(),
    // Phase-1 metadata redesign — every field optional on create.
    startDate: ISO_DATE.optional(),
    endDate: ISO_DATE.optional(),
    status: z.enum(TRIP_STATUSES).optional(),
    category: z.enum(TRIP_CATEGORIES).optional(),
    tags: STRING_LIST.optional(),
    companions: STRING_LIST.optional(),
    notes: z.string().max(20000).optional(),
    summary: z.string().max(2000).optional(),
    originLabel: z.string().max(120).optional(),
    destinationLabel: z.string().max(120).optional(),
    coverImageUrl: z.string().max(500).optional(),
    icon: z.string().max(8).optional(),
    countries: COUNTRY_LIST.optional(),
  })
  .refine((d) => tripDatesInOrder(d.startDate, d.endDate), DATE_ORDER_ISSUE);

// PATCH semantics: explicit `null` clears nullable string fields, `undefined`
// leaves them untouched. Arrays accept the new full list (no element-level
// patch — keeps the contract small).
export const updateTripSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    color: HEX_COLOR.optional(),
    startDate: ISO_DATE.nullable().optional(),
    endDate: ISO_DATE.nullable().optional(),
    status: z.enum(TRIP_STATUSES).optional(),
    category: z.enum(TRIP_CATEGORIES).nullable().optional(),
    tags: STRING_LIST.optional(),
    companions: STRING_LIST.optional(),
    notes: z.string().max(20000).nullable().optional(),
    summary: z.string().max(2000).nullable().optional(),
    originLabel: z.string().max(120).nullable().optional(),
    destinationLabel: z.string().max(120).nullable().optional(),
    coverImageUrl: z.string().max(500).nullable().optional(),
    icon: z.string().max(8).nullable().optional(),
    countries: COUNTRY_LIST.optional(),
  })
  // Only catches a PATCH that carries BOTH dates. A patch that moves one of
  // them is checked against the stored row in `routes/trips.ts`, because the
  // schema cannot see what it is being merged into.
  .refine((d) => tripDatesInOrder(d.startDate, d.endDate), DATE_ORDER_ISSUE);

export const assignFlightsSchema = z.object({
  flightIds: z.array(z.string().uuid()).min(1),
  action: z.enum(["add", "remove"]),
});

export const createBookingSchema = z.object({
  tripId: z.string().uuid().optional(),
  pnr: z.string().max(20).optional(),
  price: z.number().min(0).optional(),
  // Any ISO 4217 alpha-3 code — see schemas/flight.ts for rationale.
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)")
    .optional(),
  flightIds: z.array(z.string().uuid()).optional(),
});

export const updateBookingSchema = z.object({
  /** The trip the booking belongs to; null takes it off its trip (#356). */
  tripId: z.string().uuid().nullable().optional(),
  pnr: z.string().max(20).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)")
    .nullable()
    .optional(),
});

/** `POST /trips/bookings/:id/flights` — file existing flights on a booking (#356). */
export const bookingFlightsSchema = z.object({
  flightIds: z.array(z.string().uuid()).min(1).max(100),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type AssignFlightsInput = z.infer<typeof assignFlightsSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export type TripCategory = (typeof TRIP_CATEGORIES)[number];

/* ---------------- Trip stops ---------------- */

export const createStopSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    domain: z.string().max(40).optional(),
    sourceId: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    startDate: STOP_TIME.optional(),
    endDate: STOP_TIME.optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    notes: z.string().max(20000).optional(),
    orderIdx: z.number().int().min(0).optional(),
  })
  .refine((d) => stopTimesInOrder(d.startDate, d.endDate), DATE_ORDER_ISSUE);

export const updateStopSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    domain: z.string().max(40).nullable().optional(),
    sourceId: z.string().max(120).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    startDate: STOP_TIME.nullable().optional(),
    endDate: STOP_TIME.nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    notes: z.string().max(20000).nullable().optional(),
    orderIdx: z.number().int().min(0).optional(),
  })
  .refine((d) => stopTimesInOrder(d.startDate, d.endDate), DATE_ORDER_ISSUE);

export type CreateStopInput = z.infer<typeof createStopSchema>;
export type UpdateStopInput = z.infer<typeof updateStopSchema>;

/* ---------------- Journal entries ---------------- */

/** Mirrors `JOURNAL_PHOTO_CAP` in services/trips/journalPhotos.ts. */
const JOURNAL_PHOTO_LIMIT = 12;

export const createJournalSchema = z.object({
  date: ISO_DATE,
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
  mood: z.string().max(40).optional(),
  weather: z.string().max(40).optional(),
  /** Photos of the trip's own gallery the entry shows, in order. */
  photoIds: z.array(z.string().uuid()).max(JOURNAL_PHOTO_LIMIT).optional(),
});

export const updateJournalSchema = z.object({
  date: ISO_DATE.optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20000).optional(),
  mood: z.string().max(40).nullable().optional(),
  weather: z.string().max(40).nullable().optional(),
  /** Replaces the entry's photos when present; `[]` clears them. */
  photoIds: z.array(z.string().uuid()).max(JOURNAL_PHOTO_LIMIT).optional(),
});

export type CreateJournalInput = z.infer<typeof createJournalSchema>;
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;
