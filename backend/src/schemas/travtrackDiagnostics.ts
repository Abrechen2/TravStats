import { z } from "./zod";

/**
 * The TravTrack diagnostics log's wire shapes (spec
 * 2026-10-29-travtrack-diagnostics). The envelope is checked here; each event
 * is judged on its own in `services/travtrack/diagnostics/judge.ts`, so one bad
 * event does not refuse the upload.
 */

export const DIAGNOSTICS_MAX_BODY_BYTES = 256 * 1024;
export const DIAGNOSTICS_MAX_EVENTS = 2000;
/**
 * How long the server keeps a log, and the oldest event it takes. 7 days since
 * the perf audit 2026-11 (item 8): at 14 one phone's log held 849k rows /
 * 352 MB, as large as the whole point history.
 */
export const DIAGNOSTICS_RETENTION_DAYS = 7;
/**
 * The most events one account keeps, whatever their age; the nightly sweep
 * removes the oldest beyond it. About 3.5 days of the busiest phone measured
 * (60k events a day), so a runaway logger cannot outgrow the points table.
 */
export const DIAGNOSTICS_MAX_EVENTS_PER_ACCOUNT = 200_000;

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.,:()/+-]{0,79}$/);

export const diagnosticsUploadSchema = z
  .object({
    uploadId: z.string().trim().min(1).max(200),
    device: z
      .object({
        model: identifier.optional(),
        os: identifier.optional(),
        appVersion: identifier.optional(),
        timeZone: identifier.optional(),
      })
      .strict()
      .optional(),
    events: z.array(z.record(z.string(), z.unknown())).min(1).max(DIAGNOSTICS_MAX_EVENTS),
  })
  .strict();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const deviceId = z.string().min(1).max(200);

export const diagnosticsDayQuerySchema = z.object({
  date: day.describe("The day, `YYYY-MM-DD`, on the profile's clock"),
  deviceId: deviceId.optional().describe("The device; default: the one with the most events"),
});

export const diagnosticsExportQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).describe("ISO instant, inclusive"),
    to: z.string().datetime({ offset: true }).describe("ISO instant, exclusive"),
    deviceId: deviceId.optional().describe("One device; default: all"),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), "`from` must lie before `to`")
  .refine(
    (q) => Date.parse(q.to) - Date.parse(q.from) <= DIAGNOSTICS_RETENTION_DAYS * 86_400_000,
    `At most ${DIAGNOSTICS_RETENTION_DAYS} days`
  );
