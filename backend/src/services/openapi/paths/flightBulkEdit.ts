import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { BULK_EDIT_RESULT_STATUSES, flightBulkEditSchema } from "../../../schemas/flightBulkEdit";

/**
 * Trip, tags and companions over a selection of flights (forgejo#217):
 * `routes/flights/bulkEdit.ts`. Bare, like every flights router.
 */

const result = z.object({
  flightId: z.string().uuid(),
  status: z.enum(BULK_EDIT_RESULT_STATUSES),
  code: z
    .enum(["FLIGHT_NOT_FOUND", "UPDATE_FAILED"])
    .optional()
    .describe("Why this flight failed; absent unless `status` is `failed`"),
});

registry.registerPath({
  method: "post",
  path: "/flights/bulk-edit",
  summary: "Edit trip, tags and companions of several flights",
  description:
    "Each field ADDS to or REPLACES what a flight has (`trip` sets or clears). One result per " +
    "flight; a failure on one never undoes another. Every mode is idempotent, so a client " +
    "retries by sending the same body with only the failed ids — a flight that in fact went " +
    "through answers `unchanged`.",
  tags: ["Flights"],
  request: { body: { content: { "application/json": { schema: flightBulkEditSchema } } } },
  responses: {
    200: {
      description: "One result per flight, in the order sent, and the counts",
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(result),
            summary: z.object({
              updated: z.number().int(),
              unchanged: z.number().int(),
              failed: z.number().int(),
            }),
          }),
        },
      },
    },
    400: { description: "Invalid body", content: errorContent },
    404: {
      description: "`TRIP_NOT_FOUND`: the trip is not this account's — nothing was written",
      content: errorContent,
    },
  },
});
