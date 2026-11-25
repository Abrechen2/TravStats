/**
 * Linking an existing copy (forgejo#440): request bodies and the response shapes the OpenAPI spec
 * publishes — the same shapes for the local path (`/sharing/trips/:tripId/link*`) and the one
 * across servers (`/sharing/remote/offers/:id/link*`).
 */
import { SHARE_ENTITIES } from "../services/sharing/shareTypes";
import { z } from "./zod";

const id = z.string().min(1).max(100);
const decision = z.enum(["mine", "theirs", "both"]);

export const linkCandidatesQuerySchema = z.object({ userId: id }).strict();
/** `targetTripId` is ignored before the other account agreed: the server picks the candidate. */
export const linkPreviewBodySchema = z
  .object({ userId: id, targetTripId: id.nullable().optional() })
  .strict();
export const linkBodySchema = z.object({ userId: id, targetTripId: id, decision }).strict();

export const offerLinkPreviewBodySchema = z.object({ tripId: id }).strict();
export const offerLinkBodySchema = z.object({ tripId: id, decision }).strict();

const day = z.string().nullable();
const tripView = z.strictObject({ id: z.string(), name: z.string(), startDay: day, endDay: day });
const entity = z.enum(SHARE_ENTITIES);
const entry = z.strictObject({ entity, label: z.string(), when: z.string().nullable() });

export const linkCandidatesSchema = z.strictObject({
  candidates: z.array(tripView.extend({ reason: z.enum(["period", "name", "overlap"]) })),
  possibleCopy: z.boolean(),
});

export const linkPreviewSchema = z.strictObject({
  redacted: z.boolean(),
  here: tripView,
  there: tripView,
  counts: z.strictObject({
    matched: z.number().int(),
    onlyHere: z.number().int(),
    onlyThere: z.number().int().nullable(),
    conflicting: z.number().int(),
  }),
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
      linked: z.boolean(),
      conflicts: z.array(
        z.strictObject({ field: z.string(), here: z.string(), there: z.string() })
      ),
    })
  ),
  onlyHere: z.array(entry),
  onlyThere: z.array(entry),
});

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
