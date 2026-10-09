import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";
import { foldField, optionalText, wallClockOrDay } from "./wallClockInput";

/**
 * Bus rides — spec docs/superpowers/specs/2026-10-07-bus-domain-design.md.
 *
 * The WRITE vocabulary is narrower than the stored one on purpose, as for
 * rail: a client may say "scheduled" (a hint, derived over) or "cancelled"
 * (kept verbatim); `in_progress` and `completed` come from the clock.
 */
export const BUS_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const BUS_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
/** The split a statistic reader asks for (spec D1); null when unstated. */
export const BUS_RIDE_KINDS = ["intercity", "shuttle", "other"] as const;
export type BusRideKind = (typeof BUS_RIDE_KINDS)[number];
/**
 * great_circle = the straight line between the terminals (understates a road
 * by 10–40 %); user = typed from the ticket; route = the length of the line
 * routed over the road network (B3).
 */
export const BUS_DISTANCE_SOURCES = ["great_circle", "user", "route"] as const;
/** Where the map line comes from: the chord, a road-routed line (B3), or one drawn by hand. */
export const BUS_GEOMETRY_SOURCES = ["straight", "road", "manual"] as const;
export const BUS_SORT_FIELDS = ["departure", "distance", "created"] as const;

/**
 * A terminal as the client knows it. Sent whole — a name without its position
 * (or the reverse) is how a map pin ends up in the wrong city. No catalogue id:
 * a terminal comes from the geocoder or from the user's own earlier rows.
 */
export const busStationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** As printed — a coach stop is often an address, not a named building. */
  address: optionalText(300),
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

/** The fold keys a bus write understands — see `strayBusFoldKey`. */
export const BUS_FOLD_KEYS = ["departureFold", "arrivalFold"] as const;

/**
 * A `…Fold` key the schema does not know (`arrivalFolds`, `depFold`). zod
 * strips unknown keys, so a misspelt fold would be dropped without a word and
 * the ride stored at the EARLIER hour the user just said was wrong; the route
 * refuses it instead. Null when there is none.
 */
export function strayBusFoldKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const known: readonly string[] = BUS_FOLD_KEYS;
  return Object.keys(body).find((key) => /fold/i.test(key) && !known.includes(key)) ?? null;
}

const baseBusSchema = z.object({
  operator: optionalText(100),
  lineName: optionalText(40),
  rideKind: z.enum(BUS_RIDE_KINDS).nullable().optional(),
  departureStation: busStationSchema,
  arrivalStation: busStationSchema,
  departureLocal: wallClockOrDay,
  arrivalLocal: wallClockOrDay.nullable().optional(),
  /** Which occurrence of a terminal clock the zone shows twice (the autumn hour). */
  departureFold: foldField,
  arrivalFold: foldField,
  /** Only a distance the user read off the ticket. Absent or null means "measure it". */
  distanceKm: z.number().positive().max(20000).nullable().optional(),
  fareClass: optionalText(40),
  seat: optionalText(20),
  bookingReference: optionalText(40),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  status: z.enum(BUS_WRITE_STATUSES).default("scheduled"),
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
 * compare. The write service checks the INSTANTS, after it knows both zones.
 */
export const createBusJourneySchema = baseBusSchema;

export const updateBusJourneySchema = partialForUpdate(baseBusSchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const busQuerySchema = z.object({
  status: z.union([z.enum(BUS_STATUSES), z.array(z.enum(BUS_STATUSES))]).optional(),
  /** Free text over operator, line, both terminal names and the booking reference. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Calendar year of the departure, on the departure terminal's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(BUS_SORT_FIELDS).default("departure"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type BusStationInput = z.infer<typeof busStationSchema>;
export type CreateBusJourneyInput = z.infer<typeof createBusJourneySchema>;
export type UpdateBusJourneyInput = z.infer<typeof updateBusJourneySchema>;
export type BusQueryInput = z.infer<typeof busQuerySchema>;
