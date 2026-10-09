/**
 * What hangs off a place, and merging two of them — the delete question and
 * the duplicate merge (forgejo#232, forgejo#250). Own module so `places.ts`
 * stays well inside the line limit.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { placeSchema } from "./places";
import { mergePlaceSchema } from "../../../schemas/place";

const placesTag = ["Places"];
const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();
const named = z.object({ id: uuid, name: z.string() });

const placeRelations = registry.register(
  "PlaceRelations",
  z
    .object({
      visitCount: z.number().int().describe("Every visit row, planned ones included"),
      plannedVisitCount: z.number().int().describe("Of those, dated in the future"),
      photoCount: z.number().int().describe("Proof photographs on its visits"),
      documentCount: z.number().int().describe("Kept originals filed against its visits"),
      lists: z.array(named).describe("Own lists and subscribed checklists it is in"),
      trips: z.array(named).describe("Trips its visits are filed under; they survive a delete"),
      roadtripStationCount: z
        .number()
        .int()
        .describe("Roadtrip stations naming the place; they survive a delete"),
    })
    .openapi("PlaceRelations")
);

registry.registerPath({
  method: "get",
  path: "/places/{id}/related",
  summary: "What hangs off a place, counted",
  description:
    "Visits, proof photos, kept documents, list memberships and the trips its visits " +
    "are filed under — what a delete takes or leaves, and what a merge moves. 404 " +
    "for a place that is not the caller's.",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: {
      description: "Counts",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), data: placeRelations }),
        },
      },
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/places/{id}/merge",
  summary: "Merge a duplicate place into this one",
  description:
    "`{id}` stays, `sourceId` is folded into it and deleted — in one transaction, so a " +
    "failure changes nothing. Every visit (with its photos and documents), list " +
    "membership, roadtrip station and photo finding moves; a list both were in keeps one " +
    "entry. Each master-data group comes from the side picked in `fields`; `visited` is " +
    "true if either was; the OSM/Wikidata identity follows the position. Both places must " +
    "be the caller's (404 otherwise). 400 `PLACE_MERGE_SAME` for one id twice, 409 " +
    "`PLACE_MERGE_BOTH_CURATED` when each stands for a different checklist item. Never " +
    "run automatically.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: mergePlaceSchema } } },
  },
  responses: {
    200: {
      description: "The place that stays",
      content: {
        "application/json": { schema: z.object({ success: z.boolean(), data: placeSchema }) },
      },
    },
    400: { description: "Invalid input, or the same place twice", content: errorContent },
    404: notFound,
    409: { description: "Both are different checklist items", content: errorContent },
  },
});
