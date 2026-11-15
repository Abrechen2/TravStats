import { z } from "./zod";

/**
 * Zod schemas of `/api/v1/readiness` (setup & readiness, spec 2026-11-14 §11).
 * Bare response family (ADR 0001).
 */

const noteActionSchema = z.union([
  z.object({ kind: z.literal("check"), checkId: z.string() }),
  z.object({ kind: z.literal("address"), address: z.string() }),
]);

export const readinessItemSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  scope: z.enum(["admin", "user"]),
  severity: z.enum(["required", "recommended"]),
  status: z.enum(["ready", "needsAction", "unknown"]),
  checkedAt: z.string().datetime().nullable(),
  titleKey: z.string(),
  consequenceKey: z.string(),
  action: z.string().nullable(),
  blockedBy: z.string().nullable(),
  optOutAllowed: z.boolean(),
  userState: z
    .union([
      z.object({ kind: z.literal("snoozed"), until: z.string().datetime() }),
      z.object({ kind: z.literal("optedOut") }),
    ])
    .nullable(),
});

export const readinessNoteSchema = z.object({
  id: z.string(),
  version: z.string(),
  audience: z.enum(["admin", "user"]),
  beforeKey: z.string(),
  afterKey: z.string(),
  action: noteActionSchema.nullable(),
  noActionReason: z.string().nullable(),
  acknowledged: z.boolean(),
  open: z.boolean(),
});

export const readinessResponseSchema = z.object({
  runningVersion: z.string(),
  summary: z.object({
    required: z.number().int(),
    recommended: z.number().int(),
    unknown: z.number().int(),
    newNotes: z.number().int(),
    blockedByAdmin: z.number().int(),
    ready: z.number().int(),
  }),
  items: z.array(readinessItemSchema),
  notes: z.array(readinessNoteSchema),
  invitation: z.object({
    show: z.boolean(),
    reason: z.enum(["update", "required"]).nullable(),
    snoozedUntil: z.string().datetime().nullable(),
    keys: z.array(z.string()),
  }),
  banner: z.object({ show: z.boolean(), itemIds: z.array(z.string()) }),
});

export const publicUrlCheckResponseSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string().datetime(),
  url: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  errorCode: z
    .enum([
      "NO_PUBLIC_URL",
      "OUTBOUND_DISABLED",
      "TIMEOUT",
      "DNS",
      "TLS",
      "CONNECTION",
      "HTTP_STATUS",
      "NOT_THIS_INSTANCE",
    ])
    .nullable(),
});

export const readinessIdParamsSchema = z.object({ id: z.string().min(1).max(128) });

export const snoozeBodySchema = z
  .object({ until: z.string().datetime({ offset: true }).optional() })
  .strict();

/** `POST /readiness/invitation/seen`: the keys the page rendered (optional; none = all current keys). */
export const invitationSeenBodySchema = z.object({
  keys: z.array(z.string().min(1).max(200)).max(100).optional(),
});
