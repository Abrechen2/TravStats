/**
 * The composing statistics endpoint (forgejo#49).
 *
 * Its own file rather than a block appended to `paths/stats.ts`, which sits at
 * 747 lines against a limit of 800 and is not on the frozen-size list — a
 * sixty-line addition there would put it on that list for good.
 */

import { z } from "zod";

import { STATS_PAGE_SECTIONS, statsPageResponseSchema } from "../../../schemas/statsPage";
import { registry } from "../registry";

const statsPage = registry.register("StatsPage", statsPageResponseSchema.openapi("StatsPage"));

registry.registerPath({
  method: "get",
  path: "/stats/page",
  summary: "Several statistics sections, from one pass over the flight table",
  description:
    "Composes the sections named in `include` from a SINGLE load of the " +
    "countable flights (flown + historical, all time). Each section's body is " +
    "identical to the response of the endpoint it is named after — " +
    "`/stats/fun`, `/stats/business`, `/stats/unique`, `/stats/airports`, " +
    "`/stats/seats`, `/stats/countries`, `/stats/airlines`, `/stats/aircraft`, " +
    "`/stats/punctuality` — which all remain served and are what a client " +
    "should use when it needs one figure. Measured on the statistics page: " +
    "the flight tab issued twelve requests answered by fifteen passes over " +
    "the flight table; through this endpoint it issues four, answered by " +
    "eight.\n\n" +
    "Takes NO date range, on purpose: four of the nine sections have no " +
    "date-range parameter on their own endpoint, so a range here would narrow " +
    "five sections and leave four at all-time — one population presented as " +
    "two. A section is present in the response exactly when `include` named " +
    "it; an unknown name is a 400 rather than an absent section, so a typo " +
    "cannot read as 'no data'.",
  tags: ["Stats"],
  request: {
    query: z.object({
      include: z
        .string()
        .describe(
          `Comma-separated section names, at least one. One of: ${STATS_PAGE_SECTIONS.join(", ")}.`
        ),
    }),
  },
  responses: {
    200: {
      description: "The requested sections, each in the shape its own endpoint answers with",
      content: { "application/json": { schema: statsPage } },
    },
    400: {
      description: "`include` is missing, empty, or names a section that does not exist",
    },
  },
});
