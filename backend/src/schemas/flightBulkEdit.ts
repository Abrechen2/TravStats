import { z } from "./zod";

/**
 * `POST /flights/bulk-edit` (forgejo#217): trip, tags and companions over an
 * EXPLICIT list of flights. Each field says whether it ADDS to what a flight
 * has or REPLACES it, so the preview and the server mean the same thing.
 * Every mode is idempotent — sending the same body twice changes nothing the
 * second time — which is what makes "retry the failed ones" safe.
 */

export const BULK_EDIT_MAX_FLIGHTS = 200;

const listEdit = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    mode: z.enum(["add", "replace"]),
    values: z.array(item).max(50),
  });

export const flightBulkEditSchema = z
  .object({
    flightIds: z
      .array(z.string().uuid())
      .min(1)
      .max(BULK_EDIT_MAX_FLIGHTS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "flightIds must not repeat",
      }),
    trip: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("set"), tripId: z.string().uuid() }),
        z.object({ mode: z.literal("clear") }),
      ])
      .optional(),
    tags: listEdit(z.string().trim().min(1).max(40)).optional(),
    companions: listEdit(z.string().trim().min(1).max(100)).optional(),
  })
  .refine((body) => body.trip || body.tags || body.companions, {
    message: "Name at least one of trip, tags or companions",
  });

export type FlightBulkEdit = z.infer<typeof flightBulkEditSchema>;

export const BULK_EDIT_RESULT_STATUSES = ["updated", "unchanged", "failed"] as const;
