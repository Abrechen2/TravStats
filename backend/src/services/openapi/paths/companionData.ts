import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  PACKING_MAX_ITEMS,
  homePlaceSchema,
  packingItemSchema,
  putPackingListSchema,
  putPersonalSettingsSchema,
} from "../../../schemas/companionData";

/**
 * Data the Companion kept on the phone only until the audit of 2026-10-23:
 * `routes/trips/tripPacking.ts` and `routes/settings/personal.ts`. Bare.
 * Private to its owner — never shared, in a public link or a comparison.
 */

const packingList = z.object({
  items: z.array(packingItemSchema),
  rev: z.number().int().describe("Raised on every write; 0 while the trip has no list"),
  updatedAt: z.string().nullable(),
  replayed: z.boolean().optional().describe("PUT only: this mutationId had been applied before"),
});

const tripId = z.object({ id: z.string().describe("Trip id") });

registry.registerPath({
  method: "get",
  path: "/trips/{id}/packing",
  summary: "A trip's packing list",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    200: {
      description: "The list (empty with rev 0 when none)",
      content: { "application/json": { schema: packingList } },
    },
    404: { description: "No such trip of this user", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/trips/{id}/packing",
  summary: "Replace a trip's packing list",
  description:
    `The whole list, at most ${PACKING_MAX_ITEMS} items (a list a trip merge made longer may ` +
    "be written back as long as it does not grow). `baseRev` is the rev the edit started " +
    "from; a list that moved on answers 409 PACKING_LIST_STALE with the stored `rev`. A resend " +
    "with the same `mutationId` is answered from the stored list (`replayed: true`).",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: putPackingListSchema } } },
  },
  responses: {
    200: { description: "Stored", content: { "application/json": { schema: packingList } } },
    400: { description: "PACKING_LIST_INVALID", content: errorContent },
    404: { description: "TRIP_NOT_FOUND: no such trip of this user", content: errorContent },
    409: { description: "PACKING_LIST_STALE; `rev` names the stored list", content: errorContent },
  },
});

const personal = z.object({
  homePlace: homePlaceSchema.nullable(),
  passportExpiry: z.string().nullable().describe("Calendar day YYYY-MM-DD"),
});

registry.registerPath({
  method: "get",
  path: "/settings/personal",
  summary: "Home place and passport expiry",
  tags: ["Settings"],
  responses: {
    200: {
      description: "Both, null when not set",
      content: { "application/json": { schema: personal } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/personal",
  summary: "Set or clear the home place and passport expiry",
  description:
    "An absent field is left alone, `null` clears it. With `onlyIfEmpty` a field is written only " +
    "where the server holds none yet (the Companion's one-time upload).",
  tags: ["Settings"],
  request: { body: { content: { "application/json": { schema: putPersonalSettingsSchema } } } },
  responses: {
    200: {
      description: "What is stored now",
      content: { "application/json": { schema: personal } },
    },
    400: { description: "PERSONAL_SETTINGS_INVALID", content: errorContent },
    403: { description: "The shared demo account", content: errorContent },
  },
});
