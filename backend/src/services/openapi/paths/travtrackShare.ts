import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * A shared trip's route snapshot (TravTrack plan T7): built by the owner on
 * request, geometry only, re-filtered by every point removal; read by the
 * trip's other members through their own copy.
 */

const tripParams = z.object({ id: z.string().describe("The trip's id") });

const geometry = z
  .array(z.array(z.tuple([z.number(), z.number()])))
  .describe("`[lon, lat][][]`, one array per line; no times, nothing near home or in a zone");

const snapshot = z.object({
  version: z.number().int().describe("Raised on every rebuild"),
  geometry,
  pointCount: z.number().int().describe("Vertices drawn"),
  createdAt: z.string().datetime(),
});

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/trips/{id}/share-snapshot",
  summary: "What of this trip's TravTrack route is shared",
  tags: ["TravTrack"],
  request: { params: tripParams },
  responses: {
    200: {
      description: "The snapshot, or null while the route is not shared",
      content: { "application/json": { schema: z.object({ snapshot: snapshot.nullable() }) } },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "put",
  path: "/trips/{id}/share-snapshot",
  summary: "Share (or refresh) this trip's TravTrack route with its members",
  description:
    "Builds a geometry-only snapshot from the trip's TravTrack points: inside the trip's days, " +
    "outside its flights, privacy-cut on the final simplified geometry, nothing within 1 km of " +
    "home. A rebuild raises the version.",
  tags: ["TravTrack"],
  request: { params: tripParams },
  responses: {
    200: {
      description: "The snapshot as shared",
      content: { "application/json": { schema: z.object({ snapshot }) } },
    },
    403: disabled,
    404: { description: "TRIP_NOT_FOUND", content: errorContent },
    409: {
      description: "TRAVTRACK_ROUTE_EMPTY: nothing of the trip's line may be shown",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/share-snapshot",
  summary: "Stop sharing this trip's route, for every recipient at once",
  tags: ["TravTrack"],
  request: { params: tripParams },
  responses: { 204: { description: "Not shared (also when it was not)" } },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/shared-route",
  summary: "The routes the other members of this shared trip share with the reader",
  description: "`id` is the reader's own copy. Geometry and version only.",
  tags: ["TravTrack"],
  request: { params: tripParams },
  responses: {
    200: {
      description: "The routes",
      content: {
        "application/json": {
          schema: z.object({
            routes: z.array(z.object({ version: z.number().int(), geometry })),
          }),
        },
      },
    },
    403: disabled,
    404: {
      description: "TRIP_NOT_FOUND, or SHARED_ROUTE_NOT_FOUND: nobody shares a route with you",
      content: errorContent,
    },
  },
});
