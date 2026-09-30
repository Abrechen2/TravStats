/**
 * Loyalty cards across domains (2.7) — `routes/loyaltyMemberships.ts`.
 *
 * The same rows as `/lodging-memberships`, which stays the hotel-only view
 * for the stay editor and the chain page.
 */

import { z } from "zod";

import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import {
  createLoyaltyMembershipSchema,
  updateLoyaltyMembershipSchema,
} from "../../../schemas/loyalty";
import { LOYALTY_DOMAINS } from "../../../shared/domains";
import { errorContent } from "./shared";

const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const conflict = {
  description: "A card with this programme name already exists in this domain",
  content: errorContent,
};
const uuid = z.string().uuid();
const tag = ["Loyalty"];
const day = z.string().describe("YYYY-MM-DD");

const activity = z
  .object({
    count: z
      .number()
      .int()
      .describe(
        "Flights, cruises, stays or train rides covered by the card that happened — the " +
          "counting rules of shared/flightCounting, cruiseCounting, lodgingCounting and " +
          "railCounting"
      ),
    nights: z
      .number()
      .int()
      .nullable()
      .describe(
        "Stays and cruises only (null for flight and rail cards); null when no counted item " +
          "names its length"
      ),
    lastActivity: day.nullable(),
    years: z
      .array(
        z.object({
          year: z.number().int(),
          count: z.number().int(),
          nights: z.number().int().nullable(),
        })
      )
      .describe(
        "The same per calendar year, newest first — a flight by its departure airport's " +
          "calendar, a train ride by its departure station's, a stay by the year the lodging " +
          "statistics file it under, a cruise by its start. An undated item counts in the " +
          "totals and in no year."
      ),
  })
  .describe(
    "Derived from the logbook. Flight cards match on the flight's airline identity " +
      "(IATA code), cruise cards on the cruise line, rail cards on the ride's operator " +
      "(spelling folded), hotel cards through the stay's card derivation (chain, hotel, " +
      "override)."
  );

const card = z.object({
  ...prismaColumns("LoyaltyMembership"),
  domain: z.enum(LOYALTY_DOMAINS),
  chainIds: z.array(z.number().int()),
  chains: z.array(z.object({ id: z.number().int(), name: z.string() })),
  lodgingIds: z.array(uuid),
  lodgings: z.array(z.object({ id: uuid, name: z.string() })),
});

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

registry.registerPath({
  method: "get",
  path: "/loyalty-memberships",
  summary: "Every loyalty card, with what it was used for",
  tags: tag,
  responses: {
    200: {
      description: "Cards",
      content: {
        "application/json": {
          schema: envelope(z.array(card.extend({ activity: activity.nullable() }))),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/loyalty-memberships/suggestions",
  summary: "Frequent-flyer numbers the flights carry that no card holds yet",
  description:
    "Grouped by number: one number used on several airlines is one suggested card covering " +
    "them all. Nothing is written — the client creates the card the user confirms.",
  tags: tag,
  responses: {
    200: {
      description: "Suggested cards",
      content: {
        "application/json": {
          schema: envelope(
            z.array(
              z.object({
                membershipNumber: z.string(),
                suggestedProgramName: z.string(),
                airlines: z.array(z.object({ code: z.string().nullable(), name: z.string() })),
                flightCount: z.number().int(),
                lastUsed: day.nullable(),
              })
            )
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/loyalty-memberships/{id}",
  summary: "One loyalty card, without its activity",
  description:
    "What a list filtered by this card names it by. Another user's card and a missing one " +
    "are the same 404, code `LOYALTY_MEMBERSHIP_NOT_FOUND`.",
  tags: tag,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: "Card", content: { "application/json": { schema: envelope(card) } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/loyalty-memberships",
  summary: "Add a loyalty card",
  description:
    "Each domain has one coverage field — `airlineCodes` (flight), `cruiseLines` (cruise), " +
    "`chainIds`/`lodgingIds` (lodging). Another domain's field is refused.",
  tags: tag,
  request: {
    body: { content: { "application/json": { schema: createLoyaltyMembershipSchema } } },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: envelope(card) } },
    },
    400: badInput,
    409: conflict,
  },
});

registry.registerPath({
  method: "patch",
  path: "/loyalty-memberships/{id}",
  summary: "Update a loyalty card",
  description:
    "A list present in the body replaces the stored one (links, codes, lines); an absent " +
    "list is left alone. The domain cannot change. A card keeps one status, `tier`, the one " +
    "held today — a dated status history is not accepted (400).",
  tags: tag,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: updateLoyaltyMembershipSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: envelope(card) } } },
    400: badInput,
    404: notFound,
    409: conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/loyalty-memberships/{id}",
  summary: "Remove a loyalty card",
  tags: tag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: { description: "Deleted" }, 404: notFound },
});
