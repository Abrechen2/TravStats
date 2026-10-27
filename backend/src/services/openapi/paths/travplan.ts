import { z } from "zod";
import { registry } from "../registry";
import {
  createPlanSchema,
  writeSchema,
  stateSchema,
  proposalContentSchema,
  bookingSchema,
} from "../../travplan/schema";
import { errorContent } from "./shared";
const uuid = z.string().uuid(),
  params = z.object({ tripId: uuid });
const result = registry.register(
  "TravelPlan",
  z.object({
    id: uuid,
    tripId: uuid,
    name: z.string(),
    revision: z.number().int(),
    state: stateSchema,
    budget: z.object({
      currency: z.string(),
      booked: z.number(),
      estimates: z.number(),
      paid: z.number(),
      due: z.number().nullable(),
      total: z.number(),
      remaining: z.number().nullable(),
      unknown: z.number(),
      otherCurrencies: z.array(z.string()),
    }),
    findings: z.array(
      z.object({
        id: z.string(),
        fingerprint: z.string(),
        code: z.string(),
        severity: z.enum(["info", "attention"]),
        section: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])),
      })
    ),
    lastMutationId: uuid.optional(),
  })
);
const proposal = z.object({
  id: uuid,
  baseRevision: z.number(),
  status: z.string(),
  provider: z.string(),
  model: z.string(),
  content: proposalContentSchema,
  expiresAt: z.string().datetime(),
});
const config = z.object({
  enabled: z.boolean(),
  aiDailyLimit: z.number().int().min(0).max(100),
  weatherDailyLimit: z.number().int().min(0).max(200),
});
const json = (schema: z.ZodType) => ({ "application/json": { schema } });
function register(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  description: string,
  success: z.ZodType,
  body?: z.ZodType
) {
  registry.registerPath({
    method,
    path,
    tags: ["TravPlan"],
    description,
    security: [{ BearerAuth: [] }],
    request: {
      ...(path.includes("{tripId}")
        ? {
            params: path.includes("{proposalId}")
              ? params.extend({ proposalId: uuid })
              : path.includes("{stageId}")
                ? params.extend({ stageId: uuid })
                : params,
          }
        : {}),
      ...(body ? { body: { content: json(body) } } : {}),
    },
    responses: {
      [method === "post" && (path.endsWith("plans") || path.endsWith("proposals")) ? 201 : 200]: {
        description: "Success",
        content: json(success),
      },
      400: { description: "Invalid input", content: errorContent },
      403: {
        description: "Read-only scope, disabled feature or missing consent",
        content: errorContent,
      },
      404: { description: "Not found or not owned", content: errorContent },
      409: { description: "Revision, idempotency or proposal conflict", content: errorContent },
      429: { description: "Daily quota reached", content: errorContent },
    },
  });
}
register(
  "get",
  "/travplan/capabilities",
  "Planning contract and feature flags. `enabled` is true only when the instance offers " +
    "planning AND this account switched it on; every other plan path but `/travplan/config` " +
    "is refused with 403 `PLAN_DISABLED` (instance off) or `PLAN_USER_DISABLED` (account off, " +
    "switched on through PUT /settings `travPlan.enabled`). Plans are never deleted by either.",
  z.object({
    version: z.literal(1),
    enabled: z.boolean(),
    instanceEnabled: z
      .boolean()
      .describe("The instance half: the beta switch and `travel_plan_config.enabled`."),
    userEnabled: z
      .boolean()
      .describe("The account half: `travPlan.enabled` in the user's settings. Default off."),
    offlineWrites: z.boolean(),
    ai: z.boolean(),
    forecast: z.boolean(),
    notifications: z.boolean(),
  })
);
register("get", "/travplan/config", "Admin-only planning configuration.", config);
register(
  "patch",
  "/travplan/config",
  "Admin-only planning switch and persistent daily limits. Any non-empty subset; fields left out keep their stored value.",
  config,
  config.partial()
);
register(
  "get",
  "/travplan/plans",
  "Plans owned by the authenticated account.",
  z.object({
    plans: z.array(
      z.object({
        id: uuid,
        tripId: uuid,
        name: z.string(),
        revision: z.number(),
        destination: z.string(),
        startDay: z.string().nullable(),
        endDay: z.string().nullable(),
        status: z.enum(["planning", "ready", "archived"]),
        ideasCount: z.number(),
        bookingsCount: z.number(),
      })
    ),
  })
);
register(
  "post",
  "/travplan/plans",
  "Create a canonical trip and planning state; clientRef is an idempotency key.",
  result,
  createPlanSchema
);
register(
  "get",
  "/trips/{tripId}/plan",
  "Read the plan and deterministic checks. ETag is the plan revision.",
  result
);
register(
  "post",
  "/trips/{tripId}/plan/mutations",
  "Revision-checked, idempotent mutations. Fixed anchors are protected. Handover confirms no execution.",
  result,
  writeSchema
);
register(
  "post",
  "/trips/{tripId}/plan/placeholder-matches",
  "Which open placeholders an imported booking could replace: same kind, endpoints within 30 km, departure day within one day, lodging overlapping the station nights. Read-only.",
  z.object({
    matches: z.array(
      z.object({
        bookingId: uuid,
        score: z.number(),
        variant: z.enum(["active", "inactive"]),
        reasons: z.array(z.enum(["kind", "endpoints", "day", "nights"])),
        differences: z.array(
          z.object({
            field: z.string(),
            plan: z.string().nullable(),
            booking: z.string().nullable(),
            change: z.enum(["changed", "new"]),
          })
        ),
      })
    ),
  }),
  z.object({ booking: bookingSchema })
);
register(
  "post",
  "/trips/{tripId}/plan/stages/{stageId}/route",
  "Routes one drive stage through the instance router and stores kilometres and drive time (idempotent, revision-checked). A failed router keeps stored figures and records fallbackReason; a stage whose stations moved meanwhile answers PLAN_STAGE_CHANGED. Ferry stages get the great-circle distance; other modes are not routed.",
  result,
  z.object({ clientRef: uuid, baseRevision: z.number().int().min(1) })
);
register(
  "get",
  "/trips/{tripId}/plan/proposals",
  "Latest stored proposals; acceptance requires their original plan revision.",
  z.object({ proposals: z.array(proposal) })
);
register(
  "post",
  "/trips/{tripId}/plan/proposals",
  "Optional, quota-limited AI proposal using the permitted provider only.",
  proposal,
  z.object({ request: z.string().max(1000) })
);
register(
  "delete",
  "/trips/{tripId}/plan/proposals/{proposalId}",
  "Reject a pending proposal without changing the plan.",
  z.object({ rejected: z.boolean() })
);
register(
  "post",
  "/trips/{tripId}/plan/forecast",
  "Fetch a bounded forecast on request. Old data survives provider failure.",
  result,
  z.object({ clientRef: uuid, baseRevision: z.number().int() })
);
register(
  "get",
  "/trips/{tripId}/plan/packing-suggestions",
  "Optional evidence-based packing hints; no list is changed.",
  z.object({ suggestions: z.array(z.string()) })
);

