import { z } from "./zod";
import { OUTLIER_DECISIONS } from "../services/travtrack/bestSource/store";

/** The best-source routes (`routes/travtrack/daySources.ts`). */

export const daySourceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("The day, `YYYY-MM-DD`, on the profile's clock");

export const daySourceChoiceSchema = z
  .object({
    overrideSource: z
      .string()
      .min(1)
      .max(200)
      .nullable()
      .optional()
      .describe("The origin to draw the whole day from; null = automatic; absent = unchanged"),
    outlierDecision: z
      .enum(OUTLIER_DECISIONS)
      .nullable()
      .optional()
      .describe(
        "`discard`: outliers stay out, acknowledged; `keep`: draw them again; null = automatic"
      ),
  })
  .strict()
  .refine((c) => c.overrideSource !== undefined || c.outlierDecision !== undefined, {
    message: "Name at least one choice",
  });

export const questionableDaysQuerySchema = z.object({
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});
