/**
 * Companion and tag endpoints — the two vocabularies a user builds up across
 * every travel form.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { companionMergeSchema, companionRenameSchema } from "../../../routes/companions";

const companionResponse = registry.register(
  "Companion",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      usageCount: z
        .number()
        .int()
        .describe("Flights + trips + cruises this companion is linked to"),
    })
    .openapi("Companion")
);

registry.registerPath({
  method: "get",
  path: "/companions",
  summary: "List your companions",
  description:
    "Returns the authenticated user's saved companions, most used first. " +
    "Feeds the companion picker in the flight, trip and cruise forms.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "Companions",
      content: {
        "application/json": {
          schema: z.object({ companions: z.array(companionResponse) }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

/*
 * Settings → Mitreisende and the overview's "Mit wem unterwegs". `kind` is a
 * domain key, or `trip` (no domain, never hidden); only the kinds the caller
 * sees are keyed.
 */
const useKind = z.enum(["flight", "trip", "cruise", "rail", "bus", "ferry", "rental"]);
const perKind = <T extends z.ZodTypeAny>(value: T) => z.record(useKind, value);
const person = z.object({ id: z.string(), username: z.string(), displayName: z.string() });
const idParams = z.object({ id: z.string().describe("A companion of yours") });
const notYours = {
  description: "`code` COMPANION_NOT_FOUND — also for another account's companion",
  content: errorContent,
};
const unauthenticated = { description: "Missing or invalid token", content: errorContent };
const limited = { description: "Rate limit exceeded", content: errorContent };

const managedCompanion = registry.register(
  "ManagedCompanion",
  z
    .object({
      id: z.string(),
      name: z.string(),
      linkedUser: person.nullable(),
      uses: perKind(z.number().int()).describe("Entries per visible kind, planned ones included"),
      hiddenUses: z.number().int().describe("Entries in domains switched off"),
      expensesPaid: z.number().int(),
      lastTogether: z.string().nullable().describe("`YYYY-MM-DD` of the last shared day"),
      inUse: z.boolean().describe("Entries, expenses or an account link block a delete"),
    })
    .openapi("ManagedCompanion")
);

const mergePreviewSchema = registry.register(
  "CompanionMergePreview",
  z
    .object({
      source: z.object({ id: z.string(), name: z.string(), linkedUser: person.nullable() }),
      target: z.object({ id: z.string(), name: z.string(), linkedUser: person.nullable() }),
      entries: perKind(z.object({ entries: z.number().int(), shared: z.number().int() })),
      hiddenEntries: z.number().int(),
      expensesPaid: z.number().int(),
      renamedLists: z.number().int(),
      link: z.enum(["none", "keepTarget", "moveToTarget", "conflict"]),
      allowed: z.boolean(),
    })
    .openapi("CompanionMergePreview")
);

registry.registerPath({
  method: "get",
  path: "/companions/manage",
  summary: "Your companions, for managing them",
  description:
    "Every companion with its uses per kind of entry you see, its account link and the last " +
    "day spent together. Feeds Settings → Mitreisende.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "Companions, by name",
      content: {
        "application/json": {
          schema: z.object({ companions: z.array(managedCompanion), kinds: z.array(useKind) }),
        },
      },
    },
    401: unauthenticated,
    429: limited,
  },
});

registry.registerPath({
  method: "get",
  path: "/companions/together",
  summary: "Who you travel with",
  description:
    "Per companion, all time: shared entries that have happened (per kind), distinct days " +
    "together and countries visited together by the passport's visited rule — `null` where no " +
    "shared entry could prove a country. Paying an expense is not travelling together.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "Companions with at least one shared entry, most days first",
      content: {
        "application/json": {
          schema: z.object({
            kinds: z.array(useKind),
            companions: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                entries: z.number().int(),
                perKind: perKind(z.number().int()),
                days: z.number().int(),
                countries: z.number().int().nullable(),
                lastTogether: z.string().nullable(),
              })
            ),
          }),
        },
      },
    },
    401: unauthenticated,
    429: limited,
  },
});

