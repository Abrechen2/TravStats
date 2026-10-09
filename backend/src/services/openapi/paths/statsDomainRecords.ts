/**
 * GET /stats/domain-records — travel records beyond flights (forgejo#265).
 * Its own module because `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { domainRecordsResponseSchema } from "../../../schemas/statsDomainRecords";

const domainRecords = registry.register(
  "DomainRecords",
  domainRecordsResponseSchema.openapi("DomainRecords")
);

registry.registerPath({
  method: "get",
  path: "/stats/domain-records",
  summary: "Travel records beyond flights",
  description:
    "One record per further domain the user sees — the longest cruise (days), stay " +
    "(nights), roadtrip (days), rental (days), train and bus ride (km), the most visited " +
    "place (visits) — each counted by its domain's own rule and linked to its entry. " +
    "Lifetime. A hidden domain, or one with nothing measurable, has no record.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The records",
      content: { "application/json": { schema: domainRecords } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});
