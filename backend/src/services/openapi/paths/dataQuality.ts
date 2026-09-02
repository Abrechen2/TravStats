/**
 * The data-quality inbox — questions about records, not verdicts on them.
 *
 * A record whose own two sources disagree is written unchanged, flagged, and the
 * question queued (owner's decision, 2026-09-02). Nothing here changes a
 * statistic: a country proved by a suspect house keeps counting while its flag
 * is open, because withholding it would be exactly the invisible arithmetic the
 * country-counting design removes.
 *
 * Sibling of `/pending-updates`, which answers a different question — "a
 * provider proposes these field values for this flight". One inbox on screen,
 * two tables underneath.
 */

import { z } from "zod";

import {
  dataQualityFlagSchema,
  listDataQualityFlagsQuerySchema,
} from "../../../schemas/dataQualityFlag";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Data quality"];
const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();

const dataQualityFlag = registry.register(
  "DataQualityFlag",
  dataQualityFlagSchema.openapi("DataQualityFlag")
);

const runSummary = registry.register(
  "DataQualityRunSummary",
  z
    .object({
      opened: z.number().int(),
      reopened: z
        .number()
        .int()
        .describe(
          "Flags that had been resolved and whose contradiction is still there. " +
            "Resolving means 'I corrected the data'; if it was not corrected, the " +
            "question comes back."
        ),
      updated: z.number().int().describe("Open flags whose details moved."),
      autoResolved: z
        .number()
        .int()
        .describe(
          "Open flags whose disagreement is gone — including ones whose record " + "was deleted."
        ),
      open: z.number().int().describe("Open flags after the run. What the inbox shows."),
    })
    .openapi("DataQualityRunSummary")
);

registry.registerPath({
  method: "get",
  path: "/data-quality-flags",
  summary: "The data-quality inbox",
  description:
    "Records whose own sources disagree, raised as questions. Each flag carries " +
    "both values and the record it is about, so the answer can be checked rather " +
    "than trusted. A flag never changes a figure. Defaults to `open`; a flag " +
    "whose record has since been deleted is not returned.",
  tags,
  request: { query: listDataQualityFlagsQuerySchema },
  responses: {
    200: {
      description: "Flags",
      content: {
        "application/json": {
          schema: z.object({
            flags: z.array(dataQualityFlag),
            count: z.number().int(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/run",
  summary: "Re-run the checks for this account",
  description:
    "Reconciles the inbox with the data rather than inserting what it found, so " +
    "calling it repeatedly is safe: an unchanged account writes nothing. A " +
    "`dismissed` flag is never re-opened; a `resolved` one is, if the " +
    "contradiction is still there.",
  tags,
  responses: {
    200: {
      description: "What the run changed",
      content: { "application/json": { schema: runSummary } },
    },
    403: { description: "Read-scoped token", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/{id}/resolve",
  summary: "Answer a flag: the data has been corrected",
  description:
    "Does not edit the record — correct it through its own endpoint first. A " +
    "later run re-opens the flag if the contradiction is still there.",
  tags,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: {
      description: "Resolved",
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
    },
    403: { description: "Read-scoped token", content: errorContent },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/{id}/dismiss",
  summary: "Answer a flag: this is not wrong",
  description:
    "Permanent — no later run re-opens it. The escape hatch for a check that is " +
    "right that two sources disagree and wrong about which to believe.",
  tags,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: {
      description: "Dismissed",
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
    },
    403: { description: "Read-scoped token", content: errorContent },
    404: notFound,
  },
});
