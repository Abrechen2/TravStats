/** Ferry crossings (dennis/TravStats forgejo#293). */
import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";
import { foldField, optionalText, wallClockOrDay } from "./wallClockInput";

export const FERRY_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const FERRY_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
export const FERRY_DISTANCE_SOURCES = ["great_circle", "user"] as const;
export const FERRY_GEOMETRY_SOURCES = ["straight", "manual"] as const;
export const FERRY_SORT_FIELDS = ["departure", "distance", "created"] as const;

export const ferryStationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: optionalText(300),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
});

export const FERRY_FOLD_KEYS = ["departureFold", "arrivalFold"] as const;

export function strayFerryFoldKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const known: readonly string[] = FERRY_FOLD_KEYS;
  return Object.keys(body).find((key) => /fold/i.test(key) && !known.includes(key)) ?? null;
}

const baseFerrySchema = z.object({
  operator: optionalText(100),
  vesselName: optionalText(100),
  vehicleType: optionalText(80),
  vehicleRegistration: optionalText(40),
  vehicleLengthM: z.number().positive().max(100).nullable().optional(),
  vehicleWidthM: z.number().positive().max(30).nullable().optional(),
  vehicleHeightM: z.number().positive().max(30).nullable().optional(),
  passengerCount: z.number().int().positive().max(1000).nullable().optional(),
  cabinType: optionalText(100),
  ticketReference: optionalText(100),
  departureStation: ferryStationSchema,
  arrivalStation: ferryStationSchema,
  departureLocal: wallClockOrDay,
  arrivalLocal: wallClockOrDay.nullable().optional(),
  departureFold: foldField,
  arrivalFold: foldField,
  distanceKm: z.number().positive().max(20000).nullable().optional(),
  fareClass: optionalText(40),
  seat: optionalText(20),
  bookingReference: optionalText(40),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  status: z.enum(FERRY_WRITE_STATUSES).default("scheduled"),
  delayMinutes: z.number().int().min(-60).max(10000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
});

export const createFerryJourneySchema = baseFerrySchema;

export const updateFerryJourneySchema = partialForUpdate(baseFerrySchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const ferryQuerySchema = z.object({
  status: z.union([z.enum(FERRY_STATUSES), z.array(z.enum(FERRY_STATUSES))]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(FERRY_SORT_FIELDS).default("departure"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type FerryStationInput = z.infer<typeof ferryStationSchema>;
export type CreateFerryJourneyInput = z.infer<typeof createFerryJourneySchema>;
export type UpdateFerryJourneyInput = z.infer<typeof updateFerryJourneySchema>;
export type FerryQueryInput = z.infer<typeof ferryQuerySchema>;
