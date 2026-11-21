import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/** Automatic photo links for place visits; split out of `places.ts` for its size. */
const placesTag = ["Places"];

const autoLinkStatus = z.object({
  enabled: z.boolean(),
  lastRun: z
    .object({
      at: z.string(),
      linked: z.number(),
      failedVisits: z.number().optional(),
      sources: z.record(z.string(), z.string()),
    })
    .nullable(),
});
const jobStarted = z.object({ success: z.literal(true), data: z.object({ jobId: z.string() }) });

registry.registerPath({
  method: "get",
  path: "/places/visits/photos/auto-link",
  summary: "Automatic photo links: the switch and the last run",
  description:
    "Whether photos of Immich and PhotoPrism are linked to place visits on their own " +
    "(default on), and what the last pass found per source: `ok`, `notConfigured` or the " +
    "failure kind (`unreachable`, `auth`, `notFound`, `protocol`, `invalidUrl`).",
  tags: placesTag,
  responses: {
    200: {
      description: "The switch and the last run",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: autoLinkStatus }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/places/visits/photos/auto-link",
  summary: "Switch automatic photo links on or off",
  description: "Switching on also starts a pass over every existing visit (`jobId`).",
  tags: placesTag,
  request: {
    body: { content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } } },
  },
  responses: {
    200: {
      description: "The new state; `jobId` is set when a pass was started",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ enabled: z.boolean(), jobId: z.string().nullable() }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/photos/auto-link/run",
  summary: "Link photos to every existing visit now",
  description:
    "A background job (`GET /jobs/{id}`, with progress). Idempotent; links only, never copies.",
  tags: placesTag,
  responses: {
    202: {
      description: "Started",
      content: { "application/json": { schema: jobStarted } },
    },
    409: { description: "The switch is off (`disabled`)", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/places/visits/{visitId}/photos/auto",
  summary: "Remove every automatically linked photo of a visit",
  description:
    "Each removed link is recorded as a refusal, so the next pass does not bring it back.",
  tags: placesTag,
  request: { params: z.object({ visitId: z.string().uuid() }) },
  responses: {
    200: {
      description: "How many were removed",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: z.object({ removed: z.number() }) }),
        },
      },
    },
    404: { description: "Visit not found", content: errorContent },
  },
});
