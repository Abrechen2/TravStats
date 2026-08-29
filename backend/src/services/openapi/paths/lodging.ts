/**
 * Lodging endpoints: the properties, and the stays inside them.
 *
 * Two shapes matter to a consumer and neither is guessable from the route
 * names, so both are spelled out here:
 *
 * A LODGING is a place. A STAY is one visit to it, and everything episodic
 * lives on the stay rather than on the property — dates, price, board, room,
 * ratings, the trip it belonged to. Three nights in the same hotel twice a year
 * is one lodging and two stays.
 *
 * A stay may be DATELESS. "A hotel in Lisbon, sometime in 2011" is still a
 * place you slept, and the ratings and price have to go somewhere, so `checkIn`
 * and `checkOut` are nullable and `datePrecision` says what the dates that ARE
 * present actually mean. `nights` exists separately because "three nights, no
 * idea when" and "July 2011, no idea how long" are different gaps and one field
 * cannot carry both.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  createLodgingSchema,
  updateLodgingSchema,
  createStaySchema,
  updateStaySchema,
  LODGING_TYPES,
  BOARD_TYPES,
  STAY_STATUSES,
} from "../../../schemas/lodging";

const lodgingCreateInput = registry.register(
  "LodgingCreateInput",
  createLodgingSchema.openapi("LodgingCreateInput")
);

const lodgingUpdateInput = registry.register(
  "LodgingUpdateInput",
  updateLodgingSchema.openapi("LodgingUpdateInput")
);

const stayCreateInput = registry.register(
  "StayCreateInput",
  createStaySchema.openapi("StayCreateInput")
);

const stayUpdateInput = registry.register(
  "StayUpdateInput",
  updateStaySchema.openapi("StayUpdateInput")
);

const stay = registry.register(
  "Stay",
  z
    .object({
      id: z.string().uuid(),
      lodgingId: z.string().uuid(),
      checkIn: z.string().datetime().nullable(),
      checkOut: z.string().datetime().nullable(),
      checkInTime: z
        .string()
        .nullable()
        .describe('Wall clock "HH:mm" at the property, not an instant'),
      checkOutTime: z.string().nullable(),
      datePrecision: z
        .string()
        .describe("What the dates mean: exact, month or year. A dateless stay says so here."),
      nights: z
        .number()
        .int()
        .nullable()
        .describe(
          "Explicit night count for a stay whose dates cannot supply one. When both " +
            "dates are present this is derived rather than stored."
        ),
      status: z.enum(STAY_STATUSES),
      board: z.enum(BOARD_TYPES).nullable(),
      roomType: z.string().nullable(),
      price: z.number().nullable(),
      currency: z
        .string()
        .nullable()
        .describe("ISO 4217. The currency the stay was actually paid in."),
      tripId: z.string().uuid().nullable(),
      bookingId: z.string().uuid().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .describe(
      "One visit to a lodging. Everything episodic lives here rather than on the " +
        "property: dates, price, board, room and ratings. A stay counts as a night " +
        "only after its check-out, so a stay in progress is not yet in the totals."
    )
    .openapi("Stay")
);

const lodging = registry.register(
  "Lodging",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      type: z.enum(LODGING_TYPES),
      name: z.string(),
      chainId: z.number().int().nullable(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      stars: z.number().int().nullable(),
      amenities: z.array(z.string()),
      notes: z.string().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      stays: z
        .array(stay)
        .optional()
        .describe("Included by GET /lodging/{id}; the list endpoint omits them."),
    })
    .describe(
      "A place you slept. Created once and reused: the same hotel visited twice " +
        "is one lodging with two stays."
    )
    .openapi("Lodging")
);

registry.registerPath({
  method: "get",
  path: "/lodging",
  summary: "List lodgings",
  tags: ["Lodging"],
  request: {
    query: z.object({
      search: z.string().optional(),
      type: z.enum(LODGING_TYPES).optional(),
      country: z.string().optional(),
      chainId: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "Lodgings, without their stays",
      content: { "application/json": { schema: z.array(lodging) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/lodging/{id}",
  summary: "Get a lodging with its stays",
  tags: ["Lodging"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Lodging", content: { "application/json": { schema: lodging } } },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/lodging",
  summary: "Create a lodging",
  description:
    "Creates the PLACE only. A visit to it is a separate call to " +
    "POST /lodging/{id}/stays — a lodging with no stays is a legitimate state, " +
    "which is what makes a wishlist entry possible.",
  tags: ["Lodging"],
  request: {
    body: { content: { "application/json": { schema: lodgingCreateInput } }, required: true },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: lodging } } },
    400: { description: "Invalid input", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/lodging/{id}",
  summary: "Update a lodging",
  description: "At least one field must be present; an empty body is rejected rather than ignored.",
  tags: ["Lodging"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: lodgingUpdateInput } }, required: true },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: lodging } } },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/lodging/{id}",
  summary: "Delete a lodging and every stay in it",
  tags: ["Lodging"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/lodging/{id}/stays",
  summary: "Add a stay to a lodging",
  description:
    "Dates are optional. A stay with neither date is recorded as dateless and " +
    "carries its `nights` explicitly; `datePrecision` says how exact the dates " +
    "that are present should be read.",
  tags: ["Lodging"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: stayCreateInput } }, required: true },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: stay } } },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "Lodging not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/lodging/{id}/stays/{stayId}",
  summary: "Update a stay",
  tags: ["Lodging"],
  request: {
    params: z.object({ id: z.string().uuid(), stayId: z.string().uuid() }),
    body: { content: { "application/json": { schema: stayUpdateInput } }, required: true },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: stay } } },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/lodging/{id}/stays/{stayId}",
  summary: "Delete a stay",
  tags: ["Lodging"],
  request: { params: z.object({ id: z.string().uuid(), stayId: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/lodging/fx-preview",
  summary: "Convert an amount into the display currency",
  description:
    "What a price in another currency is worth on a given date, using the same " +
    "rates a stay's stored snapshot uses. Rate-limited: it is a lookup, not a bulk " +
    "conversion endpoint.",
  tags: ["Lodging"],
  request: {
    query: z.object({
      amount: z.coerce.number(),
      from: z.string().length(3),
      date: z.string().describe("ISO date; the rate is taken as of this day"),
    }),
  },
  responses: {
    200: {
      description: "Converted amount",
      content: {
        "application/json": {
          schema: z.object({
            amount: z.number(),
            currency: z.string(),
            rate: z.number(),
            asOf: z.string(),
          }),
        },
      },
    },
    400: { description: "Invalid input", content: errorContent },
    429: { description: "Too many requests", content: errorContent },
  },
});
