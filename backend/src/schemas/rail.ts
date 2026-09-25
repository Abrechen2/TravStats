import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";

/**
 * Rail journeys — spec docs/superpowers/specs/2026-09-25-rail-domain.md.
 *
 * The WRITE vocabulary is narrower than the stored one on purpose: a client
 * may say "scheduled" (a hint, derived over) or "cancelled" (kept verbatim);
 * `in_progress` and `completed` come from the clock, never from a request.
 */
export const RAIL_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const RAIL_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
export const RAIL_TRAVEL_CLASSES = ["first", "second", "sleeper", "couchette"] as const;
export const RAIL_DISTANCE_SOURCES = ["great_circle", "user"] as const;
/** Where the map line comes from. Phase 1 writes only `straight`. */
export const RAIL_GEOMETRY_SOURCES = [
  "none",
  "straight",
  "transitous",
  "openrailrouting",
  "manual",
] as const;
export const RAIL_SORT_FIELDS = ["departure", "distance", "created"] as const;

/**
 * The wall clock at the station, as a ticket prints it: `YYYY-MM-DDTHH:mm`,
 * seconds optional, NO offset. Whose clock it is comes from the station's
 * coordinates on the server; an offset here would be a second answer to the
 * same question.
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const wallClock = z
  .string()
  .regex(WALL_CLOCK, "must be a local wall-clock time YYYY-MM-DDTHH:mm without an offset")
  .refine((v) => !Number.isNaN(new Date(`${v}Z`).getTime()), "is not a real date and time");

/** "" and null both clear a text field; undefined leaves it alone. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

/**
 * A station as the client knows it. Sent whole — a name without its position
 * (or the reverse) is how a map pin ends up in the wrong city.
 */
export const railStationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** UIC/EVA code when known. */
  code: optionalText(20),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
});

const baseRailSchema = z.object({
  operator: optionalText(100),
  trainCategory: optionalText(20),
  trainNumber: optionalText(20),
  departureStation: railStationSchema,
  arrivalStation: railStationSchema,
  departureLocal: wallClock,
  arrivalLocal: wallClock.nullable().optional(),
  /**
   * Only for a distance the user read off the ticket. Absent or null means
   * "measure it": the server stores the great-circle distance and says so.
   */
  distanceKm: z.number().positive().max(20000).nullable().optional(),
  travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable().optional(),
  coach: optionalText(20),
  seat: optionalText(20),
  bookingReference: optionalText(40),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  status: z.enum(RAIL_WRITE_STATUSES).default("scheduled"),
  /** Arrival delay in minutes; null = not recorded, 0 = on time. */
  delayMinutes: z.number().int().min(-60).max(10000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
});

/**
 * No arrival-before-departure refine here: two wall clocks in two zones do not
 * compare (Paris 10:00 to London 10:55 is a 1 h 55 min train). The route checks
 * the INSTANTS, after it knows both zones.
 */
export const createRailJourneySchema = baseRailSchema;

export const updateRailJourneySchema = partialForUpdate(baseRailSchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const railQuerySchema = z.object({
  status: z.union([z.enum(RAIL_STATUSES), z.array(z.enum(RAIL_STATUSES))]).optional(),
  /** Free text over operator, train, stations and booking reference. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Calendar year of the departure, read in UTC. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(RAIL_SORT_FIELDS).default("departure"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type RailStationInput = z.infer<typeof railStationSchema>;
export type CreateRailJourneyInput = z.infer<typeof createRailJourneySchema>;
export type UpdateRailJourneyInput = z.infer<typeof updateRailJourneySchema>;
export type RailQueryInput = z.infer<typeof railQuerySchema>;
