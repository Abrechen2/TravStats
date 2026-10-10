import { z } from "./zod";
import { timeFieldSchema } from "../shared/time/timeInput";
import { isValidZone } from "../shared/time/zonedParts";

/**
 * A standalone note (forgejo#137) — a date, a body, optionally where it was
 * written and (through its own route) a photo. Nothing else is assumed.
 */

/** Longer than a phone's sentence (the Companion caps a moment at 600), shorter than an essay. */
export const NOTE_BODY_MAX = 4000;
export const NOTE_PLACE_NAME_MAX = 200;
export const NOTE_PRECISIONS = ["minute", "day"] as const;

const body = z
  .string()
  .trim()
  .min(1, "body must not be empty")
  .max(NOTE_BODY_MAX)
  .describe("The note itself.");

const occurredAt = timeFieldSchema({ allowDate: true, impliedPlace: true }).describe(
  "When the note is filed: `{local, zone}` as the clock showed it, an offset-bearing " +
    "instant, or `YYYY-MM-DD` for a note dated to the day. Where `occurredAt` itself names " +
    "no zone, the top-level `zone` is used, else the zone at `lat`/`lon`; with neither the " +
    "write is refused with 422 TZ_UNRESOLVED — the server never guesses."
);

const zone = z
  .string()
  .refine((value) => isValidZone(value), "ZONE_UNKNOWN")
  .describe(
    "IANA zone the note was written in. Decides the DAY the note belongs to. Only read " +
      "together with `occurredAt`."
  );

const placeName = z
  .string()
  .trim()
  .min(1)
  .max(NOTE_PLACE_NAME_MAX)
  .nullable()
  .describe("Where it was written, as text — a snapshot, not a link to a place.");
const lat = z.number().min(-90).max(90).nullable();
const lon = z.number().min(-180).max(180).nullable();

/** Half a coordinate places a note nowhere — refused, never stored. */
function positionIsPair(value: { lat?: number | null; lon?: number | null }): boolean {
  if (value.lat === undefined && value.lon === undefined) return true;
  return (value.lat ?? null) === null ? (value.lon ?? null) === null : (value.lon ?? null) !== null;
}
const POSITION_PAIR = { message: "lat and lon are sent together", path: ["lat"] };

export const createNoteSchema = z
  .strictObject({
    body,
    occurredAt,
    zone: zone.optional(),
    placeName: placeName.optional(),
    lat: lat.optional(),
    lon: lon.optional(),
  })
  .refine(positionIsPair, POSITION_PAIR);
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .strictObject({
    body: body.optional(),
    occurredAt: occurredAt.optional(),
    zone: zone.optional(),
    placeName: placeName.optional(),
    lat: lat.optional(),
    lon: lon.optional(),
  })
  .refine(positionIsPair, POSITION_PAIR)
  // A zone alone would re-label the stored instant's clock without the user
  // ever seeing the time it now reads as — refused rather than guessed.
  .refine((value) => value.zone === undefined || value.occurredAt !== undefined, {
    message: "zone is only read together with occurredAt",
    path: ["zone"],
  });
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const noteQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
