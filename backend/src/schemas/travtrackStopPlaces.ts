import { TRAVTRACK_LEG_SPAN_MAX_MS } from "./travtrackLegs";
import { z } from "./zod";

/**
 * `GET|PUT /travtrack/stops/place` (spec 2026-11-03-travtrack-legs, "As built
 * — stop places"). The routes answer a bad request with
 * `TRAVTRACK_STOP_INVALID` themselves, so these are parsed with `safeParse`.
 */

const span = {
  fromMs: z.coerce.number().int().nonnegative().describe("Start of the stop, epoch milliseconds"),
  untilMs: z.coerce.number().int().nonnegative().describe("End of the stop, epoch milliseconds"),
};

const spanOk = (b: { fromMs: number; untilMs: number }) =>
  b.untilMs > b.fromMs && b.untilMs - b.fromMs <= TRAVTRACK_LEG_SPAN_MAX_MS;
const SPAN_MESSAGE = "The span must end after it starts and be at most two days";

export const travTrackStopPlaceQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).describe("The stop's anchor latitude"),
    lon: z.coerce.number().min(-180).max(180).describe("The stop's anchor longitude"),
    ...span,
  })
  .refine(spanOk, SPAN_MESSAGE);

export const travTrackStopPlaceBodySchema = z
  .object({
    ...span,
    place: z
      .object({
        name: z.string().trim().min(1).max(200).describe("The name the owner accepted"),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lon: z.number().min(-180).max(180).nullable().optional(),
      })
      .nullable()
      .describe("The accepted place; null removes the name from the stop"),
  })
  .refine(spanOk, SPAN_MESSAGE);

export const travTrackStopDismissBodySchema = z
  .object({
    ...span,
    dismissed: z
      .boolean()
      .describe("true marks the stop as only a wait; false takes that back and restores it"),
  })
  .refine(spanOk, SPAN_MESSAGE);
