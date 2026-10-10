/**
 * The photo-journey inbox: what the photo library suggests and the logbook
 * never recorded (forgejo#94). Split out of `integrations.ts` when the accept
 * response and the trip reader pushed that file past the line limit.
 *
 * Everything here is a SUGGESTION; accepting one links what the client made
 * and — for a visit — the finding's photographs, never bytes.
 */

import { z } from "zod";

import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import { errorContent } from "./shared";
import { jobStartedSchema } from "./jobs";

const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();
const miscTag = ["Misc"];

registry.registerPath({
  method: "get",
  path: "/photo-journeys",
  summary: "Journeys proposed from photo timestamps",
  description:
    "Each row is ONE reading of a burst of photos nothing recorded explains, the strongest that fits: " +
    "`place` (photos within 2 km of an own place, no visit that day; `placeId`, `distanceKm`), " +
    "`trip` (an own, flown airport other than home within 300 km; `airportIata`, `distanceKm`, `spreadKm`), " +
    "`stay` (nights away with no dated stay, named by an own place nearby; `placeId`, `nights`) " +
    "or `visit` (a stop of at least three located photos over five minutes INSIDE a recorded " +
    "trip's days — `tripId`, `tripName` — that no visit, slept-in lodging or flown airport within " +
    "200 m explains; `suggestedName`, `suggestedLocalName`, `suggestedRef` and `suggestedCategory` " +
    "are what the reverse lookup found within 150 m, all null when nothing there had a name; " +
    "`placeId` is set when an own place within 200 m has no visit that day, and accepting " +
    "records the visit there). " +
    "Suggestions only: nothing is recorded until the client creates the entry and PATCHes the row " +
    "— except a `visit`, whose place and visit the PATCH itself creates. " +
    "Each row is named from what is stored (no lookup per request): `placeName` is the own place " +
    "a finding points at, `label` that name or else `suggestedName`, else the city, then the " +
    "country, the scan's reverse lookup stored — null when nothing is known.",
  tags: miscTag,
  request: {
    query: z.object({ status: z.enum(["pending", "accepted", "dismissed"]).optional() }),
  },
  responses: {
    200: {
      description: "Photo journeys, newest first",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(
              z.object({
                ...prismaColumns("PhotoJourney"),
                placeName: z
                  .string()
                  .nullable()
                  .describe("The name of the own place a place/stay finding points at"),
                label: z
                  .string()
                  .nullable()
                  .describe(
                    "What to call the finding: placeName, else suggestedName, else city, else countryName"
                  ),
                tripName: z
                  .string()
                  .nullable()
                  .describe(
                    "The name of the trip a `visit` finding falls in; null for the other kinds"
                  ),
                startLocal: z
                  .string()
                  .nullable()
                  .describe(
                    "The first photo's wall clock where it was taken (YYYY-MM-DDTHH:mm:ss); null without a zone"
                  ),
                endLocal: z
                  .string()
                  .nullable()
                  .describe("The last photo's wall clock where it was taken; null without a zone"),
                startDay: z
                  .string()
                  .nullable()
                  .describe(
                    "The first photo's calendar day (YYYY-MM-DD) where it was taken; null when the position has no zone"
                  ),
                endDay: z
                  .string()
                  .nullable()
                  .describe(
                    "The last photo's calendar day where it was taken; null without a zone"
                  ),
                nearestVisit: z
                  .object({
                    placeId: uuid,
                    placeName: z.string(),
                    distanceKm: z.number(),
                    sameDay: z.boolean().describe("The visit falls on the finding's days"),
                    withinReach: z
                      .boolean()
                      .describe(
                        "Same day and within 200 m: a visit logged since the scan already explains the stop"
                      ),
                  })
                  .nullable()
                  .describe(
                    "`visit` findings: the nearest logged visit in the finding's trip or on its days; null otherwise"
                  ),
              })
            ),
          }),
        },
      },
    },
    400: badInput,
  },
});

