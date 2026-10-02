/**
 * Deleting a route section (roadtrip or tour). Split out of `./tours.ts`, which
 * crossed the 800-line limit once the delete learned what happens to a
 * section's costs (forgejo#140).
 */

import { z } from "zod";

import { errorContent } from "./shared";
import { registerSectionPath, routeIdParams } from "./tours";

const sectionHasExpenses = z.object({
  error: z.string(),
  code: z.literal("SECTION_HAS_EXPENSES"),
  expenseCount: z.number().int(),
});

registerSectionPath({
  method: "delete",
  path: "/trips/{id}/routes/{routeId}",
  summary: "Delete a route section",
  description:
    "Deletes the section and its legs. Its stops are RELEASED, not deleted — " +
    "a tour is scaffolding over the timeline; removing the scaffolding must " +
    "not remove the timeline entries themselves. Its costs (forgejo#140) become " +
    "the trip's trip-wide costs, station and leg pins cleared. A section with " +
    "no trip and with costs is refused (409 `SECTION_HAS_EXPENSES`, with " +
    "`expenseCount`) unless `deleteExpenses=true` is sent.",
  tags: ["Tours"],
  request: {
    params: routeIdParams,
    // Opt-in for a section with no trip; a section on a trip hands its costs over regardless.
    query: z.object({ deleteExpenses: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
    409: {
      description: "The section belongs to no trip and carries costs; nothing was deleted",
      content: { "application/json": { schema: sectionHasExpenses } },
    },
  },
});
