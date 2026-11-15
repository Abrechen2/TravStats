import { z } from "zod";

import { registry } from "../registry";
import { sourceNotAvailable, trackOriginFields, trackSourceQuery } from "./trackOrigin";
import { errorContent, jitterDroppedField } from "./shared";
import { timeValueSchema } from "../../../shared/time/wire";
import {
  FLIGHT_TRACK_MAX_POINTS,
  FLIGHT_TRACK_SOURCES,
  flightTrackUploadSchema,
  observedTimesSchema,
} from "../../../schemas/flightDevice";

/**
 * What a paired phone sends about a flight (forgejo#193, #194):
 * `routes/flights/track.ts` and `routes/flights/observedTimes.ts`. Bare, like
 * every flights router. Both accept the session cookie or the Companion's
 * paired-device token (a write-scoped PAT).
 */

const flightParams = z.object({ id: z.string().uuid() });

const trackMeta = z.object({
  id: z.string().uuid(),
  flightId: z.string().uuid(),
  source: z
    .enum([...FLIGHT_TRACK_SOURCES, "travtrack", "dawarich"])
    .describe(
      "`companion` from the phone; the file format for an uploaded file (forgejo#312); " +
        "`aeroapi` for the line FlightAware recorded, fetched by the server (forgejo#409; an upload replaces it without `replace`); " +
        "`readsb` for the line fetched from the user's own tar1090 receiver (forgejo#408; same rule); " +
        "`travtrack` / `dawarich` for a line drawn from that provider's points (not stored)"
    ),
  uploadId: z
    .string()
    .describe(
      "The client's id for the upload; a retry sends the same one. For a file, `file:` + its SHA-256"
    ),
  deviceId: z.string().nullable().describe("The paired device that sent it; null from a browser"),
  times: z
    .object({ startedAt: timeValueSchema.nullable(), endedAt: timeValueSchema.nullable() })
    .describe(
      "First and last fix — the start on the departure airport's clock, the end on the " +
        "arrival's. An end the privacy cut removed has no time (null): the line holds no " +
        "per-vertex times"
    ),
  pointCount: z.number().int().describe("Points of the RAW recording, before simplification"),
  jitterDropped: jitterDroppedField,
  distanceKm: z
    .number()
    .describe(
      "Measured on the filtered points; stretches without a fix (steps over 50 km) excluded"
    ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const flightTrack = registry.register(
  "FlightTrack",
  trackMeta
    .extend({
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("GeoJSON LineString coordinates [lon, lat], simplified to at most 2000"),
      segmentStarts: z
        .array(z.number().int())
        .describe(
          "Index into geometry where each recorded stretch starts; the gaps between are holes"
        ),
      elevations: z
        .array(z.tuple([z.number(), z.number()]))
        .nullable()
        .describe("Altitude profile as [km, metres] pairs; null when no point carried an altitude"),
    })
    .openapi("FlightTrack")
);

registry.registerPath({
  method: "get",
  path: "/flights/{id}/track",
  summary: "The phone's recording of a flight",
  description:
    "`{ track: null }` when no recording was sent — that is an answer, not an error. Without " +
    "an own recording the line comes from the account's location provider (TravTrack: the " +
    "points linked to the flight and those in its recorder window; Dawarich: the window). " +
    "Every line is privacy-cut.",
  tags: ["Flights"],
  request: { params: flightParams, query: trackSourceQuery },
  responses: {
    200: {
      description: "The recording, or null, and where it came from",
      content: {
        "application/json": {
          schema: z.object({ track: flightTrack.nullable(), ...trackOriginFields }),
        },
      },
    },
    400: { description: "Unknown source (VALIDATION_FAILED)", content: errorContent },
    404: {
      description: `Flight not found — \`code: FLIGHT_NOT_FOUND\`; or ${sourceNotAvailable}`,
      content: errorContent,
    },
  },
});

const writeAnswer = z.object({
  track: trackMeta,
  replayed: z
    .boolean()
    .describe("True when this uploadId was already stored and nothing was written"),
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/track",
  summary: "Upload the phone's recording of a flight",
  description:
    `Up to ${FLIGHT_TRACK_MAX_POINTS} points with non-decreasing times; body at most 8 MB. ` +
    "The points come as one flat `points` list or as `segments`, pieces in time order that are " +
    "never joined — drawn, measured and exported apart (`segmentStarts`); exactly one of the " +
    "two. A server that takes `segments` says `uploads.flightTrackSegments: true` in " +
    "GET /location/capabilities. " +
    "Idempotent per uploadId: a retry answers 200 with the stored recording. A recording " +
    "under another uploadId is refused (409 TRACK_ALREADY_RECORDED) unless `replace: true`. " +
    "The span must overlap the flight's schedule widened by 12 h (422 TRACK_OUTSIDE_FLIGHT). " +
    "Kept apart from the provider route (`actualRoute`), which lookups overwrite. " +
    "Refused with 409 FLIGHT_TRACKING_DISABLED while the account's `liveTracking.enabled` " +
    "(GET /settings) is off; nothing is stored then.",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: { content: { "application/json": { schema: flightTrackUploadSchema } } },
  },
  responses: {
    200: {
      description: "Retry of a stored upload",
      content: { "application/json": { schema: writeAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: writeAnswer } } },
    400: { description: "Invalid body (VALIDATION_FAILED)", content: errorContent },
    403: { description: "Read-only token, or the shared demo account", content: errorContent },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
    409: {
      description:
        "Another recording is stored (TRACK_ALREADY_RECORDED), or the account's live " +
        "tracking is off (FLIGHT_TRACKING_DISABLED)",
      content: errorContent,
    },
    413: { description: "Body too large (TRACK_BODY_TOO_LARGE)", content: errorContent },
    422: { description: "Nowhere near the flight (TRACK_OUTSIDE_FLIGHT)", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/track/file",
  summary: "Upload a recorded flight track as a file (GPX, KML, KMZ, TCX, FIT, FR24 CSV)",
  description:
    "multipart/form-data, one file under 'file' (up to 15 MB), its format decided by its bytes; " +
    "optional field 'replace' ('true' | 'false'). Stored in the same one-per-flight recording " +
    "the phone writes, `source` = the format (a KMZ is stored as `kml`). The same bytes again answer 200 with " +
    "`replayed: true`. A file without times is placed in the flight's schedule; without a " +
    "schedule it is refused (400 TRACK_NO_TIMESTAMPS). Altitude is kept when the file has it. " +
    "Only the parsed line is stored, never the file.",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "These bytes were already stored",
      content: { "application/json": { schema: writeAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: writeAnswer } } },
    400: {
      description:
        "TRACK_FILE_MISSING, TRACK_FILE_TOO_LARGE, TRACK_NO_TIMESTAMPS, VALIDATION_FAILED " +
        "(the replace field), or why the file gave no track: TRACK_FILE_UNSUPPORTED, " +
        "TRACK_FILE_UNREADABLE (GPX/TCX/FIT), TRACK_KML_INVALID, TRACK_KML_UNPAIRED, " +
        "TRACK_KML_NO_TRACK, TRACK_KMZ_DAMAGED, TRACK_KMZ_NO_KML, TRACK_KMZ_TOO_LARGE, " +
        "TRACK_CSV_COLUMNS, TRACK_CSV_NO_POSITIONS",
      content: errorContent,
    },
    403: { description: "Read-only token, or the shared demo account", content: errorContent },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
    409: {
      description: "Another recording is stored (TRACK_ALREADY_RECORDED)",
      content: errorContent,
    },
    422: { description: "Nowhere near the flight (TRACK_OUTSIDE_FLIGHT)", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/flights/track-lines",
  summary: "Every recorded flight line of the caller, for the map",
  description:
    "One entry per flight that has a recording: the simplified line and where each recorded " +
    "stretch starts. A flight without a recording is absent, not an empty line. Under " +
    "provider TravTrack a flight without an own recording is drawn from its TravTrack points " +
    "(`origin: travtrack`); Dawarich is never asked here. Every line is privacy-cut.",
  tags: ["Flights"],
  responses: {
    200: {
      description: "The lines",
      content: {
        "application/json": {
          schema: z.object({
            lines: z.array(
              z.object({
                flightId: z.string().uuid(),
                geometry: z.array(z.tuple([z.number(), z.number()])),
                segmentStarts: z.array(z.number().int()),
                origin: z.enum(["travstats", "travtrack"]),
              })
            ),
          }),
        },
      },
    },
    401: { description: "Not logged in", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/flights/{id}/track",
  summary: "Remove the phone's recording of a flight",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "1 when a recording was removed, 0 when there was none",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
  },
});

const change = z.object({
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  type: z.enum(["added", "removed", "changed"]),
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/observed-times",
  summary: "Report the takeoff and/or landing the phone observed",
  description:
    "Evidence kind `device_gps`. Handled like a live provider's report: a past landing marks " +
    "the flight flown at once, and the times become a pending flight update " +
    "(`apiSource: device_gps`) under the user's review rule — auto-applied only when approval " +
    "is switched off AND the observation fills an empty actual time; one that would replace a " +
    "stored value always waits for review. An airport other than the flight's own is refused " +
    "(422 OBSERVED_AIRPORT_MISMATCH, `field` names the end) — a diversion is not an arrival " +
    "at the destination. Times more than 5 min ahead are refused (400 OBSERVED_TIME_IN_FUTURE), " +
    "more than 12 h off the schedule too (422 OBSERVED_TIME_OUTSIDE_FLIGHT).",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: { content: { "application/json": { schema: observedTimesSchema } } },
  },
  responses: {
    200: {
      description: "What became of the observation",
      content: {
        "application/json": {
          schema: z.object({
            outcome: z.enum(["unchanged", "pending", "applied"]),
            pendingUpdateId: z.string().uuid().nullable(),
            markedFlown: z.boolean().describe("This observation ended 'scheduled'"),
            changes: z.array(change),
          }),
        },
      },
    },
    400: { description: "Invalid body or a future time", content: errorContent },
    403: { description: "Read-only token", content: errorContent },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
    422: { description: "Not this flight's airport or schedule", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

const receiverAnswer = z.object({
  track: z.object({
    id: z.string().uuid(),
    flightId: z.string().uuid(),
    source: z.literal("readsb"),
    pointCount: z.number().int(),
    distanceKm: z.number(),
  }),
  registration: z.string().nullable().describe("The aircraft registration the trace file names"),
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/track/receiver",
  summary: "Fetch the flight's line from the account's own tar1090 / readsb receiver",
  description:
    "Looks the aircraft up by the flight's ICAO24 hex (`aircraftModeS`) in the receiver's " +
    "globe_history / trace files for the flight's UTC day(s), cuts the leg that overlaps the " +
    "schedule and stores it as the flight's recording (`source: readsb`). Optional body " +
    "`{ replace: true }` to overwrite a passenger recording; a server line (`aeroapi`, " +
    "`readsb`) is replaced without it. Each way it can fail has its own code: " +
    "RECEIVER_OFF, RECEIVER_NOT_CONFIGURED, RECEIVER_NO_AIRCRAFT, RECEIVER_NO_SCHEDULE, " +
    "RECEIVER_NOT_FOUND, RECEIVER_OUTSIDE_WINDOW, RECEIVER_AUTH, RECEIVER_TIMEOUT, " +
    "RECEIVER_UNREACHABLE, RECEIVER_ERROR, RECEIVER_BAD_TRACE, RECEIVER_TOO_LARGE, RECEIVER_WINDOW_TOO_LONG, PRIVATE_TARGET. " +
    "A fetch is bounded: window up to 2 days, 60 MB and 400 000 fixes in total, 60 s overall.",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: {
      content: {
        "application/json": { schema: z.object({ replace: z.boolean().optional() }).strict() },
      },
    },
  },
  responses: {
    200: {
      description: "A server line was replaced",
      content: { "application/json": { schema: receiverAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: receiverAnswer } } },
    400: { description: "VALIDATION_FAILED or PRIVATE_TARGET", content: errorContent },
    403: { description: "Read-only token, or the shared demo account", content: errorContent },
    404: { description: "FLIGHT_NOT_FOUND or RECEIVER_NOT_FOUND", content: errorContent },
    409: {
      description: "TRACK_ALREADY_RECORDED, RECEIVER_OFF or RECEIVER_NOT_CONFIGURED",
      content: errorContent,
    },
    422: {
      description:
        "RECEIVER_NO_AIRCRAFT, RECEIVER_NO_SCHEDULE, RECEIVER_OUTSIDE_WINDOW or RECEIVER_WINDOW_TOO_LONG",
      content: errorContent,
    },
    429: { description: "Rate limited", content: errorContent },
    502: {
      description: "RECEIVER_AUTH, RECEIVER_UNREACHABLE, RECEIVER_ERROR or RECEIVER_BAD_TRACE",
      content: errorContent,
    },
    504: { description: "RECEIVER_TIMEOUT", content: errorContent },
  },
});

const livePosition = registry.register(
  "FlightLivePosition",
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      position: z.object({
        lat: z.number(),
        lon: z.number(),
        altBaro: z.number().nullable().describe("Barometric altitude in feet; null on the ground"),
        onGround: z.boolean(),
        groundSpeed: z.number().nullable().describe("Knots"),
        track: z.number().nullable().describe("Degrees true"),
        seenSeconds: z.number().nullable().describe("Seconds since the last message"),
      }),
      source: z.enum(["adsbx", "adsblol"]),
      fetchedAt: z
        .string()
        .datetime()
        .describe("When the provider was asked (a cached answer keeps its time)"),
      icao24: z.string().nullable(),
      registration: z.string().nullable(),
    }),
    z.object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "not_live_window",
        "no_schedule",
        "no_provider",
        "no_identifier",
        "no_hit",
        "no_position",
        "provider_error",
      ]),
      failures: z
        .array(
          z.object({
            provider: z.string(),
            outcome: z.enum(["auth", "quota", "timeout", "plan_restricted", "provider_error"]),
          })
        )
        .optional()
        .describe("With `provider_error`: which provider failed and how"),
    }),
  ])
);

registry.registerPath({
  method: "get",
  path: "/flights/{id}/live-position",
  summary: "Where the flight's aircraft is right now (ADS-B community providers)",
  description:
    "For the Companion cockpit and the web flight page to poll (answers are cached 60 s; " +
    "30 requests a minute). Looks the aircraft up by ICAO24 hex, else registration, else " +
    "callsign at the enabled ADS-B providers (adsb.lol, ADS-B Exchange - both opt-in). " +
    "`status: unavailable` is a normal 200 with one stable reason: not_live_window (outside " +
    "departure - 1 h .. arrival + 3 h, or cancelled), no_schedule, no_provider (none enabled), " +
    "no_identifier, no_hit, no_position, provider_error (+ `failures`).",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "Position or reason",
      content: { "application/json": { schema: livePosition } },
    },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});
