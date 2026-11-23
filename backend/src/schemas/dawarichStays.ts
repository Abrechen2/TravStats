import { z } from "./zod";
import { timeFieldSchema } from "../shared/time/timeInput";
export const stayReviewSchema = z
  .object({
    placeId: z.string().uuid().nullable(),
    tripId: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    startAt: timeFieldSchema({ impliedPlace: true }),
    endAt: timeFieldSchema({ impliedPlace: true }),
    /**
     * Private or business for the visit (spec 2026-11-23-plugins-and-calendar.md). Absent:
     * the finding's `evidence.suggestedPurpose`, if any; null: deliberately unknown.
     */
    purpose: z.enum(["private", "business"]).nullable().optional(),
  })
  .strict();
export type StayReview = z.infer<typeof stayReviewSchema>;
