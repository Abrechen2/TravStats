import { z } from "zod";

import { ENTITY_TYPES } from "../services/changeLedger/models";

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
