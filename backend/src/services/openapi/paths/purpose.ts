/**
 * Private or business (docs/superpowers/specs/2026-11-22-private-business-purpose.md): one
 * entry's purpose, the per-domain "ausblenden" setting and the count of what it hides.
 */

import { z } from "zod";

import { PURPOSE_ENTRY_TYPES } from "../../../schemas/purpose";
import { PURPOSES, PURPOSE_DOMAINS } from "../../../shared/purpose";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Purpose"];
const ok = <T extends z.ZodTypeAny>(data: T) =>
  ({
    content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
  }) as const;

const visibility = z
  .object(Object.fromEntries(PURPOSE_DOMAINS.map((d) => [d, z.array(z.enum(PURPOSES)).optional()])))
  .describe("Per domain, the purposes hidden. A missing domain hides nothing.");
const visibilityState = z.object({
  visibility,
  revision: z
    .string()
    .describe("Changes whenever the setting changes; also `X-Purpose-Visibility`"),
});

registry.registerPath({
  method: "put",
  path: "/purpose/entries/{entryType}/{id}",
  summary: "Set or clear the purpose of an entry",
  description: "`entryType` is one of " + PURPOSE_ENTRY_TYPES.join(", ") + ". `null` clears it.",
  tags,
  request: {
    params: z.object({ entryType: z.enum(PURPOSE_ENTRY_TYPES), id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: z.object({ purpose: z.enum(PURPOSES).nullable() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The stored purpose",
      ...ok(z.object({ purpose: z.enum(PURPOSES).nullable() })),
    },
    404: { description: "`ENTRY_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/purpose/visibility",
  summary: "The per-domain purposes the account hides",
  tags,
  responses: { 200: { description: "The setting and its revision", ...ok(visibilityState) } },
});

registry.registerPath({
  method: "put",
  path: "/purpose/visibility",
  summary: "Replace the per-domain purposes the account hides",
  description:
    "Applied on the server to every list, map, statistic and count of the account — not a request " +
    "parameter. An entry with no purpose is never hidden.",
  tags,
  request: { body: { content: { "application/json": { schema: visibility } } } },
  responses: {
    200: { description: "The stored setting and its revision", ...ok(visibilityState) },
  },
});

registry.registerPath({
  method: "get",
  path: "/purpose/hidden",
  summary: "How many entries the hiding setting leaves out, per domain and purpose",
  tags,
  responses: {
    200: {
      description: "Counts for the hint under the totals",
      ...ok(z.object({ hidden: z.record(z.string(), z.record(z.string(), z.number())) })),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/purpose/trips/{tripId}/apply",
  summary: "Preview: what applying a purpose to a trip's entries would change",
  description: "Writes nothing. `wouldChange` counts the entries whose purpose differs.",
  tags,
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    query: z.object({ purpose: z.enum(PURPOSES).optional() }),
  },
  responses: {
    200: {
      description: "The purpose that would be written and how many entries it would change",
      ...ok(z.object({ purpose: z.enum(PURPOSES).nullable(), wouldChange: z.number() })),
    },
    404: { description: "`TRIP_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/purpose/trips/{tripId}/apply",
  summary: "Apply a purpose to every entry of a trip",
  description:
    "Without a body purpose the trip's category decides (business -> business; vacation, " +
    "weekend, family -> private; other or none -> nothing changes).",
  tags,
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: z.object({ purpose: z.enum(PURPOSES).optional() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The purpose written and how many entries changed",
      ...ok(z.object({ purpose: z.enum(PURPOSES).nullable(), changed: z.number() })),
    },
    404: { description: "`TRIP_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/purpose/from-trips",
  summary: "One-off: take the purpose of entries without one from their trip's category",
  tags,
  responses: {
    200: { description: "How many entries were filled", ...ok(z.object({ changed: z.number() })) },
  },
});
