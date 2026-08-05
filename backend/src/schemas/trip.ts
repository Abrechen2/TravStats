import { z } from "zod";

export const TRIP_COLORS = [
  "#818cf8", "#38bdf8", "#34d399", "#fb923c", "#f472b6",
  "#a78bfa", "#22d3ee", "#86efac", "#fbbf24", "#f87171",
];

export const TRIP_STATUSES = ["planned", "in_progress", "completed"] as const;
export const TRIP_CATEGORIES = ["vacation", "business", "weekend", "family", "other"] as const;

const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const ISO_DATE = z.string().datetime().or(z.coerce.date()).transform((d) => new Date(d));
const STRING_LIST = z.array(z.string().min(1).max(80)).max(40);
const COUNTRY_LIST = z.array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")).max(60);

export const createTripSchema = z.object({
  name: z.string().min(1).max(200),
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
});

// PATCH semantics: explicit `null` clears nullable string fields, `undefined`
// leaves them untouched. Arrays accept the new full list (no element-level
// patch — keeps the contract small).
export const updateTripSchema = z.object({
  name: z.string().min(1).max(200).optional(),
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
});

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
  pnr: z.string().max(20).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)")
    .nullable()
    .optional(),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type AssignFlightsInput = z.infer<typeof assignFlightsSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export type TripCategory = (typeof TRIP_CATEGORIES)[number];

/* ---------------- Trip stops ---------------- */

export const createStopSchema = z.object({
  title: z.string().min(1).max(200),
  domain: z.string().max(40).optional(),
  sourceId: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  startDate: ISO_DATE.optional(),
  endDate: ISO_DATE.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  notes: z.string().max(20000).optional(),
  orderIdx: z.number().int().min(0).optional(),
});

export const updateStopSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  domain: z.string().max(40).nullable().optional(),
  sourceId: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  startDate: ISO_DATE.nullable().optional(),
  endDate: ISO_DATE.nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  orderIdx: z.number().int().min(0).optional(),
});

export type CreateStopInput = z.infer<typeof createStopSchema>;
export type UpdateStopInput = z.infer<typeof updateStopSchema>;

/* ---------------- Journal entries ---------------- */

export const createJournalSchema = z.object({
  date: ISO_DATE,
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
  mood: z.string().max(40).optional(),
  weather: z.string().max(40).optional(),
});

export const updateJournalSchema = z.object({
  date: ISO_DATE.optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20000).optional(),
  mood: z.string().max(40).nullable().optional(),
  weather: z.string().max(40).nullable().optional(),
});

export type CreateJournalInput = z.infer<typeof createJournalSchema>;
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;
