import { z } from "./zod";
import { instantFieldSchema } from "../shared/time/timeInput";

/**
 * What a paired phone sends about a flight it was on (forgejo#193, #194):
 * the GPS recording, and the takeoff/landing it observed. Both bodies are
 * validated here and nowhere else; the routes only ever see parsed values.
 */

/**
 * Upper bound on points in one recording. A 14-hour flight logged every two
 * seconds is ~25 000 points; twice that leaves headroom for a denser logger
 * and still keeps a body far below the 10 MB JSON limit.
 */
export const FLIGHT_TRACK_MAX_POINTS = 50_000;

/** Bytes. Checked from `Content-Length` before the points are read. */
export const FLIGHT_TRACK_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** 2000-01-01T00:00:00Z — no phone recorded a flight before it. */
const EARLIEST_MS = 946_684_800_000;
/** 2100-01-01T00:00:00Z. */
const LATEST_MS = 4_102_444_800_000;

/**
 * A point's time: epoch milliseconds (compact, what a GPS logger keeps) or an
 * ISO instant with an offset. Either is one unambiguous instant; both come out
 * as epoch milliseconds.
 */
const pointTime = z.union([
  z.number().int().min(EARLIEST_MS).max(LATEST_MS),
  instantFieldSchema().transform((d) => d.getTime()),
]);

export const flightTrackPointSchema = z.object({
  t: pointTime,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Metres above sea level. */
  alt: z.number().min(-1_000).max(30_000).optional(),
  /** Metres per second, ground speed. Validated, not stored. */
  speed: z.number().min(0).max(1_000).optional(),
});

export type FlightTrackPoint = z.infer<typeof flightTrackPointSchema>;

export const flightTrackUploadSchema = z
  .object({
    /** The client's id for this recording — an outbox retry sends the same one. */
    uploadId: z.string().trim().min(1).max(200),
    /** Replace a recording already stored for this flight under another id. */
    replace: z.boolean().optional(),
    points: z.array(flightTrackPointSchema).min(2).max(FLIGHT_TRACK_MAX_POINTS),
  })
  .superRefine((body, ctx) => {
    // Non-decreasing: a GPS fix can repeat its second, it cannot go back in
    // time. One reported issue is enough — 50 000 would drown the answer.
    for (let i = 1; i < body.points.length; i++) {
      if (body.points[i].t < body.points[i - 1].t) {
        ctx.addIssue({
          code: "custom",
          path: ["points", i, "t"],
          message: "Point times must not go backwards",
        });
        return;
      }
    }
  });

export type FlightTrackUpload = z.infer<typeof flightTrackUploadSchema>;

/**
 * An airport code as the phone names it: IATA (3) or ICAO (4) letters/digits.
 * Upper-cased so the comparison with the flight's codes is exact.
 */
const airportCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{3,4}$/, "An IATA or ICAO airport code")
  .transform((s) => s.toUpperCase());

const observedEnd = z.object({
  at: instantFieldSchema(),
  /** Where the device saw it happen; checked against the flight's own airport. */
  airport: airportCode.optional(),
});

export const observedTimesSchema = z
  .object({
    /** The client's id for this observation, kept on the suggestion for provenance. */
    observationId: z.string().trim().min(1).max(200).optional(),
    departure: observedEnd.optional(),
    arrival: observedEnd.optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.departure && !body.arrival) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Send an observed departure, an observed arrival, or both",
      });
    }
    if (body.departure && body.arrival && body.arrival.at <= body.departure.at) {
      ctx.addIssue({
        code: "custom",
        path: ["arrival", "at"],
        message: "The observed arrival must be after the observed departure",
      });
    }
  });

export type ObservedTimes = z.infer<typeof observedTimesSchema>;
