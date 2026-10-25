/**
 * Query and response pieces shared by the year-scopable stats paths
 * (companion-redesign C4). Not a path file of its own: it registers nothing.
 */

import { z } from "zod";
import { statsScopeSchema } from "../../../schemas/statsScope";

export { statsScopeSchema };

export const yearQuery = z.object({
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe("Local calendar year of the departure; omitted = all-time"),
});

export const yearOrRangeQuery = yearQuery.extend({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const yearScopeErrors = {
  400: {
    description:
      "Invalid query, or `year` together with `fromDate`/`toDate` " +
      "(`code: VALIDATION_FAILED`, `field: year`)",
    content: {
      "application/json": {
        schema: z.object({
          error: z.string(),
          code: z.string().optional(),
          field: z.string().optional(),
        }),
      },
    },
  },
};

/**
 * `?year=` on the passport and the country page (companion-redesign C4), and
 * the `scope` every such answer carries so a client can check what it got.
 */
export const yearScopeQuery = z.object({
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe(
      "Only this calendar year's evidence, each record dated by its own local day; " +
        "undated records belong to no year and are left out. Omitted: lifetime."
    ),
});

/** `/stats/summary` with `year` AND `compareYear`: both years side by side. */
export function summaryCompareResponse<T extends z.ZodTypeAny>(summary: T) {
  return z.object({ current: summary, compare: summary, scope: statsScopeSchema });
}