const nightlyScanSettings = z.object({
  success: z.literal(true),
  data: z.object({
    nightlyScan: z
      .boolean()
      .describe("Scan this account's Immich every night at 04:55 UTC, last 400 days"),
    immichConnected: z
      .boolean()
      .describe(
        "Whether the account resolves an Immich connection — the scan's own first question; " +
          "false for the shared demo account"
      ),
    windowDays: z.number().int().describe("How many days back a nightly run reads"),
    nextRunAt: z.string().datetime().describe("When the next nightly run starts"),
    lastRun: z
      .object({
        ranAt: z.string().datetime(),
        result: z.enum(["scanned", "noImmich", "failed"]),
        created: z.number().int().nullable().describe("`scanned`: new findings written"),
        failure: z
          .string()
          .nullable()
          .describe(
            "`failed`: the Immich error kind (unreachable, auth, notFound, protocol, invalidUrl) or internal"
          ),
      })
      .nullable()
      .describe("How this account's last nightly run ended; null before the first"),
  }),
});

registry.registerPath({
  method: "get",
  path: "/photo-journeys/settings",
  summary: "Whether the nightly photo-journey scan is on",
  description: "Off by default. The full-history scan stays POST /photo-journeys/scan.",
  tags: miscTag,
  responses: {
    200: {
      description: "The opt-in",
      content: { "application/json": { schema: nightlyScanSettings } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/photo-journeys/settings",
  summary: "Turn the nightly photo-journey scan on or off",
  description:
    "Opt-in per account, like flight auto-updates: a scan reads the library in its window and " +
    "sends the positions it finds to the geocoder (at most 40 lookups).",
  tags: miscTag,
  request: {
    body: {
      content: { "application/json": { schema: z.object({ nightlyScan: z.boolean() }) } },
    },
  },
  responses: {
    200: { description: "Saved", content: { "application/json": { schema: nightlyScanSettings } } },
    400: badInput,
    403: {
      description: "The shared demo account cannot change it (DEMO_ACCOUNT_FORBIDDEN)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/photo-journeys/scan",
  summary: "Scan photos for journeys",
  description:
    "Reads the library in the window (default: the last ten years) and reverse-geocodes what " +
    "no record explains; forty seconds is the floor. With `background: true` it answers 202 " +
    "with a job (poll GET /jobs/{id}) whose result is the 200 body's `data`.",
  tags: miscTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            since: z.string().datetime().optional(),
            until: z.string().datetime().optional(),
            background: z.boolean().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Scanned, or `scanned: false` when the account has no Immich",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              scanned: z.boolean(),
              reason: z.literal("immich-not-configured").optional(),
              photosSeen: z.number().int().optional(),
              truncated: z.boolean().optional(),
              created: z.number().int().optional(),
              updated: z.number().int().optional(),
            }),
          }),
        },
      },
    },
    202: {
      description: "Started as a background job (`background: true`)",
      content: { "application/json": { schema: jobStartedSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/photo-journeys/for-trip/{tripId}",
  summary: "Accepted photo journeys that made a trip",
  description:
    "The caller's accepted journeys whose `createdTripId` is this trip (at most 20), with the " +
    "length of each preview strip. The photographs are drawn through " +
    "`/photo-journeys/{id}/preview/{index}/file`; no asset id is returned. 404 for a trip that is " +
    "not the caller's.",
  tags: miscTag,
  request: { params: z.object({ tripId: uuid }) },
  responses: {
    200: {
      description: "Journeys",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.array(z.object({ id: uuid, previewCount: z.number().int() })),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/photo-journeys/{id}",
  summary: "Update a photo journey",
  description:
    "Accept or dismiss. Accepting links what the answer created — `createdTripId`, " +
    "`createdPlaceVisitId` or `createdLodgingStayId` — and each must be the caller's own entry (404 otherwise). " +
    "Accepting with `createdPlaceVisitId` links the journey's preview photographs to that visit (no bytes " +
    "copied), after re-finding each id in the caller's own Immich; `data.photos` reports the outcome and is " +
    "null when nothing was to be linked. " +
    "Accepting a `visit` finding (forgejo#211) is the one case the SERVER creates: the place — reusing " +
    "the own place the row points at, else one with the same `osm:` ref, else a new one from " +
    "`suggestedName`/`suggestedLocalName`/`suggestedCategory` (`name`/`localName` in the body override " +
    "them; `name` is required, 400 `VISIT_NAME_REQUIRED`, when the scan named nothing) — and the visit at " +
    "the first photo's instant, filed on the finding's trip, in one transaction. `data.created` says what " +
    "was made; its photographs are linked as for a place finding. Accepting it again returns the same " +
    "visit and creates nothing more.",
  tags: miscTag,
  request: {
    params: z.object({ id: uuid }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["accepted", "dismissed"]),
            createdTripId: uuid.optional(),
            createdPlaceVisitId: uuid.optional(),
            createdLodgingStayId: uuid.optional(),
            name: z
              .string()
              .min(1)
              .max(200)
              .optional()
              .describe(
                "`visit` only: the name of the place to create, overriding `suggestedName`"
              ),
            localName: z
              .string()
              .max(200)
              .optional()
              .describe("`visit` only: the own-script name, overriding `suggestedLocalName`"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              photos: z
                .union([
                  z.object({ kind: z.literal("notConfigured") }),
                  z.object({
                    kind: z.literal("failed"),
                    reason: z.enum(["unreachable", "auth", "notFound", "protocol", "invalidUrl"]),
                  }),
                  z.object({
                    kind: z.literal("linked"),
                    linked: z.number().int(),
                    skipped: z.number().int(),
                  }),
                ])
                .nullable(),
              created: z
                .object({
                  placeId: uuid,
                  placeVisitId: uuid,
                  placeCreated: z
                    .boolean()
                    .describe("False when an existing place of the caller's took the visit"),
                  visitCreated: z
                    .boolean()
                    .describe(
                      "False when the place already had a visit that day and the finding was linked to it"
                    ),
                })
                .nullable()
                .describe("What accepting a `visit` finding made; null for every other answer"),
            }),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

const photoOutcome = z
  .union([
    z.object({ kind: z.literal("notConfigured") }),
    z.object({
      kind: z.literal("failed"),
      reason: z.enum(["unreachable", "auth", "notFound", "protocol", "invalidUrl"]),
    }),
    z.object({ kind: z.literal("linked"), linked: z.number().int(), skipped: z.number().int() }),
  ])
  .nullable();

registry.registerPath({
  method: "post",
  path: "/photo-journeys/batch",
  summary: "Answer several photo findings at once",
  description:
    "Accept or dismiss up to 50 findings in one request (forgejo#211). Every item is answered on " +
    "its own — each accept is its own transaction — so the response is 200 for a valid body and " +
    "carries a per-item `outcome`. Accept is for `visit` findings only (`NOT_A_VISIT` otherwise) and " +
    "takes the reader's corrections: `name`/`localName` for the place to create, `placeId` for an own " +
    "place to record the visit on instead, `visitedAt` for the visit's time at the place (instead of " +
    "the first photo's). A place that already has a visit that day gets the finding linked to that " +
    "visit, not a second one. Dismiss works for every kind, on pending rows only; a dismissed finding " +
    "is never asked again. Failure codes: NOT_FOUND, ALREADY_ANSWERED, NOT_A_VISIT, " +
    "VISIT_NAME_REQUIRED, VISIT_PLACE_NOT_FOUND, TIME_INVALID, INTERNAL.",
  tags: miscTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            items: z
              .array(
                z.object({
                  id: uuid,
                  action: z.enum(["accept", "dismiss"]),
                  name: z.string().min(1).max(200).optional(),
                  localName: z.string().max(200).optional(),
                  placeId: uuid.optional(),
                  visitedAt: z
                    .union([
                      z.object({ local: z.string() }),
                      z.string().describe("YYYY-MM-DD, or an offset-bearing ISO instant"),
                    ])
                    .optional()
                    .describe("The visit's wall clock at the place, `{local: 'YYYY-MM-DDTHH:mm'}`"),
                })
              )
              .min(1)
              .max(50),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Answered, item by item",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              results: z.array(
                z.object({
                  id: uuid,
                  action: z.enum(["accept", "dismiss"]),
                  outcome: z.enum(["accepted", "dismissed", "failed"]),
                  code: z
                    .enum([
                      "NOT_FOUND",
                      "ALREADY_ANSWERED",
                      "NOT_A_VISIT",
                      "VISIT_NAME_REQUIRED",
                      "VISIT_PLACE_NOT_FOUND",
                      "TIME_INVALID",
                      "INTERNAL",
                    ])
                    .optional()
                    .describe("`failed` only"),
                  created: z
                    .object({
                      placeId: uuid,
                      placeVisitId: uuid,
                      placeCreated: z.boolean(),
                      visitCreated: z.boolean(),
                    })
                    .optional()
                    .describe("`accepted` only"),
                  photos: photoOutcome.optional().describe("`accepted` only"),
                })
              ),
              summary: z.object({
                accepted: z.number().int(),
                dismissed: z.number().int(),
                failed: z.number().int(),
              }),
            }),
          }),
        },
      },
    },
    400: badInput,
  },
});
