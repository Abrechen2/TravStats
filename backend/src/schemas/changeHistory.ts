import { z } from "./zod";

import { ENTITY_TYPES } from "../services/changeLedger/models";
import { RETENTION_MONTHS_OPTIONS } from "../services/changeLedger/retentionPolicy";

/** `GET /change-history`: one entry's history, or the account's, a page at a time. */
export const changeHistoryQuerySchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES as [string, ...string[]]).optional(),
    entityId: z.string().min(1).max(64).optional(),
    after: z.string().uuid().optional(),
  })
  .refine((q) => !q.entityId || q.entityType, {
    message: "entityId needs entityType",
    path: ["entityId"],
  });

export const changeIdParamSchema = z.object({ id: z.string().uuid() });

/** `PUT /change-history/retention`: how many months of history the account keeps. */
export const changeHistoryRetentionSchema = z.object({
  months: z
    .number()
    .int()
    .refine((m) => (RETENTION_MONTHS_OPTIONS as readonly number[]).includes(m), {
      message: `months must be one of ${RETENTION_MONTHS_OPTIONS.join(", ")}`,
    }),
});
