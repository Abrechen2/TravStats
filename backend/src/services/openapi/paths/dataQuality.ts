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
import {
  answerGuardBodySchema,
  INVALID_ACTION_REASONS,
  resolveFindingBodySchema,
} from "../../../schemas/dataQualityFindings";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Data quality"];
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

const answered = z.object({
  success: z.literal(true),
  data: dataQualityFlag
    .nullable()
    .describe("The finding as it now stands; null once its record no longer exists."),
});

/** The contract's stable codes (spec 2026-10-25 C3), in `error`. */
const findingError = (codes: readonly string[]) => ({
  "application/json": {
    schema: z.object({
      error: z.enum(codes as [string, ...string[]]),
      reason: z.enum(INVALID_ACTION_REASONS).optional(),
    }),
  },
});

/** A malformed id or body: the error handler's generic validation answer. */
const validationError = z.object({ error: z.string(), code: z.literal("VALIDATION_FAILED") });

const answerResponses = (description: string) => ({
  200: { description, content: { "application/json": { schema: answered } } },
  400: {
    description: "`VALIDATION_FAILED` — a malformed id or body",
    content: { "application/json": { schema: validationError } },
  },
  403: { description: "Read-scoped token", content: errorContent },
  404: { description: "`notFound`", content: findingError(["notFound"]) },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/{id}/resolve",
  summary: "Answer a finding",
  description:
    "Without a body: the data has been corrected. This does not edit the record — " +
    "correct it through its own endpoint first; a later run re-opens the flag if " +
    "the contradiction is still there. With `{ action }`: one of the flag's " +
    "`actions` — for `duplicate_candidate`, `keep` (these are separate entries; " +
    "answers every flag over the same copies, status `dismissed`, never asked " +
    "again) or `merge` (flights and stays only: keeps `keptId` — the body's, else " +
    "`evidence.keptId` — moves documents, companions, recording, share links, " +
    "roadtrip stations and the trip/booking link onto it, and deletes the other " +
    "copies through their own delete path; no server undo). Applying the change " +
    "and answering the flag happen in one transaction. A merge locks the copies " +
    "and re-checks them there; it is refused with `conflictingRecordings` when " +
    "more than one copy carries a recording and `conflictingLinks` when copies " +
    "name different trips, bookings or cards. `link` re-checks the ferry rule " +
    "on locked rows. Send `revision` (as served) to be refused with " +
    "`staleFinding` if the finding moved since. Sets `undoUntil` (10 minutes) " +
    "except after a merge.",
  tags,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: resolveFindingBodySchema } } },
  },
  responses: {
    ...answerResponses("Answered"),
    400: {
      description:
        "`invalidAction` — unknown, not offered, `keptId` outside the finding, " +
        "or a merge that would lose a recording or a link. A malformed id or " +
        "body is the generic `VALIDATION_FAILED` error instead.",
      content: {
        "application/json": {
          schema: z.union([
            findingError(["invalidAction"])["application/json"].schema,
            validationError,
          ]),
        },
      },
    },
    409: {
      description: "`staleFinding` — the flag is not open, or the copies no longer match",
      content: findingError(["staleFinding"]),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/{id}/dismiss",
  summary: "Answer a finding: this is not wrong",
  description:
    "No later run re-opens it. The escape hatch for a check that is right that " +
    "two sources disagree and wrong about which to believe. Sets `undoUntil`. " +
    "With `revision`, refused as `staleFinding` unless the flag is still at it.",
  tags,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: answerGuardBodySchema } } },
  },
  responses: {
    ...answerResponses("Dismissed"),
    409: { description: "`staleFinding`", content: findingError(["staleFinding"]) },
  },
});

registry.registerPath({
  method: "post",
  path: "/data-quality-flags/{id}/undo",
  summary: "Take the last answer back",
  description:
    "While `now < undoUntil` (10 minutes after the answer): restores the status " +
    "the flag had before — usually `open` — and reverts what the answer changed " +
    "(the other flags a `keep` answered, unless answered since; the ride a " +
    "`link` moved, unless moved since). A `merge` cannot be undone here.",
  tags,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: answerGuardBodySchema } } },
  },
  responses: {
    ...answerResponses("Taken back"),
    409: {
      description:
        "`undoExpired` — the window passed or the answer has no undo; " +
        "`staleFinding` — the flag is open again or changed meanwhile",
      content: findingError(["undoExpired", "staleFinding"]),
    },
  },
});