registry.registerPath({
  method: "patch",
  path: "/companions/{id}",
  summary: "Rename a companion",
  description:
    "Renames the companion and every list of names on your entries that spells them. A name " +
    "another companion already has is refused with `COMPANION_NAME_TAKEN`; merge instead.",
  tags: ["Companions"],
  request: {
    params: idParams,
    body: { content: { "application/json": { schema: companionRenameSchema } } },
  },
  responses: {
    200: {
      description: "Renamed",
      content: {
        "application/json": {
          schema: z.object({ companion: z.object({ id: z.string(), name: z.string() }) }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    401: unauthenticated,
    404: notYours,
    409: {
      description: "`code` COMPANION_NAME_TAKEN; `companionId` names the other",
      content: errorContent,
    },
    429: limited,
  },
});

registry.registerPath({
  method: "get",
  path: "/companions/{id}/merge-preview",
  summary: "What merging a companion into another would move",
  tags: ["Companions"],
  request: { params: idParams, query: z.object({ into: z.string() }) },
  responses: {
    200: {
      description: "The preview; `allowed` is false when both are linked to different accounts",
      content: { "application/json": { schema: z.object({ preview: mergePreviewSchema }) } },
    },
    400: {
      description: "`code` COMPANION_MERGE_SELF, or validation failed",
      content: errorContent,
    },
    401: unauthenticated,
    404: notYours,
    429: limited,
  },
});

registry.registerPath({
  method: "post",
  path: "/companions/{id}/merge",
  summary: "Merge a companion into another",
  description:
    "In one transaction: the entries, the expenses it paid and the lists of names move to " +
    "`into`, an entry both were on keeps one person, an account link moves only onto an " +
    "unlinked target, and the companion is deleted.",
  tags: ["Companions"],
  request: {
    params: idParams,
    body: { content: { "application/json": { schema: companionMergeSchema } } },
  },
  responses: {
    200: {
      description: "Merged; what moved",
      content: { "application/json": { schema: z.object({ merged: mergePreviewSchema }) } },
    },
    400: {
      description: "`code` COMPANION_MERGE_SELF, or validation failed",
      content: errorContent,
    },
    401: unauthenticated,
    404: notYours,
    409: { description: "`code` COMPANION_MERGE_LINK_CONFLICT", content: errorContent },
    429: limited,
  },
});

registry.registerPath({
  method: "delete",
  path: "/companions/{id}",
  summary: "Delete an unused companion",
  tags: ["Companions"],
  request: { params: idParams },
  responses: {
    204: { description: "Deleted" },
    401: unauthenticated,
    404: notYours,
    409: {
      description: "`code` COMPANION_IN_USE — on entries, paying expenses or linked; merge instead",
      content: errorContent,
    },
    429: limited,
  },
});

registry.registerPath({
  method: "post",
  path: "/companions/delete-unused",
  summary: "Delete every unused companion",
  description: "Companions on no entry, paying no expense and linked to no account.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "How many were deleted",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    401: unauthenticated,
    429: limited,
  },
});

registry.registerPath({
  method: "get",
  path: "/tags",
  summary: "Tags you have used before",
  description:
    "The authenticated user's distinct tags across flights (special flights included), " +
    "trips and cruises, with how often each is used. Tags differing only in case are one " +
    "tag, shown in the spelling used most. Most used first, then by name. `q` keeps tags " +
    "containing it (case-insensitive). Feeds the tag input of those forms.",
  tags: ["Companions"],
  request: {
    query: z.object({
      q: z.string().max(100).optional().describe("Substring to match, case-insensitive"),
      limit: z.coerce.number().int().min(1).max(50).optional().describe("Default 20, max 50"),
    }),
  },
  responses: {
    200: {
      description: "Ranked tags; empty when nothing matches",
      content: {
        "application/json": {
          schema: z.object({
            tags: z.array(z.object({ name: z.string(), usageCount: z.number().int() })),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});
