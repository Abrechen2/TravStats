import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackExploredQuerySchema } from "../../../schemas/travtrack";

/** TravTrack's explored map (TravTrack plan L1). */

const explored = z.object({
  cells: z
    .array(z.tuple([z.number().int(), z.number().int()]).describe("`[x, y]` tile at zoom 14"))
    .describe(
      "Every explored Web-Mercator tile at zoom 14 in the box, whatever the map's zoom; " +
        "privacy zones are drawn as explored ground when an explored tile borders them. " +
        "No time, no point."
    ),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/explored",
  summary: "The explored map",
  description:
    "The account's explored tiles in a box, one resolution only. At most 50 000 tiles per " +
    "answer. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { query: travTrackExploredQuerySchema },
  responses: {
    200: { description: "The tiles", content: { "application/json": { schema: explored } } },
    400: {
      description:
        "VALIDATION_FAILED: not a box; TRAVTRACK_EXPLORED_ZOOM_IN: more tiles than one answer carries",
      content: errorContent,
    },
    409: {
      description:
        "TRAVTRACK_EXPLORED_UNAVAILABLE: the account's privacy zones cover more ground than " +
        "the explored map can keep private; no part of the map is answered",
      content: errorContent,
    },
    403: {
      description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
      content: errorContent,
    },
  },
});
