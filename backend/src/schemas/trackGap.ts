import { z } from "./zod";
import {
  DEFAULT_TRACK_GAP_MINUTES,
  MAX_TRACK_GAP_MINUTES,
  MIN_TRACK_GAP_MINUTES,
} from "../services/tripRecording/trackGapBounds";

/** `GET/PUT /settings/track-gap`: the one time gap that cuts a recorded track in two. */
export const putTrackGapSchema = z
  .object({
    minutes: z.number().int().min(MIN_TRACK_GAP_MINUTES).max(MAX_TRACK_GAP_MINUTES),
  })
  .strict();

export const trackGapSchema = z.object({
  minutes: z.number().int().describe("Longest silence inside one track, in minutes"),
  default: z.number().int().describe(`The default (${DEFAULT_TRACK_GAP_MINUTES})`),
  min: z.number().int(),
  max: z.number().int(),
});
