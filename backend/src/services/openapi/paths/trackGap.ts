import { registry } from "../registry";
import { errorContent } from "./shared";
import { putTrackGapSchema, trackGapSchema } from "../../../schemas/trackGap";

/** `routes/settings/trackGap.ts`. Bare. */

registry.registerPath({
  method: "get",
  path: "/settings/track-gap",
  summary: "The time gap that splits a recorded track",
  description:
    "A recording is cut into separate tracks only where the phone recorded nothing for " +
    "longer than this; distance alone never cuts one. The default is 120 minutes.",
  tags: ["Settings"],
  responses: {
    200: {
      description: "The account's gap and its bounds",
      content: { "application/json": { schema: trackGapSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/track-gap",
  summary: "Set the time gap that splits a recorded track",
  description: "Applies to every read from now on; stored points are never changed. Whole minutes.",
  tags: ["Settings"],
  request: { body: { content: { "application/json": { schema: putTrackGapSchema } } } },
  responses: {
    200: {
      description: "What is set now",
      content: { "application/json": { schema: trackGapSchema } },
    },
    400: {
      description: "VALIDATION_FAILED: not whole minutes within the bounds",
      content: errorContent,
    },
    403: { description: "A read-only token, or the shared demo account", content: errorContent },
  },
});
