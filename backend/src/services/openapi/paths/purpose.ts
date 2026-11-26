/**
 * Private or business (docs/superpowers/specs/2026-11-22-private-business-purpose.md): one
 * entry's purpose, the per-domain "ausblenden" setting and the count of what it hides.
 */

import { z } from "zod";

import {
  PURPOSE_ENTRY_TYPES,
  customPurposeCreateSchema,
  customPurposeUpdateSchema,
} from "../../../schemas/purpose";
import { PURPOSES, PURPOSE_DOMAINS } from "../../../shared/purpose";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Purpose"];

/** What a client writes: the legacy kind, accepted forever, or a detailed key. */
const purposeIn = z
  .string()
  .describe(
    "`private` | `business` (the kind alone; older clients) or a detailed key " +
      "`builtin:<key>` | `custom:<uuid>` (see GET /purpose/catalogue)"
  );
const purposeKind = z.enum(PURPOSES).nullable().describe("The kind every filter and count reads");
const purposeKey = z
  .string()
  .nullable()
  .describe("The detailed key beside the kind; null: the kind alone (its default purpose)");
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
        "application/json": { schema: z.object({ purpose: purposeIn.nullable() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The stored kind and detailed key",
      ...ok(z.object({ purpose: purposeKind, purposeKey })),
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
    query: z.object({ purpose: purposeIn.optional() }),
  },
  responses: {
    200: {
      description: "The purpose that would be written and how many entries it would change",
      ...ok(z.object({ purpose: purposeKind, purposeKey, wouldChange: z.number() })),
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
        "application/json": { schema: z.object({ purpose: purposeIn.optional() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The purpose written and how many entries changed",
      ...ok(z.object({ purpose: purposeKind, purposeKey, changed: z.number() })),
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

const customPurpose = z.object({
  key: z.string().describe("`custom:<id>`"),
  id: z.string().uuid(),
  name: z.string(),
  nameEn: z.string().nullable(),
  kind: z.enum(PURPOSES),
  color: z.string(),
  icon: z.string(),
  archived: z.boolean(),
  usage: z.number().describe("Entries using it; deleting is only possible at 0"),
});

registry.registerPath({
  method: "get",
  path: "/purpose/catalogue",
  summary: "The built-in purposes and the account's own",
  description:
    "Every purpose maps to a kind (private | business), which the hiding setting, the counts and " +
    "the plugins read. Custom purposes are the caller's only and never travel with a share.",
  tags,
  responses: {
    200: {
      description: "Built-ins with both labels, then the custom ones",
      ...ok(
        z.object({
          builtins: z.array(
            z.object({
              key: z.string().describe("`builtin:<key>`"),
              kind: z.enum(PURPOSES),
              icon: z.string(),
              color: z.string(),
              label: z.object({ de: z.string(), en: z.string() }),
            })
          ),
          custom: z.array(customPurpose),
        })
      ),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/purpose/custom",
  summary: "Create a custom purpose",
  tags,
  request: { body: { content: { "application/json": { schema: customPurposeCreateSchema } } } },
  responses: { 201: { description: "The new purpose", ...ok(customPurpose) } },
});

registry.registerPath({
  method: "patch",
  path: "/purpose/custom/{id}",
  summary: "Rename, recolour, re-kind or archive a custom purpose",
  description: "A changed kind is carried onto every entry using the purpose.",
  tags,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: customPurposeUpdateSchema } } },
  },
  responses: {
    200: { description: "The updated purpose", ...ok(customPurpose) },
    404: { description: "`PURPOSE_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/purpose/custom/{id}",
  summary: "Delete an unused custom purpose",
  tags,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Deleted", ...ok(z.object({ deleted: z.literal(true) })) },
    404: { description: "`PURPOSE_NOT_FOUND`", content: errorContent },
    409: { description: "`PURPOSE_IN_USE`: archive it instead", content: errorContent },
  },
});
