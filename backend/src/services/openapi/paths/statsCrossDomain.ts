/**
 * GET /stats/cross-domain — cheap cross-domain statistics (forgejo#399).
 * Its own module because `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { crossDomainStatsSchema } from "../../../schemas/statsCrossDomain";

const crossDomain = registry.register("CrossDomainStats", crossDomainStatsSchema);

registry.registerPath({
  method: "get",
  path: "/stats/cross-domain",
  summary:
    "Cross-domain streaks, rhythm, time shift, last visits, price per km, nights, Schengen, photos",
  description:
    "Eight additive blocks derived from records the logbook already holds. Each is null " +
    "when it cannot be derived (never a zero) and listed in `unavailable` when its load " +
    "failed. Only domains the user sees count. Amounts are per original currency.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The blocks",
      content: { "application/json": { schema: crossDomain } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});
