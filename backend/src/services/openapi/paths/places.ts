/**
 * Places, the visits to them, and the lists that group them.
 *
 * A PLACE is somewhere worth remembering; a VISIT is one time you were there.
 * The split is the same one lodging makes, and for the same reason: the McDonald's
 * at the Trevi Fountain is one place however often you go.
 *
 * Membership is its own table because a place belongs to MANY lists at once —
 * the same restaurant can be in "Maccis" and in "Rome". Where one answer is
 * needed from many memberships (a pin's colour, a pin's symbol), the FIRST list
 * in the user's own order wins.
 *
 * A CURATED list is a shipped checklist the user subscribes to. It is the same
 * row as a hand-made list, told apart by `curatedKey`, and the difference is
 * what may be edited: its name and its membership come from the catalogue,
 * while its colour, symbol and order stay the user's.
 */

import { z } from "zod";

import { placeImportCommitSchema, placeImportPreviewSchema } from "../../../schemas/placeImport";

import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { documentIdsBodySchema } from "../../../schemas/document";
import { createVisitSchema } from "../../../schemas/place";
import { errorContent } from "./shared";
import {
  createPlaceListSchema,
  updatePlaceListSchema,
  addListEntrySchema,
  reorderListEntriesSchema,
} from "../../../schemas/placeList";

const placesTag = ["Places"];
const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const deleted = { description: "Deleted" };
const uuid = z.string().uuid();

