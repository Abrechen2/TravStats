import { z } from "zod";
import { COMPARISON_METRICS } from "../api/encryptedShare";
const nullableNumber = z.number().finite().nullable();
export const scope = z.object({
  statistics: z.boolean(),
  details: z.boolean(),
  personal: z.boolean(),
  costs: z.boolean(),
  photos: z.boolean(),
  documents: z.boolean(),
  domains: z.array(z.string().max(30)).max(20),
  tripIds: z.array(z.string().uuid()).max(500),
  futureTrips: z.boolean(),
  year: z.number().int().min(1900).max(2200).nullable(),
  precision: z.enum(["exact", "rounded"]),
  expiresAt: z.string().datetime().nullable(),
});
export const snapshot = z.object({
  version: z.literal(1),
  definition: z.literal("travstats-comparison-1"),
  asOf: z.string().datetime(),
  year: z.number().int().nullable(),
  precision: z.enum(["exact", "rounded"]),
  coverage: z.enum(["all", "selection"]),
  domains: z.array(z.string().max(30)).max(20),
  currency: z.string().length(3),
  metrics: z.object(
    Object.fromEntries(COMPARISON_METRICS.map((key) => [key, nullableNumber.optional()]))
  ),
  details: z.boolean(),
  trips: z.array(z.object({ id: z.string().uuid(), name: z.string().max(1000) })).max(500),
});
export const sourceSchema = z.object({
  version: z.literal(2),
  asOf: z.string().datetime(),
  scope,
  snapshot,
  sections: z.record(z.string().max(100), z.array(z.unknown()).max(100000)),
  assets: z.array(z.unknown()).max(20000),
  omitted: z.array(z.string().max(200)).max(200),
});
/** Bound recursive render/field-path traversal before handing peer-controlled JSON to the UI. */
export function checkTree(value: unknown, depth = 0, budget = { left: 2000000 }) {
  if (--budget.left < 0 || depth > 40) throw Error("E2E_DATA_COMPLEXITY");
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw Error("E2E_DATA_KEY");
      checkTree(child, depth + 1, budget);
    }
}
