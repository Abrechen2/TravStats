import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  BULK_EDIT_PATHS,
  BULK_FIELDS,
  BULK_RESULT_CODES,
  BULK_RESULT_STATUSES,
  domainBulkEditSchema,
  type BulkDomain,
} from "../../../schemas/domainBulkEdit";

/**
 * Bulk edit for rail, bus, ferry, rentals, cruises and stays (forgejo#405 A4):
 * `routes/domainBulkEdit.ts`. Enveloped, like every router of these domains.
 */

const result = z.object({
  id: z.string().uuid(),
  status: z.enum(BULK_RESULT_STATUSES),
  code: z
    .enum(BULK_RESULT_CODES)
    .optional()
    .describe("Why this row failed; absent unless `status` is `failed`"),
  version: z
    .string()
    .optional()
    .describe(
      "A stay whose write failed after its version claim: the version it is at now, for the retry's `baseVersions`"
    ),
});

const answer = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(result),
    summary: z.object({
      updated: z.number().int(),
      unchanged: z.number().int(),
      failed: z.number().int(),
    }),
  }),
});

const TAGS: Record<BulkDomain, string> = {
  rail: "Rail",
  bus: "Bus",
  ferry: "Ferry",
  rental: "Rentals",
  cruise: "Cruises",
  stay: "Lodging",
};

for (const domain of Object.keys(BULK_EDIT_PATHS) as BulkDomain[]) {
  registry.registerPath({
    method: "post",
    path: BULK_EDIT_PATHS[domain],
    summary: `Edit ${BULK_FIELDS[domain].join(", ")} of several ${domain} rows`,
    description:
      "Each list field ADDS to or REPLACES what a row has; `trip` and the text fields set or " +
      "clear; `status` cancels or reinstates (a reinstated row takes the status its dates give). " +
      "One result per row; a failure on one never undoes another. Every mode is idempotent, so a " +
      "client retries by sending the same body with only the failed ids. `baseVersions` maps an " +
      "id to the `updatedAt` it was read at: a row that moved on answers `VERSION_CONFLICT` and " +
      "is not written (the sync precondition of forgejo#141, per row).",
    tags: [TAGS[domain]],
    request: {
      body: { content: { "application/json": { schema: domainBulkEditSchema(domain) } } },
    },
    responses: {
      200: {
        description: "One result per row, in the order sent, and the counts",
        content: { "application/json": { schema: answer } },
      },
      400: { description: "Invalid body", content: errorContent },
      404: {
        description: "`TRIP_NOT_FOUND`: the trip is not this account's — nothing was written",
        content: errorContent,
      },
    },
  });
}
