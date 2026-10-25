import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackMonthsQuerySchema } from "../../../schemas/travtrack";
import {
  travTrackPhotoFileQuerySchema,
  travTrackPhotosQuerySchema,
  travTrackRangeViewQuerySchema,
  travTrackStaysQuerySchema,
} from "../../../schemas/travtrackViews";

/**
 * The Track area's further views (TravTrack plan T5.3): range, single-point
 * delete, flight panel, photos, stays and calendar. Beside `travtrack.ts`.
 */

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const storedPoint = z
  .tuple([z.number().int(), z.number(), z.number(), z.number().nullable()])
  .describe("`[tMs, lat, lon, accuracyM]`");

const range = z.object({
  from: z.string().describe("The span's first instant"),
  to: z.string().describe("The span's end, exclusive"),
  segments: z
    .array(z.array(storedPoint))
    .describe(
      "Privacy-safe stretches, simplified and privacy-cut again after simplifying; never " +
        "join two, nor the stretches of two parts"
    ),
  pointIds: z
    .array(z.array(z.string()))
    .describe("The stored point of each vertex, aligned with `segments`"),
  pointCount: z.number().int().describe("Vertices given"),
  readCount: z.number().int().describe("Privacy-safe vertices this part read, before simplifying"),
  simplified: z.boolean().describe("Vertices were dropped to fit 10 000 per part"),
  omittedSegments: z
    .number()
    .int()
    .describe("Stretches left out because even two vertices each would not fit; normally 0"),
  next: z.string().nullable().describe("The first instant not read, or null at the span's end"),
  cursor: z
    .string()
    .nullable()
    .describe("`<tMs>:<seq>` — ask again with it for the next part; null at the span's end"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/range",
  summary: "A span of the TravTrack history for the map",
  description:
    "Monat / Jahr / Zeitraum: at most 400 days, read 50 000 points per part and simplified " +
    "to at most 10 000 vertices. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { query: travTrackRangeViewQuerySchema },
  responses: {
    200: { description: "One part", content: { "application/json": { schema: range } } },
    400: {
      description: "VALIDATION_FAILED, or TRAVTRACK_RANGE_TOO_LONG: more than 400 days",
      content: errorContent,
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/points/{id}",
  summary: "Delete one point",
  description:
    "Exactly the named point — never the other fixes of its instant — with the invalidation " +
    "a range delete runs: the findings resting on it, its share-route vertex, and its day's " +
    "and neighbours' country days, explored cells and monthly values. Final: the same fix " +
    "(same second and position) sent again by any source is dropped as `deleted_range`. " +
    "Reachable with " +
    "TravTrack off while the account holds data.",
  tags: ["TravTrack"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: {
      description: "TRAVTRACK_POINT_NOT_FOUND: no such point of this account",
      content: errorContent,
    },
  },
});

const panel = z.object({
  flightId: z.string(),
  series: z
    .array(
      z.array(
        z
          .tuple([z.number().int(), z.number().nullable(), z.number().nullable()])
          .describe("`[tMs, altitudeM, speedMps]`; null where the phone gave none")
      )
    )
    .describe("The linked privacy-safe points as stretches; never join two"),
  pointCount: z.number().int(),
  truncated: z.boolean().describe("More linked points than one answer carries"),
  summary: z.object({
    maxAltitudeM: z.number().nullable().describe("Null without a single altitude"),
    maxSpeedMps: z.number().nullable().describe("Null without a single speed"),
    climbToCruiseMinutes: z
      .number()
      .nullable()
      .describe(
        "From a near-ground first vertex to 90 % of the highest altitude in one stretch; " +
          "null when not derivable — never 0"
      ),
  }),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/flights/{id}/panel",
  summary: "A flight's altitude and speed from its linked TravTrack points",
  tags: ["TravTrack"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "The panel", content: { "application/json": { schema: panel } } },
    403: disabled,
    404: {
      description: "TRAVTRACK_FLIGHT_NOT_FOUND: no such flight of this account",
      content: errorContent,
    },
  },
});

const immichFailure = z.object({
  error: z
    .enum(["notConfigured", "unreachable", "auth", "notFound", "protocol", "invalidUrl"])
    .describe("The Immich failure kind"),
  message: z.string().optional(),
});

const photos = z.object({
  photos: z.array(
    z.object({
      assetId: z.string(),
      type: z.enum(["IMAGE", "VIDEO"]),
      takenAt: z.string(),
      lat: z.number().describe("On the privacy-safe track at `takenAt`; never the photo's EXIF"),
      lon: z.number(),
    })
  ),
  truncated: z
    .boolean()
    .describe(
      "Not every photo of the window was considered: Immich held more than one search returns, " +
        "or the track was longer than one read (`trackTruncated`); a shorter window shows the rest"
    ),
  trackTruncated: z
    .boolean()
    .describe("The window's track was longer than one read: later photos are not placed"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/photos",
  summary: "Photos taken during a window, placed on the own track",
  description:
    "From the account's Immich connection. Only photos whose time lies inside a privacy-safe " +
    "stretch are returned, positioned on it; one in a privacy zone or a cut is left out. " +
    "At most 7 days. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { query: travTrackPhotosQuerySchema },
  responses: {
    200: { description: "The photos", content: { "application/json": { schema: photos } } },
    400: {
      description: "VALIDATION_FAILED, or TRAVTRACK_PHOTO_WINDOW_TOO_LONG: more than 7 days",
      content: errorContent,
    },
    403: disabled,
    409: {
      description: "notConfigured: no Immich connection",
      content: { "application/json": { schema: immichFailure } },
    },
    502: {
      description: "Immich failed: unreachable, auth, notFound, protocol or invalidUrl",
      content: { "application/json": { schema: immichFailure } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/photos/{assetId}/file",
  summary: "Stream a placed photo's thumbnail or preview",
  description:
    "Granted by the window's list: an asset the same `from`/`to` does not place is 404. " +
    "Renditions only. Private immutable caching; a 1x1 placeholder on an upstream failure.",
  tags: ["TravTrack"],
  request: {
    params: z.object({ assetId: z.string().uuid() }),
    query: travTrackPhotoFileQuerySchema,
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    403: disabled,
    404: { description: "notFound", content: errorContent },
  },
});

const stays = z.object({
  stays: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["pending", "accepted", "rejected"]),
      provider: z.string().describe("`dawarich` or `travtrack`"),
      day: z.string().describe("The first day, on the stay's own zone's clock"),
      startAt: z.string(),
      endAt: z.string(),
      zone: z.string(),
      position: z
        .object({ lat: z.number(), lon: z.number() })
        .nullable()
        .describe("Null inside a privacy circle"),
      name: z.string().nullable(),
      place: z.object({ id: z.string(), name: z.string() }).nullable(),
      tripId: z.string().nullable(),
      visitId: z.string().nullable(),
      detectedAt: z.string(),
      resolvedAt: z.string().nullable(),
    })
  ),
  nextCursor: z.string().nullable(),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/stays",
  summary: "The account's stays across their states",
  description:
    "From the stays store (Dawarich and TravTrack findings); reviewed through " +
    "`/dawarich-stays/{id}/accept|reject`. Pending is empty while stay suggestions are off.",
  tags: ["TravTrack"],
  request: { query: travTrackStaysQuerySchema },
  responses: {
    200: { description: "The stays", content: { "application/json": { schema: stays } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: disabled,
  },
});

const calendar = z.object({
  year: z.number().int(),
  days: z
    .array(
      z.object({
        day: z.string().describe("`YYYY-MM-DD`, a UTC day"),
        kmGround: z.number(),
        recorded: z.literal(true),
      })
    )
    .describe(
      "Days with a privacy-safe vertex; a day absent from a settled month was not recorded"
    ),
  pending: z.array(z.string()).describe("`YYYY-MM` still being prepared: days may change"),
  unavailable: z
    .array(z.string())
    .describe("`YYYY-MM` whose day values are not known yet: not passed off as empty"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/calendar",
  summary: "Ground kilometres per day of a year",
  tags: ["TravTrack"],
  request: { query: travTrackMonthsQuerySchema },
  responses: {
    200: { description: "The calendar", content: { "application/json": { schema: calendar } } },
    400: { description: "VALIDATION_FAILED: not a year", content: errorContent },
    403: disabled,
  },
});
