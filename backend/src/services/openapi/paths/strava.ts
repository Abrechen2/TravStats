/**
 * Strava (2.7, design 2026-09-24 §5): the operator's app, the user's OAuth
 * round trip, the activity list and the two imports.
 *
 * Every Strava failure answers `{ error, kind }` with `kind` from the fixed
 * vocabulary `notConfigured | unreachable | auth | notFound | protocol |
 * rateLimited` — the frontend maps each to one sentence.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const stravaError = {
  content: {
    "application/json": {
      schema: z.object({
        error: z.string(),
        kind: z.enum([
          "notConfigured",
          "unreachable",
          "auth",
          "notFound",
          "protocol",
          "rateLimited",
        ]),
      }),
    },
  },
};

const status = registry.register(
  "StravaStatus",
  z
    .object({
      configured: z.boolean().describe("The operator has registered a Strava application"),
      connected: z.boolean().describe("This user has connected their Strava account"),
      athleteId: z.string().nullable(),
    })
    .openapi("StravaStatus")
);

const activity = registry.register(
  "StravaActivity",
  z
    .object({
      id: z.string(),
      name: z.string(),
      sportType: z.string(),
      startDate: z.string(),
      distanceKm: z.number(),
      movingSeconds: z.number(),
      ascentM: z.number().nullable(),
      hasRoute: z.boolean().describe("False for an indoor workout — nothing to import"),
    })
    .openapi("StravaActivity")
);

const adminStrava = z.object({
  clientId: z.string().nullable(),
  secretSet: z.boolean().describe("The secret is write-only; this says only whether one is set"),
  envConfigured: z.boolean(),
});

const importedTrack = z.object({
  id: z.string().uuid(),
  distanceKm: z.number(),
  ascentM: z.number().nullable(),
});

registry.registerPath({
  method: "get",
  path: "/admin/strava",
  summary: "The operator's Strava application",
  tags: ["Admin", "Strava"],
  responses: {
    200: { description: "Settings", content: { "application/json": { schema: adminStrava } } },
  },
});

registry.registerPath({
  method: "put",
  path: "/admin/strava",
  summary: "Set or clear the operator's Strava application",
  tags: ["Admin", "Strava"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            clientId: z.string().nullable().optional(),
            clientSecret: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Settings", content: { "application/json": { schema: adminStrava } } },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/integrations/strava/status",
  summary: "Whether Strava is configured on this instance and connected for this user",
  tags: ["Strava"],
  responses: {
    200: { description: "Status", content: { "application/json": { schema: status } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/integrations/strava/authorize",
  summary: "Strava's consent URL for this user",
  description:
    "`redirectUri` must be this instance's own `/integrations/strava/callback` page. The " +
    "URL carries a signed `state` that binds the returning code to this user for ten minutes.",
  tags: ["Strava"],
  request: {
    body: {
      content: { "application/json": { schema: z.object({ redirectUri: z.string().url() }) } },
    },
  },
  responses: {
    200: {
      description: "Consent URL",
      content: { "application/json": { schema: z.object({ url: z.string().url() }) } },
    },
    400: { description: "Not this instance's callback", content: errorContent },
    409: { description: "No Strava application configured", ...stravaError },
  },
});

registry.registerPath({
  method: "post",
  path: "/integrations/strava/exchange",
  summary: "Finish the consent round trip with Strava's code",
  tags: ["Strava"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ code: z.string(), state: z.string(), scope: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: { description: "Connected", content: { "application/json": { schema: status } } },
    400: { description: "Expired or foreign state", content: errorContent },
    401: { description: "Reading activities was not granted, or Strava refused", ...stravaError },
    502: { description: "Strava did not answer usably", ...stravaError },
  },
});

registry.registerPath({
  method: "delete",
  path: "/integrations/strava",
  summary: "Disconnect Strava and forget the tokens",
  tags: ["Strava"],
  responses: { 204: { description: "Disconnected" } },
});

registry.registerPath({
  method: "get",
  path: "/integrations/strava/activities",
  summary: "The user's Strava activities in a window, newest first (one page of 50)",
  tags: ["Strava"],
  request: {
    query: z.object({
      after: z.string().datetime().optional(),
      before: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "Activities",
      content: { "application/json": { schema: z.object({ activities: z.array(activity) }) } },
    },
    409: { description: "Not connected", ...stravaError },
    429: { description: "Strava's rate limit is spent", ...stravaError },
  },
});

const importBody = z.object({ activityId: z.string(), tripId: z.string().uuid().nullish() });

registry.registerPath({
  method: "post",
  path: "/tours/{routeId}/tracks/strava",
  summary: "Import a Strava activity into an existing tour or roadtrip",
  tags: ["Strava", "Tours"],
  request: {
    params: z.object({ routeId: z.string().uuid() }),
    body: { content: { "application/json": { schema: importBody } } },
  },
  responses: {
    201: {
      description: "Imported",
      content: { "application/json": { schema: z.object({ track: importedTrack }) } },
    },
    409: { description: "Already imported here, or Strava not connected", ...stravaError },
    502: { description: "No GPS route on the activity, or Strava failed", ...stravaError },
  },
});

registry.registerPath({
  method: "post",
  path: "/tours/import/strava",
  summary: "Make a new day tour from a Strava activity",
  description:
    "Name, activity (mapped from Strava's sport type) and the recording come from the " +
    "activity. A failed fetch leaves no empty tour behind.",
  tags: ["Strava", "Tours"],
  request: { body: { content: { "application/json": { schema: importBody } } } },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({ routeId: z.string().uuid(), track: importedTrack }),
        },
      },
    },
    409: { description: "Strava not connected", ...stravaError },
    502: { description: "No GPS route on the activity, or Strava failed", ...stravaError },
  },
});
