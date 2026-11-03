import { LEG_MODES } from "../services/travtrack/legs/types";
import { z } from "./zod";

/** The longest span one correction names; a leg lies inside one profile day. */
export const TRAVTRACK_LEG_SPAN_MAX_MS = 2 * 86_400_000;

/**
 * `PUT /travtrack/legs/mode` (spec 2026-11-03-travtrack-legs, §2). `mode: null`
 * resets the span to automatic. The route answers a bad body with
 * `TRAVTRACK_LEG_INVALID` itself, so this schema is parsed with `safeParse`.
 */
export const travTrackLegModeBodySchema = z
  .object({
    fromMs: z.number().int().nonnegative().describe("Start of the span, epoch milliseconds"),
    untilMs: z.number().int().nonnegative().describe("End of the span, epoch milliseconds"),
    mode: z.enum(LEG_MODES).nullable().describe("The corrected mode; null resets to automatic"),
  })
  .refine((b) => b.untilMs > b.fromMs, "The span must end after it starts")
  .refine(
    (b) => b.untilMs - b.fromMs <= TRAVTRACK_LEG_SPAN_MAX_MS,
    "A correction spans at most two days"
  );
