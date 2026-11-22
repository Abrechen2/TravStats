import { z } from "zod";

import { registry } from "../registry";
import { gapCalendarQuerySchema } from "../../../schemas/gapCalendar";
import { errorContent } from "./shared";

/** The gap calendar (spec 2026-11-22-gap-calendar). */

const state = z.enum([
  "entry",
  "home",
  "track",
  "privacyZone",
  "implausible",
  "unknown",
  "outside",
]);

const gapCalendar = z.object({
  year: z.number().int(),
  zone: z.string().describe("The profile zone the days were read in"),
  today: z.string().describe("`YYYY-MM-DD` in that zone"),
  firstDay: z
    .string()
    .nullable()
    .describe("Earliest day with an entry or a fix, any year; null: nothing recorded yet"),
  years: z.array(z.number().int()).describe("From the first record to today; empty if none"),
  counts: z.record(state, z.number().int()),
  runs: z
    .array(z.object({ from: z.string(), to: z.string(), state }))
    .describe(
      "Inclusive runs of one state, ordered, covering the whole year. Precedence per day: " +
        "entry, home, track, privacyZone, implausible, unknown; days before the first record " +
        "or after today are `outside`, never a gap. A privacyZone day reveals no position."
    ),
});

registry.registerPath({
  method: "get",
  path: "/gap-calendar",
  summary: "Gap calendar of a year",
  description:
    "Per day of the year: covered by a logbook entry, at home, tracked, hidden by a privacy " +
    "zone, filtered as implausible, or unknown (the gap). Own account only.",
  tags: ["TravTrack"],
  request: { query: gapCalendarQuerySchema },
  responses: {
    200: { description: "The year", content: { "application/json": { schema: gapCalendar } } },
    400: { description: "VALIDATION_FAILED: not a year", content: errorContent },
  },
});
