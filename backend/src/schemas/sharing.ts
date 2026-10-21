import { z } from "./zod";

import { SHARE_ENTITIES, type ShareEntity } from "../services/sharing/shareTypes";

/**
 * The vocabularies of trip sharing (spec 2026-10-16, D6). Each list is also a
 * CHECK constraint (migration `share_vocabulary_checks`) and
 * `shareVocabulary.test.ts` holds the two together. Not Prisma enums: the
 * entity list IS the share registry, and a Prisma enum cannot be derived from
 * code — the loyalty domains made the same choice.
 */
export const CONSENT_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export const consentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

/**
 * `conflict` (spec 2026-10-20 F6, phase F-S4d): a change from another server met a copy that had
 * moved since — nothing was overwritten, and the person chooses between the two values.
 */
export const SHARE_NOTICE_KINDS = [
  "shared",
  "created",
  "updated",
  "deleted",
  "left",
  "conflict",
  // F-S4e: a member on another server asks the home to offer the trip to someone else (F5).
  "add-request",
] as const;
export const shareNoticeKindSchema = z.enum(SHARE_NOTICE_KINDS);
export type ShareNoticeKind = z.infer<typeof shareNoticeKindSchema>;

/** `trip` for shared/left notices, an entry type otherwise. */
export const SHARE_ENTITY_TYPES: readonly ("trip" | ShareEntity)[] = ["trip", ...SHARE_ENTITIES];
export const shareEntityTypeSchema = z.enum(SHARE_ENTITY_TYPES as ["trip", ...ShareEntity[]]);
export type ShareEntityType = z.infer<typeof shareEntityTypeSchema>;
