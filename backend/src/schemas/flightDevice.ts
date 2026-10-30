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
  /**
   * The fix's horizontal accuracy in metres, as the phone reports it. Read by
   * the jitter filter (forgejo#319) to tell a coarse network fix from a
   * satellite one and to size a stay; not stored.
   */
  accuracy: z.number().min(0).max(100_000).optional(),
});

export type FlightTrackPoint = z.infer<typeof flightTrackPointSchema>;

/** Upper bound on the pieces of one segmented recording. */
export const FLIGHT_TRACK_MAX_SEGMENTS = 1_000;

/**
 * The recording as one flat list (`points`) or in pieces (`segments`) —
 * exactly one of the two. A piece is a stretch the phone recorded without a
 * break: the Companion takes the fixes inside a privacy zone out of an old
 * recording and sends what is left as pieces, so the server never joins two
 * of them — not on the line, not in the distance, not in any export. A flat
 * list keeps its meaning: one stretch, cut only where the hole rule cuts it.
 * The points of all pieces together obey the same limits as a flat list.
 */
export const flightTrackUploadSchema = z
  .object({
    /** The client's id for this recording — an outbox retry sends the same one. */
    uploadId: z.string().trim().min(1).max(200),
    /** Replace a recording already stored for this flight under another id. */
    replace: z.boolean().optional(),
    points: z
      .array(flightTrackPointSchema)
      .min(2)
      .max(FLIGHT_TRACK_MAX_POINTS)
      .optional()
      .describe("The recording as one stretch. Send this or `segments`, not both."),
    segments: z
      .array(z.array(flightTrackPointSchema).min(1))
      .min(1)
      .max(FLIGHT_TRACK_MAX_SEGMENTS)
      .optional()
      .describe(
        "The recording in pieces, in time order, never joined across a break (drawn, " +
          "measured and exported apart). Send this or `points`, not both; together at least 2 " +
          `and at most ${FLIGHT_TRACK_MAX_POINTS} points. Advertised by ` +
          "`uploads.flightTrackSegments` in GET /location/capabilities."
      ),
  })
  .superRefine((body, ctx) => {
    if ((body.points === undefined) === (body.segments === undefined)) {
      ctx.addIssue({ code: "custom", path: [], message: "Send either points or segments" });
      return;
    }
    const all = body.points ?? (body.segments ?? []).flat();
    const path = (i: number): Array<string | number> => {
      if (body.points) return ["points", i, "t"];
      let rest = i;
      for (const [k, piece] of (body.segments ?? []).entries()) {
        if (rest < piece.length) return ["segments", k, rest, "t"];
        rest -= piece.length;
      }
      return ["segments"];
    };
    if (all.length < 2 || all.length > FLIGHT_TRACK_MAX_POINTS) {
      ctx.addIssue({
        code: "custom",
        path: ["segments"],
        message: `A recording holds 2 to ${FLIGHT_TRACK_MAX_POINTS} points`,
      });
      return;
    }
    // Non-decreasing, across pieces too: a GPS fix can repeat its second, it
    // cannot go back in time. One reported issue is enough — 50 000 would drown the answer.
    for (let i = 1; i < all.length; i++) {
      if (all[i].t < all[i - 1].t) {
        ctx.addIssue({
          code: "custom",
          path: path(i),
          message: "Point times must not go backwards",
        });
        return;
      }
    }
  });

/** The upload's fixes as one time-ordered list and where each piece starts in it. */
export function flightTrackUploadPieces(body: FlightTrackUpload): {
  points: FlightTrackPoint[];
  segmentStarts: number[];
} {
  if (body.points) return { points: body.points, segmentStarts: [0] };
  const segmentStarts: number[] = [];
  const points: FlightTrackPoint[] = [];
  for (const piece of body.segments ?? []) {
    segmentStarts.push(points.length);
    for (const p of piece) points.push(p);
  }
  return { points, segmentStarts };
}

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

/**
 * Where a stored flight recording came from (forgejo#193, forgejo#312): the
 * Companion's JSON upload, or a file a person uploaded on the flight page —
 * `csv` being Flightradar24's track export. A KMZ is stored as `kml`. `aeroapi`
 * is the line FlightAware recorded, fetched by the server (forgejo#409); it
 * fills a flight that has no recording of its own and yields to any upload.
 */
export const FLIGHT_TRACK_SOURCES = [
  "companion",
  "gpx",
  "kml",
  "tcx",
  "fit",
  "csv",
  "aeroapi",
] as const;
export type FlightTrackSource = (typeof FLIGHT_TRACK_SOURCES)[number];

/**
 * The text fields beside a track FILE (multipart, forgejo#312). `replace` is
 * the form-field spelling of the JSON upload's `replace: true`; anything but
 * the two words is refused rather than read as "no".
 */
export const flightTrackFileFieldsSchema = z.object({
  replace: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
