/**
 * What location history asks the user (TravTrack plan E6/E7): journey
 * questions from TravTrack. Enveloped, like `/dawarich-stays`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Location suggestions"];

const position = z.object({ lat: z.number(), lon: z.number() });

const journeyRun = z.object({
  index: z.number().int(),
  fromMs: z.number().int().describe("First visible fix"),
  untilMs: z.number().int().describe("Last visible fix"),
  km: z.number().describe("Along the privacy-cut line"),
  start: position,
  end: position,
  startRecorded: z.boolean().describe("False: the run began out of silence or behind a zone"),
  endRecorded: z.boolean().describe("False: „Ende nicht aufgezeichnet“"),
  startZone: z.string(),
  endZone: z.string(),
  modeHint: z.enum(["rail", "road", "unknown"]).describe("From the speed profile only"),
  state: z.enum(["open", "linked", "closed", "invalidated"]),
  link: z
    .object({ entryKind: z.enum(["rail", "bus", "roadtrip"]), entryId: z.string() })
    .nullable(),
});

const suggestion = z
  .object({
    id: z.string(),
    kind: z.enum(["stay", "market", "venue", "country", "journey"]),
    provider: z.object({ kind: z.enum(["travtrack", "dawarich"]), rev: z.number().int() }),
    window: z
      .object({ fromMs: z.number().int(), untilMs: z.number().int() })
      .describe("`[fromMs, untilMs)`"),
    algorithm: z.object({
      name: z.enum(["stay", "market", "country", "journey"]),
      version: z.number().int(),
    }),
    explanation: z
      .object({ code: z.string(), params: z.record(z.string(), z.union([z.number(), z.string()])) })
      .describe(
        "A stable code and scalar params, never prose and never a coordinate. `journey.unlogged`: `{ runs, km }`"
      ),
    status: z.enum(["pending", "accepted", "rejected", "invalidated", "covered", "superseded"]),
    coverage: z.enum(["complete", "truncated", "unreachable"]).nullable(),
    journey: z
      .object({ day: z.string(), zone: z.string(), runs: z.array(journeyRun) })
      .optional()
      .describe("A journey question's runs, for the owner's inbox only"),
  })
  .describe("The evidence key, the point digests and the stored line never leave the server");

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
    "Journey questions: movement TravTrack saw on a finished local day that no ride, crossing, cruise, rental or roadtrip in the logbook holds — one question per day, its runs inside. Only for accounts whose location provider is TravTrack. Up to 200 rows, oldest first. An accept in progress lists as `pending`.",
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
  summary: "Link one run of a journey question to the entry made for it",
  description:
    "The entry (a rail ride, a bus ride or a roadtrip) is made by the user through its form; this links it. It must be the user's and hold at least half the run (else 400 `VALIDATION_FAILED` — the entry stays, the run stays open). The run is re-checked against the history as it is now and published under the account's TravTrack lock. The same entry again answers the same; another entry on a linked run is 409 `SUGGESTION_ALREADY_RESOLVED`. The question is accepted once every run is answered. 409 `SUGGESTION_ACCEPT_IN_PROGRESS` (retry), `EVIDENCE_INVALIDATED` (the run's history no longer holds it; recorded before the answer), `HISTORY_CHANGED` (the history kept changing — retry), `EVIDENCE_UNVERIFIABLE` (cannot be checked now), `TRAVTRACK_UNAVAILABLE` (TravTrack is no longer the account's source). 403 `TRAVTRACK_DISABLED` while TravTrack is off — the question stays.",
  request: {
    params: idParams,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              runIndex: z.number().int().min(0),
              entryKind: z.enum(["rail", "bus", "roadtrip"]),
              entryId: z.string(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: ok(suggestion),
    400: failure("Invalid body, run or entry"),
    403: failure("TravTrack is switched off"),
    404: failure("Not this account's question"),
    409: failure("Being accepted, answered already, or its evidence changed"),
  },
});

registry.registerPath({
  method: "post",
  path: "/location-suggestions/{id}/reject",
  tags,
  summary: "Close one run, or every open run, of a journey question",
  description:
    "Says the run needs no entry; writes nothing but the answer and works with TravTrack off. Without `runIndex` every open run is closed. Every run closed rejects the question (never asked again); a linked run among them accepts it. Repeating it is fine; closing a linked run is 409 `SUGGESTION_ALREADY_RESOLVED`.",
  request: {
    params: idParams,
    body: {
      content: {
        "application/json": {
          schema: z.object({ runIndex: z.number().int().min(0).optional() }).strict(),
        },
      },
    },
  },
  responses: {
    200: ok(suggestion),
    400: failure("Invalid run"),
    404: failure("Not this account's question"),
    409: failure("Being accepted, or answered otherwise"),
  },
});
