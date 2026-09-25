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
import { errorContent } from "./shared";

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
    "`trip` (an own, flown airport other than home within 300 km; `airportIata`, `distanceKm`, `spreadKm`) " +
    "or `stay` (nights away with no dated stay, named by an own place nearby; `placeId`, `nights`). " +
    "Suggestions only: nothing is recorded until the client creates the entry and PATCHes the row.",
  tags: miscTag,
  responses: { 200: { description: "Photo journeys" } },
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
  tags: miscTag,
  responses: { 202: { description: "Scan started" } },
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
    "null when nothing was to be linked.",
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
            }),
          }),
        },
      },
    },
    404: notFound,
  },
});
