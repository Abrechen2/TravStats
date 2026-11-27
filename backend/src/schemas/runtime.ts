import { z } from "./zod";

/**
 * `GET /api/v1/admin/runtime` (perf audit 2026-11, item 4). Bare response
 * family (ADR 0001). Admin only: figures about the process and the database.
 */
const slowEntrySchema = z.object({
  key: z.string(),
  durationMs: z.number(),
  recordedAt: z.string().datetime(),
  suppressed: z.number().int(),
});

export const runtimeReportSchema = z.object({
  checkedAt: z.string().datetime(),
  uptimeSeconds: z.number().int(),
  eventLoop: z
    .object({
      p50Ms: z.number(),
      p99Ms: z.number(),
      maxMs: z.number(),
      windowMs: z.number().int(),
    })
    .nullable(),
  memory: z.object({
    rssMb: z.number().int(),
    heapUsedMb: z.number().int(),
    heapTotalMb: z.number().int(),
    heapLimitMb: z.number().int(),
    externalMb: z.number().int(),
  }),
  database: z.object({
    ping: z.object({
      ok: z.boolean(),
      latencyMs: z.number().nullable(),
      error: z.string().optional(),
    }),
    pool: z
      .object({
        max: z.number().int(),
        total: z.number().int(),
        idle: z.number().int(),
        waiting: z.number().int(),
      })
      .nullable(),
    statements: z.object({
      status: z.enum(["available", "notInstalled", "notLoaded", "error"]),
      statements: z.array(
        z.object({
          query: z.string(),
          calls: z.number().int(),
          meanMs: z.number(),
          maxMs: z.number(),
          totalMs: z.number(),
          rows: z.number().int(),
        })
      ),
      error: z.string().optional(),
    }),
  }),
  jobs: z.object({
    heavySlot: z.object({
      running: z.object({ name: z.string(), stateSince: z.string().datetime() }).nullable(),
      waiting: z.array(z.string()),
    }),
    importWriteSlot: z.object({ held: z.number().int(), waiting: z.number().int() }),
  }),
  slowRequests: z.array(slowEntrySchema),
  slowQueries: z.array(slowEntrySchema),
});
