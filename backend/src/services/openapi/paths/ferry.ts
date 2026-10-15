/** Ferry crossing contract (dennis/TravStats forgejo#293). */
import { z } from "zod";
import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import {
  createFerryJourneySchema,
  updateFerryJourneySchema,
  ferryQuerySchema,
} from "../../../schemas/ferry";
import { clientRefBodySchema } from "../../../schemas/clientRef";
import { clientRefResponses } from "./clientRef";
import { documentIdsBodySchema } from "../../../schemas/document";
import { railTimesSchema } from "../../../schemas/times";
import { errorContent, timeRefused } from "./shared";
const journey = registry.register(
  "FerryJourney",
  z.object({
    ...prismaColumns("FerryJourney"),
    trip: z.object({ id: z.string(), name: z.string(), color: z.string() }).nullable().optional(),
    times: railTimesSchema,
  })
);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const params = z.object({ id: z.string().uuid() });
const errors = {
  400: { description: "Invalid input", content: errorContent },
  401: { description: "Authentication required", content: errorContent },
  403: { description: "Write scope required", content: errorContent },
  404: { description: "Entry not found or not owned", content: errorContent },
  409: { description: "Roadtrip link conflicts with this change", content: errorContent },
  422: timeRefused,
};
registry.registerPath({
  method: "get",
  path: "/ferry",
  tags: ["Ferry"],
  summary: "List ferry crossings",
  request: { query: ferryQuerySchema },
  responses: {
    200: {
      description: "Paginated crossings",
      content: json(
        envelope(z.array(journey)).extend({
          meta: z.object({
            total: z.number(),
            limit: z.number(),
            offset: z.number(),
            summary: z.object({
              journeys: z.number(),
              operators: z.number(),
              withoutOperator: z.number(),
              stations: z.number(),
            }),
          }),
        })
      ),
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/ferry/{id}",
  tags: ["Ferry"],
  summary: "Read a ferry crossing",
  request: { params },
  responses: { 200: { description: "Crossing", content: json(envelope(journey)) }, ...errors },
});
registry.registerPath({
  method: "post",
  path: "/ferry",
  tags: ["Ferry"],
  summary: "Create a ferry crossing",
  description:
    "Both ports include coordinates. Times are local wall clocks or calendar days; zones are resolved on the server. Distance without a ticket value is explicitly a straight-line estimate. Documents and companions use the same ownership rules as other journeys.",
  request: {
    body: {
      content: json(createFerryJourneySchema.and(documentIdsBodySchema).and(clientRefBodySchema)),
    },
  },
  responses: {
    201: { description: "Created", content: json(envelope(journey)) },
    ...errors,
    ...clientRefResponses(json(envelope(journey))),
  },
});
registry.registerPath({
  method: "patch",
  path: "/ferry/{id}",
  description:
    "Optional baseVersion (updatedAt) or If-Match precondition; stale versions return 409 VERSION_CONFLICT.",
  tags: ["Ferry"],
  summary: "Edit a ferry crossing",
  request: {
    params,
    body: {
      content: json(
        updateFerryJourneySchema.and(
          z.object({ baseVersion: z.iso.datetime({ offset: true }).optional() })
        )
      ),
    },
  },
  responses: { 200: { description: "Updated", content: json(envelope(journey)) }, ...errors },
});
registry.registerPath({
  method: "delete",
  path: "/ferry/{id}",
  tags: ["Ferry"],
  summary: "Delete a ferry crossing and its documents",
  description:
    "Optional If-Match version precondition; stale versions return 409 VERSION_CONFLICT.",
  request: { params, headers: z.object({ "If-Match": z.string().optional() }) },
  responses: { 204: { description: "Deleted" }, ...errors },
});
const leg = z.object({
  id: z.string(),
  mode: z.string(),
  ferryJourney: z.object({ id: z.string() }).nullable(),
  fromStop: z.object({ title: z.string() }),
  toStop: z.object({ title: z.string() }),
  route: z.object({ name: z.string(), tripId: z.string().nullable() }),
});
registry.registerPath({
  method: "get",
  path: "/ferry/roadtrip-legs",
  tags: ["Ferry"],
  summary: "List owned roadtrip legs available for linking",
  responses: { 200: { description: "Legs", content: json(envelope(z.array(leg))) }, ...errors },
});
registry.registerPath({
  method: "put",
  path: "/ferry/{id}/roadtrip-leg",
  tags: ["Ferry"],
  summary: "Link a crossing to a roadtrip leg, or unlink with null",
  description:
    "Linking marks the leg as ferry and clears road routing. Unlinking preserves its ferry mode. A crossing and roadtrip must belong to the same trip.",
  request: { params, body: { content: json(z.object({ legId: z.string().uuid().nullable() })) } },
  responses: {
    200: {
      description: "Linked",
      content: json(envelope(z.object({ tripId: z.string().nullable() }))),
    },
    ...errors,
  },
});

registry.registerPath({
  method: "post",
  path: "/ferry/ticket-preview",
  tags: ["Ferry"],
  summary: "Preview ferry ticket values without creating a crossing",
  request: {
    body: {
      content: json(
        z.union([
          z.object({ documentId: z.string().uuid() }),
          z.object({ text: z.string().min(1).max(60000) }),
        ])
      ),
    },
  },
  responses: {
    200: {
      description: "Evidence-backed proposals for user review",
      content: json(
        envelope(
          z.object({
            crossings: z.array(
              z.record(z.string(), z.object({ value: z.string(), evidence: z.string() }))
            ),
            parser: z.string().nullable(),
            reason: z.string().nullable(),
            provider: z.unknown().nullable(),
          })
        )
      ),
    },
    ...errors,
    415: { description: "Document format not supported" },
    429: { description: "Rate limited" },
  },
});
registry.registerPath({
  method: "get",
  path: "/ferry/live-availability",
  tags: ["Ferry"],
  summary: "Whether AISStream is configured (no credentials)",
  responses: {
    200: {
      description: "Provider availability",
      content: json(
        envelope(z.object({ configured: z.boolean(), provider: z.literal("AISStream") }))
      ),
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/ferry/{id}/live-position",
  tags: ["Ferry"],
  summary: "On-demand current AIS snapshot for an explicitly selected MMSI",
  description:
    "Checks crossing ownership. No historical journey data is overwritten. Returns noSignal after 15 seconds without a usable message; receipt time is not observation time.",
  request: { params, query: z.object({ mmsi: z.string().regex(/^\d{9}$/) }) },
  responses: {
    200: {
      description: "Snapshot or explicit unavailable status",
      content: json(
        envelope(
          z.object({
            status: z.enum(["ok", "notConfigured", "noSignal", "unavailable", "busy"]),
            position: z
              .object({
                mmsi: z.string(),
                vesselName: z.string().nullable(),
                lat: z.number(),
                lon: z.number(),
                speedKnots: z.number().nullable(),
                courseDegrees: z.number().nullable(),
                receivedAt: z.string(),
                observedAt: z.string().nullable(),
              })
              .nullable(),
          })
        )
      ),
    },
    ...errors,
    429: { description: "Rate limited" },
  },
});
