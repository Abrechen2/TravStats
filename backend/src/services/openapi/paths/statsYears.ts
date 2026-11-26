/** GET /stats/years — distance per year and month. Its own module: `./stats.ts` is near the limit. */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { yearCountsSchema, yearStatsSchema } from "../../../schemas/statsYears";

const yearStats = registry.register("YearStats", yearStatsSchema);

registry.registerPath({
  method: "get",
  path: "/stats/years",
  summary: "Distance per year and month across the travel domains, TravTrack recorded km beside it",
  description:
    "One card per year, newest first, each with twelve months. `loggedKm` is what the logbook's " +
    "entries measured, split by domain; `recordedKm` is TravTrack's ground kilometres and is " +
    "never added to it (a recording can contain a logged ride). Null where nothing was measured, " +
    "never zero. Honours `onlyRecorded` and the hidden purposes.",
  tags: ["Stats"],
  responses: {
    200: { description: "The cards", content: { "application/json": { schema: yearStats } } },
    304: { description: "Not modified since the ETag in If-None-Match" },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

const yearCounts = registry.register("YearCounts", yearCountsSchema);

registry.registerPath({
  method: "get",
  path: "/stats/years/counts",
  summary: "Entries per year and domain, for the year picker's captions",
  description:
    "Newest year first. Counted under the same per-domain rules and request scope as " +
    "`/stats/years`, so a year's count and its card agree. A year without a countable entry is " +
    "absent, never zero.",
  tags: ["Stats"],
  responses: {
    200: { description: "The counts", content: { "application/json": { schema: yearCounts } } },
    304: { description: "Not modified since the ETag in If-None-Match" },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});
