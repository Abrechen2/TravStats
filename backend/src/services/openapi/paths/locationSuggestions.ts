/**
 * What location history asks the user (TravTrack plan E6): country questions
 * from TravTrack. Enveloped, like `/dawarich-stays`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Location suggestions"];

const suggestion = z
  .object({
    id: z.string(),
    kind: z.enum(["stay", "market", "venue", "country", "journey"]),
    provider: z.object({ kind: z.enum(["travtrack", "dawarich"]), rev: z.number().int() }),
    window: z
      .object({ fromMs: z.number().int(), untilMs: z.number().int() })
      .describe("`[fromMs, untilMs)`; a country question covers whole UTC days"),
    algorithm: z.object({
      name: z.enum(["stay", "market", "country", "journey"]),
      version: z.number().int(),
    }),
    explanation: z
      .object({ code: z.string(), params: z.record(z.string(), z.union([z.number(), z.string()])) })
      .describe(
        "A stable code and scalar params, never prose and never a coordinate. `country.groundDays`: `{ country, days, points }`"
      ),
    status: z.enum(["pending", "accepted", "rejected", "invalidated", "covered", "superseded"]),
    coverage: z.enum(["complete", "truncated", "unreachable"]).nullable(),
  })
  .describe("The evidence key, the evidence and any point digest never leave the server");

const ok = (schema: z.ZodTypeAny) => ({
  description: "Account-scoped result",
  content: { "application/json": { schema: z.object({ success: z.literal(true), data: schema }) } },
});
const failure = (description: string) => ({ description, content: errorContent });

registry.registerPath({
  method: "get",
  path: "/location-suggestions",
  tags,
  summary: "Own location-history questions",
  description:
    "Country questions: a country TravTrack saw on at least two ground days in a row that the passport does not hold and the user gave no verdict on. Only for accounts whose location provider is TravTrack. Up to 200 rows, oldest first. An accept in progress lists as `pending`.",
  request: {
    query: z.object({
      status: z.enum(["pending", "accepted", "rejected", "invalidated"]).optional(),
    }),
  },
  responses: { 200: ok(z.array(suggestion)), 400: failure("Unknown status") },
});

const idParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: "post",
  path: "/location-suggestions/{id}/accept",
  tags,
  summary: "Answer a country question: visited, or only on the ground",
  description:
    "Writes the user's country override (`visited` or `ground`, dated at the run's first day) after re-checking that TravTrack still names the country on two ground days. Idempotent: a repeat answers the first decision. An override the user set meanwhile is kept and named. 409 `SUGGESTION_ACCEPT_IN_PROGRESS` (retry), `SUGGESTION_ALREADY_RESOLVED`, `EVIDENCE_INVALIDATED` (the history went; the question is invalidated before the answer), `HISTORY_CHANGED` (the history kept changing while it was checked — the question stays open; retry) or `TRAVTRACK_UNAVAILABLE` (TravTrack is no longer the account's location source — the question stays). 403 `TRAVTRACK_DISABLED` while TravTrack is off — the question stays. 404 `SUGGESTION_NOT_FOUND`: no such question — or it went with the location history it came from.",
  request: {
    params: idParams,
    body: {
      content: {
        "application/json": {
          schema: z.object({ verdict: z.enum(["visited", "ground"]) }).strict(),
        },
      },
    },
  },
  responses: {
    200: ok(suggestion),
    400: failure("Invalid verdict or id"),
    403: failure("TravTrack is switched off"),
    404: failure("Not this account's question"),
    409: failure("Being accepted, answered already, or its evidence is gone"),
  },
});

registry.registerPath({
  method: "post",
  path: "/location-suggestions/{id}/reject",
  tags,
  summary: "Answer a country question: not there",
  description:
    "Writes nothing but the answer; the run is never asked again. Works with TravTrack off. Repeating it is fine; an accepted question answers 409 `SUGGESTION_ALREADY_RESOLVED`.",
  request: { params: idParams },
  responses: {
    200: ok(suggestion),
    404: failure("Not this account's question"),
    409: failure("Being accepted, or accepted already"),
  },
});
