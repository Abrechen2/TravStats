import { z } from "./zod";
import { instantFieldSchema } from "../shared/time/timeInput";
import { isLocalDate } from "../shared/time/localDate";

/**
 * What the Companion sends of a trip it recorded (forgejo#316): coarse
 * positions, one every few minutes (~500 m / ~5 min; ~100 m / ~1 min on a
 * roadtrip). Validated here and nowhere else; the route only sees parsed
 * values.
 */

/**
 * Points per upload. A week of roadtrip at one fix a minute, sixteen waking
 * hours a day, is ~6700 points — the phone sends a day or less at a time, so
 * 5000 leaves headroom without letting one request carry a month.
 */
export const TRIP_RECORDING_MAX_POINTS = 5000;

/** Bytes, checked from `Content-Length` before the points are read. ~150 bytes a point. */
export const TRIP_RECORDING_MAX_BODY_BYTES = 1024 * 1024;

export const tripRecordingPointSchema = z.object({
  /** An ISO instant WITH an offset — one unambiguous instant, as epoch ms. */
  t: instantFieldSchema().transform((d) => d.getTime()),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  /** Horizontal accuracy in metres, as the phone reported it. */
  accuracy: z.number().finite().min(0).max(100_000).nullable().optional(),
});

export type TripRecordingPoint = z.infer<typeof tripRecordingPointSchema>;

export const tripRecordingUploadSchema = z.object({
  /** The client's id for this upload — an outbox retry sends the same one. */
  uploadId: z.string().trim().min(1).max(200),
  points: z.array(tripRecordingPointSchema).min(1).max(TRIP_RECORDING_MAX_POINTS),
});

export type TripRecordingUpload = z.infer<typeof tripRecordingUploadSchema>;

/** `GET /trips/:id/recording?day=` — one day on the trip's clock, or all. */
export const tripRecordingQuerySchema = z.object({
  day: z
    .string()
    .refine(isLocalDate, "A calendar day, YYYY-MM-DD")
    .optional()
    .describe("Only this day, on the trip's clock (`YYYY-MM-DD`); all days when absent"),
  source: z
    .enum(["travstats", "travtrack", "dawarich"])
    .optional()
    .describe("Show this source explicitly (TravTrack plan T5); the default otherwise"),
});

/** The account switch, nested in `GET`/`PUT /settings` as `tripRecording`. */
export const tripRecordingSettingsSchema = z.object({ enabled: z.boolean() }).partial().strict();
