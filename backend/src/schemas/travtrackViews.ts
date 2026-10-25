import { z } from "./zod";
import { inOrder, oneForm, rangeFields } from "./travtrack";

/**
 * What the Track area's further views ask of the server (TravTrack plan
 * T5.3): a range of the map, one point to delete, a flight's panel, photos of
 * a window, the stays and the calendar. Beside `travtrack.ts`, which carries
 * capture, the day, the export and the zones.
 */

/** The longest span one range read covers (a year and a bit). */
export const TRAVTRACK_RANGE_MAX_DAYS = 400;

const cursor = z
  .string()
  .regex(/^\d{1,15}:\d{1,19}$/)
  .optional()
  .describe("Continue after this point (`cursor` of the previous part)");

/** `GET /travtrack/range` — two instants, or two days on the profile clock, both inclusive. */
export const travTrackRangeViewQuerySchema = z
  .object({ ...rangeFields, cursor })
  .refine(oneForm, "Either `from` and `to`, or `fromDay` and `toDay`")
  .refine(inOrder, "The span must not end before it starts");

/** A stored point's id (`DELETE /travtrack/points/:id`). */
export const travTrackPointIdSchema = z.string().uuid();

/** A flight's id (`GET /travtrack/flights/:id/panel`). */
export const travTrackFlightIdSchema = z.string().uuid();

/** The longest window one photo request covers, in days. */
export const TRAVTRACK_PHOTO_MAX_DAYS = 7;

const photoWindow = {
  from: z.string().datetime({ offset: true }).describe("Inclusive instant"),
  to: z.string().datetime({ offset: true }).describe("Exclusive instant"),
};

const photoWindowInOrder = (q: { from: string; to: string }) =>
  Date.parse(q.from) < Date.parse(q.to);

/** `GET /travtrack/photos?from&to`. */
export const travTrackPhotosQuerySchema = z
  .object(photoWindow)
  .refine(photoWindowInOrder, "The window must not end before it starts");

/** `GET /travtrack/photos/:assetId/file?from&to&size` — the window is the grant. */
export const travTrackPhotoFileQuerySchema = z
  .object({
    ...photoWindow,
    size: z
      .enum(["thumbnail", "preview"])
      .default("thumbnail")
      .describe("Re-encoded renditions only: an original would carry its EXIF"),
  })
  .refine(photoWindowInOrder, "The window must not end before it starts");

export const travTrackPhotoAssetIdSchema = z.string().uuid();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type StayState = "pending" | "accepted" | "rejected";
const STATES = /^(pending|accepted|rejected)(,(pending|accepted|rejected))*$/;

/** `GET /travtrack/stays`. */
export const travTrackStaysQuerySchema = z
  .object({
    status: z
      .string()
      .regex(STATES, "status is a comma-separated list of pending, accepted, rejected")
      .default("pending,accepted,rejected")
      .transform((raw) => [...new Set(raw.split(",") as StayState[])])
      .describe("Comma-separated states, default all three"),
    fromDay: day.optional().describe("First day, inclusive, on the profile's clock"),
    toDay: day.optional().describe("Last day, inclusive, on the profile's clock"),
    cursor: z
      .string()
      .regex(/^\d{1,15}:[0-9a-f-]{36}$/)
      .optional()
      .describe("Continue after this stay (`nextCursor` of the previous page)"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine(
    (q) => (q.fromDay === undefined) === (q.toDay === undefined),
    "`fromDay` and `toDay` move together"
  )
  .refine((q) => q.fromDay === undefined || q.fromDay <= (q.toDay ?? ""), {
    message: "The span must not end before it starts",
  });
