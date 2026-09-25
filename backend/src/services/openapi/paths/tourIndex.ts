/**
 * The two dashboard-wide tour endpoints on `routes/trips/tourIndex.ts` —
 * `GET /tours` and `POST /tours/geometry/batch`. Split into its own
 * module rather than folded into `./tours.ts` because that file was
 * already at the 800-line hard maximum before these existed; the same
 * reasoning `tourLegs.ts` / `tourRouting.ts` / `tourTracks.ts` split off
 * `routes/trips/tourRoutes.ts` as their own router files.
 *
 * Unlike every other tour endpoint (which is trip-scoped, `/trips/{id}/
 * routes/...`), these two span every trip the caller owns, so neither
 * path carries an `{id}` segment.
 *
 * `GET /tours` keeps `./tours.ts`'s bare-object convention
 * (`{ tours: [...] }`); the batch endpoint instead mirrors
 * `POST /cruises/geometry/batch`'s `{ data: { [id]: FeatureCollection } }`
 * shape — minus cruise's `success` flag, matching this file's own
 * bare-object habit — because it solves the identical problem the same
 * way: one round trip for a map view instead of N sequential GETs, and a
 * section id the caller does not own is silently omitted rather than
 * failing the whole batch.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { legMode, tourRouteGeometry } from "./tours";
import { listToursQuerySchema } from "../../../schemas/roadtrip";
import { ROADTRIP_VEHICLES, ROUTE_KINDS, TOUR_ACTIVITIES } from "../../../shared/tour/roadtrip";

const tourSummary = registry.register(
  "TourSummary",
  z
    .object({
      id: z.string().uuid(),
      tripId: z.string().uuid().nullable(),
      tripName: z
        .string()
        .nullable()
        .describe("The owning trip's name, so a dashboard list needs no second lookup"),
      name: z.string(),
      mode: legMode.describe("The section's own default mode, not any one leg's"),
      kind: z.enum(ROUTE_KINDS),
      activity: z.enum(TOUR_ACTIVITIES).nullable(),
      vehicle: z.enum(ROADTRIP_VEHICLES).nullable(),
      kindAssignedAutomatically: z.boolean(),
      notes: z.string().nullable(),
      anchorStopId: z
        .string()
        .uuid()
        .nullable()
        .describe("A tour only: the roadtrip station it set out from"),
      anchorStopTitle: z
        .string()
        .nullable()
        .describe("That station's title, so the spreadsheet can write a readable reference"),
      distanceKm: z
        .number()
        .describe(
          "A tour with a recording: the recordings' raw distance. Otherwise the sum of its legs."
        ),
      distanceSource: z.enum(["track", "legs"]),
      ascentM: z
        .number()
        .nullable()
        .describe("Summed over the recordings; null when none has elevation"),
      movingSeconds: z.number().nullable(),
      trackCount: z.number().int(),
      stopCount: z.number().int(),
      startDate: z
        .string()
        .datetime()
        .nullable()
        .describe(
          "Earliest dated stop's startDate. Null if no stop in the section carries a date."
        ),
      endDate: z
        .string()
        .datetime()
        .nullable()
        .describe(
          "Latest dated stop's endDate (falling back to its startDate for a single-day stop)."
        ),
    })
    .openapi("TourSummary", {
      example: {
        id: "b6b6f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2a",
        tripId: "a1a1a1a1-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
        tripName: "Norwegen 2024",
        name: "Süd-Norwegen",
        mode: "road",
        kind: "tour",
        activity: "hike",
        vehicle: null,
        kindAssignedAutomatically: false,
        notes: null,
        anchorStopId: null,
        anchorStopTitle: null,
        distanceKm: 305.4,
        distanceSource: "legs",
        ascentM: null,
        movingSeconds: null,
        trackCount: 0,
        stopCount: 2,
        startDate: "2024-07-01T00:00:00.000Z",
        endDate: "2024-07-05T00:00:00.000Z",
      },
    })
);

registry.registerPath({
  method: "get",
  path: "/tours",
  summary: "List every tour section the caller owns, across all trips",
  description:
    "Feeds the all-trips dashboard map: one row per section, from every " +
    "trip the caller owns, ordered by the owning trip's start date and " +
    "then the section's own position within it. No geometry — a line is " +
    "location data, and a list call must not ship megabytes of it; fetch " +
    "geometry for the sections you actually render via the batch endpoint " +
    "below. Mirrors why the recorded-tracks list omits geometry too.",
  tags: ["Tours"],
  request: { query: listToursQuerySchema },
  responses: {
    200: {
      description: "Every section the caller owns",
      content: { "application/json": { schema: z.object({ tours: z.array(tourSummary) }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/tours/geometry/batch",
  summary: "Map geometry for several tour sections at once",
  description:
    "Same per-section geometry `GET /trips/{id}/routes/{routeId}/geometry` " +
    "returns, keyed by route id — one round trip for the dashboard map " +
    "instead of N sequential GETs. Copies `POST /cruises/geometry/batch`'s " +
    "behaviour exactly: a section id the caller does not own is silently " +
    "OMITTED from the response rather than failing the whole batch.",
  tags: ["Tours"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Geometry per route id",
      content: {
        "application/json": { schema: z.object({ data: z.record(z.string(), tourRouteGeometry) }) },
      },
    },
    400: { description: "Validation failed", content: errorContent },
  },
});
