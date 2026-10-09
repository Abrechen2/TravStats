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
