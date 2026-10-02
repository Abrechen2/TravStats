import { z } from "./zod";

/** Default and ceiling of one feed page — bounded so one call stays small. */
export const SYNC_PAGE_DEFAULT = 200;
export const SYNC_PAGE_MAX = 500;

export const syncChangesQuerySchema = z.object({
  /** Opaque cursor from a previous answer; absent = start a full read. */
  since: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(SYNC_PAGE_MAX).default(SYNC_PAGE_DEFAULT),
});
