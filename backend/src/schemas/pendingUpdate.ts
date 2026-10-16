import { z } from "./zod";

/**
 * A UTC-or-offset timestamp, seconds optional, normalised to full ISO.
 *
 * Seconds are optional because a `datetime-local` input omits `:00` from its
 * value: a time typed to the minute arrived as `2025-06-01T08:45Z`, which
 * `z.string().datetime()` refuses, so the whole edit answered 400. The value
 * must still be a real instant — these are applied straight onto the flight,
 * and an unparseable string became a stored `Invalid Date` (AUD-093).
 */
const SNAPSHOT_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const snapshotInstant = z
  .string()
  .regex(SNAPSHOT_INSTANT)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid timestamp" })
  .transform((value) => new Date(value).toISOString());

const MAX_TEXT = 500;
const text = z.string().max(MAX_TEXT).nullable().optional();
const instant = snapshotInstant.nullable().optional();

/**
 * The full proposal snapshot (`FlightDataSnapshot`), every field nullable as
 * the providers write it (`convertApiDataToProposed`, historical enrichment).
 *
 * It used to know ten optional, non-null strings. The inbox card sends the
 * proposal with the user's draft on top, so Zod stripped actual times, status
 * and route — and a gate the provider reported as `null` made the edit a 400.
 * `strict()` so a misspelt field is refused instead of silently dropped, which
 * is the same loss in a different shape.
 */
export const pendingUpdateSnapshotSchema = z
  .object({
    airline: text,
    aircraft: text,
    gate: text,
    terminal: text,
    depIata: text,
    depIcao: text,
    depName: text,
    arrIata: text,
    arrIcao: text,
    arrName: text,
    departureTime: instant,
    arrivalTime: instant,
    actualDeparture: instant,
    actualArrival: instant,
    status: z.string().max(32).nullable().optional(),
    // Route geometry the server itself produced; carried through an edit, not
    // authored in it. A waypoint list or the flight's stored JSON object.
    actualRoute: z
      .union([z.array(z.unknown()).max(20_000), z.record(z.string(), z.unknown())])
      .nullable()
      .optional(),
    overflownCountries: z.array(z.string().max(8)).max(300).nullable().optional(),
    routeDistance: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();

export const updatePendingUpdateSchema = z.object({
  editedData: pendingUpdateSnapshotSchema.optional(),
});
