import { z } from "../zod";

/**
 * The per-measure totals every insights response carries: the figure a tile
 * shows, folded from the same entries the evidence panel lists
 * (`services/stats/insights/measureItems.ts`).
 */
export const measureTotalsSchema = z
  .record(
    z.string(),
    z.object({
      allTime: z.number(),
      byYear: z.record(z.string(), z.number()).openapi({
        description: "A year with nothing has no key — never a 0 standing in for unknown.",
      }),
    })
  )
  .openapi({
    description:
      "Keyed by evidence measure (`GET /evidence/metric/:key` lists the entries behind each).",
  });