const place = registry.register(
  "Place",
  z
    .object({
      ...prismaColumns("Place"),
      id: uuid,
      userId: uuid,
      name: z.string(),
      category: z.string(),
      lat: z.number(),
      lon: z.number(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      country: z
        .string()
        .nullable()
        .describe("Free text as a geocoder returned it; isoCountryCode is what counting uses."),
      isoCountryCode: z.string().nullable(),
      visited: z
        .boolean()
        .describe("False means a wishlist entry — somewhere wanted, not somewhere been."),
      visitCount: z.number().int().describe("Visits that happened; future-dated ones excluded"),
      plannedVisitCount: z.number().int().describe("Future-dated visits, counted apart"),
      lastVisitAt: z.string().datetime().nullable().describe("Most recent completed visit"),
      continent: z.string().nullable(),
      visits: z.array(includedRow("visit")).optional().describe("Included by GET /places/{id}"),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .openapi("Place")
);

const placeList = registry.register(
  "PlaceList",
  z
    .object({
      ...prismaColumns("PlaceList"),
      id: uuid,
      userId: uuid,
      name: z.string(),
      description: z.string().nullable(),
      color: z.string().describe("Hex. What the map draws a member pin in."),
      icon: z
        .string()
        .nullable()
        .describe("One emoji. What the map may draw instead of the place's name."),
      labelMode: z
        .string()
        .describe(
          'Either "name" or "icon" — the list\'s DEFAULT for how its places are ' +
            "labelled. The map carries an override that applies to every list at once."
        ),
      sortIdx: z.number().int(),
      curatedKey: z
        .string()
        .nullable()
        .describe(
          "Non-null when this is a subscription to a shipped checklist. Then the " +
            "name and the membership come from the catalogue and are refused here; " +
            "colour, symbol and order stay the user's."
        ),
      placeCount: z
        .number()
        .int()
        .describe(
          "Entries this account actually holds. For a curated SUBSCRIPTION this " +
            "is materialised-only, so it converges on visitedCount and their " +
            "ratio is always 1 — use curatedItemCount as the denominator there."
        ),
      visitedCount: z.number().int(),
      countryCount: z.number().int(),
      curatedItemCount: z
        .number()
        .int()
        .nullable()
        .describe(
          "Size of the shipped catalogue behind a subscription, so progress has " +
            "a real denominator (47 of 1,248, not 47 of 47). Null for an " +
            "ordinary list, where placeCount is already the total."
        ),
      entries: z
        .array(includedRow("list entry"))
        .optional()
        .describe("Only when the entries were asked for"),
    })
    .openapi("PlaceList")
);

registry.registerPath({
  method: "get",
  path: "/places",
  summary: "List places",
  tags: placesTag,
  responses: {
    200: { description: "Places", content: { "application/json": { schema: z.array(place) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/places/{id}",
  summary: "Get a place with its visits",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: "Place", content: { "application/json": { schema: place } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/places",
  summary: "Create a place",
  description:
    "Address, city and country are filled in from the coordinates when they are " +
    "left out, and a nightly pass fills in older entries. Names come back in " +
    "Latin script: a logbook collected in the local script of every place is text " +
    "its owner can neither read nor search.",
  tags: placesTag,
  responses: {
    201: { description: "Created", content: { "application/json": { schema: place } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "patch",
  path: "/places/{id}",
  summary: "Update a place",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/places/{id}",
  summary: "Delete a place and its visits",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/places/{id}/visits",
  summary: "Record a visit",
  description:
    "Several visits to the same place on the same day stay several visits — the " +
    "day is not a key. `documentIds` files kept documents with the new visit.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: {
      content: {
        "application/json": { schema: createVisitSchema.extend(documentIdsBodySchema.shape) },
      },
    },
  },
  responses: { 201: { description: "Created" }, 400: badInput, 404: notFound },
});

const visitDateSuggestion = z.object({
  date: z.string().describe("Calendar day at the place, YYYY-MM-DD"),
  source: z.enum(["trip", "stay", "flight", "photo"]),
  label: z.string().nullable().describe("Trip or lodging name, or the arrival airport"),
  photoCount: z
    .number()
    .int()
    .nullable()
    .describe("Photographs taken within 300 m of the place that day"),
});

registry.registerPath({
  method: "get",
  path: "/places/{id}/visit-date-suggestions",
  summary: "Dates a new visit to this place could carry",
  description:
    "Read from the caller's own logbook. With `tripId`: that trip's stays and arrivals " +
    "within 50 km of the place, or — when none is near — the trip's days. Without it: the " +
    "most recent past stay and arrival within 50 km. Always: the days with trip photographs " +
    "taken within 300 m, busiest first (at most 8). A stay or trip longer than 14 days names " +
    "no day. Days that already carry a visit to this place are left out. A trip that is not " +
    "the caller's yields no trip suggestions.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    query: z.object({ tripId: uuid.optional() }),
  },
  responses: {
    200: {
      description: "Suggestions",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({ suggestions: z.array(visitDateSuggestion) }),
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
  path: "/places/visits/{visitId}",
  summary: "Update a visit",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid }) },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/places/visits/{visitId}",
  summary: "Delete a visit",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/places/visits/{visitId}/photos",
  summary: "Photos of one visit",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid }) },
  responses: { 200: { description: "Photos" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/places/visits/{visitId}/photos/{photoId}/file",
  summary: "Fetch a visit photo's bytes",
  description:
    "Ownership-checked, and sets its own `Cache-Control: private` over the " +
    "API-wide `no-store`. Private, never public. A photo that has become an Immich " +
    "link (`immichAssetId` set, no copy on disk) is streamed from the owner's Immich; " +
    "the asset id comes from the row, never from the request. `size` picks the " +
    "rendition for a link: thumbnail, preview (default) or original.",
  tags: placesTag,
  request: {
    params: z.object({ visitId: uuid, photoId: uuid }),
    query: z.object({ size: z.enum(["thumbnail", "preview", "original"]).optional() }),
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    304: { description: "Unchanged (a link's ETag matched)" },
    404: notFound,
    409: { description: "A link, and Immich is not configured", content: errorContent },
    502: { description: "Immich did not deliver the asset" },
  },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/photos/immich-link",
  summary: "Turn visit photo copies into Immich links",
  description:
    "Looks every photo copy of the caller that carries a checksum up in their Immich by " +
    "that checksum (SHA-1, base64, the value Immich keeps). A match keeps the row, gains " +
    "`immichAssetId` and loses the copy on disk. Photos without a checksum stay copies: " +
    "matching them by name would be a guess. At most 500 per call.",
  tags: placesTag,
  responses: {
    200: {
      description: "How many copies were checked and linked",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ checked: z.number().int(), linked: z.number().int() }),
          }),
        },
      },
    },
    409: { description: "Immich is not configured for this user", content: errorContent },
    502: { description: "Immich could not be asked", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/places/visits/{visitId}/photos/{photoId}",
  summary: "Update a visit photo",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid, photoId: uuid }) },
  responses: { 200: { description: "Updated" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/places/visits/{visitId}/photos/{photoId}",
  summary: "Delete a visit photo",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid, photoId: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

// ------------------------------------------------------------------ lists

registry.registerPath({
  method: "get",
  path: "/place-lists",
  summary: "List the user's places lists",
  tags: placesTag,
  request: {
    query: z.object({
      withEntries: z
        .enum(["true", "false"])
        .optional()
        .describe("Include membership. The index only needs the counts."),
    }),
  },
  responses: {
    200: { description: "Lists", content: { "application/json": { schema: z.array(placeList) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/{id}",
  summary: "Get one list",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: "List", content: { "application/json": { schema: placeList } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/place-lists",
  summary: "Create a list",
  tags: placesTag,
  request: {
    body: {
      content: { "application/json": { schema: createPlaceListSchema } },
      required: true,
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: placeList } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "patch",
  path: "/place-lists/{id}",
  summary: "Update a list",
  description:
    "Renaming a subscribed checklist is refused with 409: its name comes from the " +
    "catalogue, and an achievement that measures it would otherwise report against " +
    "a list nobody recognises. Colour, symbol, label mode and order stay editable.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: {
      content: { "application/json": { schema: updatePlaceListSchema } },
      required: true,
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: placeList } } },
    400: badInput,
    404: notFound,
    409: { description: "Not editable on a subscribed checklist", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/place-lists/{id}",
  summary: "Delete a list",
  description: "The list and its membership. The places themselves are untouched.",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/place-lists/{id}/entries",
  summary: "Put a place in a list",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: addListEntrySchema } }, required: true },
  },
  responses: {
    201: { description: "Added" },
    400: badInput,
    404: notFound,
    409: { description: "Membership is fixed on a subscribed checklist", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/place-lists/{id}/entries/{placeId}",
  summary: "Take a place out of a list",
  tags: placesTag,
  request: { params: z.object({ id: uuid, placeId: uuid }) },
  responses: {
    204: deleted,
    404: notFound,
    409: { description: "Fixed membership", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/place-lists/{id}/entries/order",
  summary: "Reorder a list",
  description:
    "The whole order in one call. A drag that lands three rows down renumbers " +
    "every row between, and doing that as separate requests would leave the list " +
    "visibly wrong if one of them failed.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: {
      content: { "application/json": { schema: reorderListEntriesSchema } },
      required: true,
    },
  },
  responses: { 200: { description: "Reordered" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/curated",
  summary: "The shipped checklists on offer",
  tags: placesTag,
  responses: { 200: { description: "Catalogue" } },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/curated/{key}/progress",
  summary: "How far through a checklist the user is",
  tags: placesTag,
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: "Progress" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/place-lists/curated/{key}/subscribe",
  summary: "Unsubscribe from a checklist",
  tags: placesTag,
  request: { params: z.object({ key: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/place-lists/curated/items/{itemId}/tick",
  summary: "Untick a checklist item",
  tags: placesTag,
  request: { params: z.object({ itemId: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

/**
 * Place import — preview then commit.
 *
 * Registered on 2026-09-01, after `openapi.coverage.test.ts` caught the two
 * routes going live undocumented: they were added and mounted in one commit
 * that touched no OpenAPI file. That guard is exactly why it exists, and it
 * only fired once the branch reached a trunk the guard runs on.
 */
registry.registerPath({
  method: "post",
  path: "/place-import/preview",
  summary: "Dry-run a place import",
  description:
    "Classifies each candidate row without writing anything: what would be " +
    "created, what is a duplicate of a place already held, and what cannot be " +
    "placed. An unresolvable row is an OFFER, not a discard — the user's own " +
    "note is what would otherwise be thrown away — so it comes back as " +
    "`needsInput` rather than being dropped silently. Rate-limited on the same " +
    "bucket as the lodging import: the same shape of expensive request.",
  tags: placesTag,
  request: {
    body: { content: { "application/json": { schema: placeImportPreviewSchema } } },
  },
  responses: {
    200: {
      description: "What the import would do",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), data: z.unknown() }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    401: { description: "Not authenticated", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/place-import/commit",
  summary: "Write a previewed place import",
  description:
    "Persists the rows the preview accepted, recording the source and file name " +
    "as provenance. A row that fails carries a fixed failure code rather than a " +
    "raw database message — a 201 body never passes through the error handler's " +
    "leak protections, so the vocabulary is closed on purpose.",
  tags: placesTag,
  request: {
    body: { content: { "application/json": { schema: placeImportCommitSchema } } },
  },
  responses: {
    201: {
      description: "Import written",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), data: z.unknown() }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    401: { description: "Not authenticated", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});