const lonLat = z.tuple([z.number(), z.number()]);
const planDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
register(
  "get",
  "/trips/{tripId}/plan/actual",
  "Plan versus actual: each planned station visited, shifted, skipped or unknown, each stage's " +
    "planned and actual length, and accepted stays far from every station. The track is the " +
    "trip's entry track (own recording, TravTrack or Dawarich), privacy-cut; a station inside a " +
    "privacy zone is unknown. Reads only — the plan is never changed.",
  z.object({
    plan: z.object({ revision: z.number().int() }),
    actual: z
      .object({
        origin: z.enum(["travstats", "travtrack", "dawarich"]),
        coverage: z.enum(["complete", "truncated", "unreachable"]).nullable(),
        days: z.array(z.object({ day: planDay, state: z.enum(["recorded", "noData"]) })),
        segments: z.array(z.array(lonLat)),
      })
      .nullable(),
    stations: z.array(
      z.object({
        stationId: z.string(),
        title: z.string(),
        plannedFrom: planDay.nullable(),
        plannedUntil: planDay.nullable(),
        status: z.enum(["visited", "shifted", "skipped", "unknown"]),
        deltaDays: z.number().int().nullable(),
        actualFrom: planDay.nullable(),
        actualUntil: planDay.nullable(),
      })
    ),
    stages: z.array(
      z.object({
        stageId: z.string(),
        fromStationId: z.string(),
        toStationId: z.string(),
        plannedKm: z.number().nullable(),
        actualKm: z.number().nullable(),
      })
    ),
    unplanned: z.array(
      z.object({
        kind: z.enum(["lodging", "place"]),
        day: planDay,
        lat: z.number(),
        lon: z.number(),
        label: z.string(),
      })
    ),
  })
);

registry.registerPath({
  method: "get",
  path: "/travplan/locations",
  tags: ["TravPlan"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({ q: z.string().min(2).max(120), language: z.enum(["de", "en"]).optional() }),
  },
  responses: {
    200: {
      description: "Location matches from Open-Meteo / GeoNames",
      content: json(
        z.object({
          locations: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              country: z.string().optional(),
              admin1: z.string().optional(),
              latitude: z.number(),
              longitude: z.number(),
              timezone: z.string(),
            })
          ),
        })
      ),
    },
    429: { description: "Daily limit reached", content: errorContent },
  },
});
