import { z } from "zod";

/**
 * Where a flight's or a trip's track came from (TravTrack plan T5) — shared by
 * `flightDevice.ts` and `tripRecording.ts`. Additive fields.
 */

const origins = ["travstats", "travtrack", "dawarich"] as const;

export const trackOriginFields = {
  origin: z
    .enum(origins)
    .nullable()
    .describe(
      "travstats: the entry's own recording; travtrack / dawarich: read from that provider; " +
        "null: nothing to show"
    ),
  coverage: z
    .enum(["complete", "truncated", "unreachable"])
    .nullable()
    .describe("A short (truncated) or failed (unreachable) read is said, never passed off whole"),
  alternatives: z
    .array(z.enum(origins))
    .describe(
      "Other sources that may hold something for the entry; `?source=` shows one (404 " +
        "TRACK_SOURCE_NOT_AVAILABLE when it turns out to hold nothing)"
    ),
  unchecked: z
    .array(z.enum(origins))
    .describe(
      "The alternatives offered without being read (Dawarich: a working connection exists, " +
        "its window was not asked) — a client says 'not checked yet', never that they hold data"
    ),
};

export const trackSourceQuery = z.object({
  source: z
    .enum(origins)
    .optional()
    .describe("Show this source explicitly; 404 TRACK_SOURCE_NOT_AVAILABLE when it holds nothing"),
});

export const sourceNotAvailable =
  "TRACK_SOURCE_NOT_AVAILABLE: `?source=` names a source that holds nothing for the entry";
