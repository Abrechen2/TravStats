/**
 * Linking an existing copy (forgejo#440): request bodies and the response shapes the OpenAPI spec
 * publishes — the same shapes for the local path (`/sharing/trips/:tripId/link*`) and the one
 * across servers (`/sharing/remote/offers/:id/link*`).
 */
import { SHARE_ENTITIES } from "../services/sharing/shareTypes";
import { z } from "./zod";

const id = z.string().min(1).max(100);
/** `best`: the bulk link's — the better value wins each difference, a tie keeps both. */
const decision = z.enum(["mine", "theirs", "both", "best"]);
const fieldChoice = z.enum(["mine", "theirs", "both"]);

/** Per pair (`<entity>:<entry id>` from the dry run), per group: the person's own choice. */
const MAX_CHOICE_PAIRS = 2000;
const MAX_CHOICE_GROUPS = 80;
const choices = z
  .record(z.string().min(1).max(160), z.record(z.string().min(1).max(80), fieldChoice))
  .refine((r) => Object.keys(r).length <= MAX_CHOICE_PAIRS, "Too many pairs")
  .refine(
    (r) => Object.values(r).every((g) => Object.keys(g).length <= MAX_CHOICE_GROUPS),
    "Too many fields"
  )
  .optional();

export const linkCandidatesQuerySchema = z.object({ userId: id }).strict();
export const linkPreviewBodySchema = z.object({ userId: id, targetTripId: id }).strict();
export const linkBodySchema = z
  .object({ userId: id, targetTripId: id, decision, choices })
  .strict();

export const offerLinkPreviewBodySchema = z.object({ tripId: id }).strict();
export const offerLinkBodySchema = z.object({ tripId: id, decision, choices }).strict();

const day = z.string().nullable();
const tripView = z.strictObject({ id: z.string(), name: z.string(), startDay: day, endDay: day });
const entity = z.enum(SHARE_ENTITIES);
const entry = z.strictObject({ entity, label: z.string(), when: z.string().nullable() });

/** Before the other account agreed to sharing: this and nothing else (no derived field). */
const awaitingConsent = z.strictObject({ access: z.literal("awaitingConsent") });

export const linkCandidatesSchema = z.union([
  z.strictObject({
    access: z.literal("full"),
    candidates: z.array(tripView.extend({ reason: z.enum(["period", "name", "overlap"]) })),
  }),
  awaitingConsent,
]);

/** A differing value: a display value (times in the place's zone, ADR 0002) or a line. */
const linkValue = z.union([
  z.object({
    kind: z.literal("line"),
    quality: z.enum(["drawn", "routed", "straight", "none"]),
    points: z.number().int(),
    lines: z.number().int().optional(),
  }),
  z
    .object({
      kind: z.enum([
        "time",
        "day",
        "wallClock",
        "text",
        "number",
        "boolean",
        "list",
        "empty",
        "other",
      ]),
    })
    .passthrough(),
]);

const linkPreviewFull = z.strictObject({
  access: z.literal("full"),
  here: tripView,
  there: tripView,
  counts: z.strictObject({
    matched: z.number().int(),
    onlyHere: z.number().int(),
    onlyThere: z.number().int(),
    conflicting: z.number().int(),
    needsReview: z.number().int(),
  }),
  automatic: z.boolean(),
  byType: z.array(
    z.strictObject({
      entity,
      here: z.number().int(),
      there: z.number().int(),
      matched: z.number().int(),
      differing: z.number().int(),
    })
  ),
  matched: z.array(
    entry.extend({
      ref: z.string(),
      linked: z.boolean(),
      conflicts: z.array(
        z.strictObject({
          field: z.string(),
          here: linkValue,
          there: linkValue,
          better: z.enum(["here", "there"]).nullable(),
          real: z.boolean(),
        })
      ),
      recomputed: z.array(z.string()),
      automatic: z.boolean(),
    })
  ),
  onlyHere: z.array(entry),
  onlyThere: z.array(entry),
});

export const linkPreviewSchema = z.union([linkPreviewFull, awaitingConsent]);

export const linkResultSchema = z.strictObject({
  groupId: z.string(),
  linked: z.number().int(),
  alreadyLinked: z.number().int(),
  skipped: z.number().int(),
  settled: z.number().int(),
  onlyHere: z.number().int(),
  onlyThere: z.number().int(),
  settleFailed: z.boolean(),
});

/** The bulk link (UAT 2026-11-27): the pairs, and the trips to offer across servers. */
export const bulkLocalQuerySchema = z.object({ userId: id }).strict();
export const bulkOfferQuerySchema = z.object({ remoteId: z.string().uuid() }).strict();
export const bulkOfferBodySchema = z
  .object({ tripId: z.string().uuid(), remoteId: z.string().uuid() })
  .strict();

const bulkPair = z.strictObject({
  id: z.string(),
  trip: tripView.nullable(),
  other: tripView,
  reason: z.enum(["period", "name", "overlap"]).nullable(),
  linked: z.boolean(),
  ambiguous: z.boolean(),
  from: z.strictObject({ displayName: z.string(), origin: z.string() }).optional(),
});

export const bulkPairsSchema = z.union([
  z.strictObject({ access: z.literal("full"), pairs: z.array(bulkPair) }),
  awaitingConsent,
]);

export const bulkOfferCandidatesSchema = z.array(tripView.extend({ offered: z.boolean() }));
