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
    /**
     * The plugin suggestion the user picked (spec 2026-11-23, Part B): the place it makes or finds
     * carries `externalRef = plugin:<pluginId>:<externalRef>`, so a second visit finds it again.
     */
    pluginRef: z
      .object({ pluginId: z.string().uuid(), externalRef: z.string().min(1).max(200) })
      .strict()
      .optional(),
  })
  .strict();
export type StayReview = z.infer<typeof stayReviewSchema>;
