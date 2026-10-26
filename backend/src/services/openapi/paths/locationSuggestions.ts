/**
 * What location history asks the user (TravTrack plan E6/E7/L4): country,
 * journey and trip questions from TravTrack. Enveloped, like `/dawarich-stays`.
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

const trip = z.object({
  fromDay: z.string().describe("First local day of the span, `YYYY-MM-DD`"),
  toDay: z.string().describe("Last local day of the span, included"),
  zone: z.string().nullable().describe("The zone the days are named in"),
  days: z.number().int(),
  countries: z.array(z.string()).describe("Countries of the away fixes, ISO alpha-2"),
  km: z
    .number()
    .nullable()
    .describe("Farthest from home, km; null once the history behind an answer was deleted"),
  tripId: z.string().nullable().describe("The trip a `trip.extend` question widens"),
  tripName: z.string().nullable(),
  aggregated: z
    .boolean()
    .describe('Beyond the per-run cap: shown inside one "Weitere N Zeiträume unterwegs" entry'),
});

const suggestion = z
  .object({
    id: z.string(),
    kind: z.enum(["stay", "market", "venue", "country", "journey", "trip"]),
    provider: z.object({ kind: z.enum(["travtrack", "dawarich"]), rev: z.number().int() }),
    window: z
      .object({ fromMs: z.number().int(), untilMs: z.number().int() })
      .describe("`[fromMs, untilMs)`; a country question covers whole UTC days"),
    algorithm: z.object({
      name: z.enum(["stay", "market", "country", "journey", "trip"]),
      version: z.number().int(),
    }),
    explanation: z
      .object({ code: z.string(), params: z.record(z.string(), z.union([z.number(), z.string()])) })
      .describe(
        "A stable code and scalar params, never prose and never a coordinate. `country.groundDays`: `{ country, days, points }`; `journey.unlogged`: `{ runs, km }`; `trip.away`: `{ days, km }`; `trip.extend`: `{ days, km, tripId }`"
      ),
    status: z.enum(["pending", "accepted", "rejected", "invalidated", "covered", "superseded"]),
    coverage: z.enum(["complete", "truncated", "unreachable"]).nullable(),
    journey: z
      .object({ day: z.string(), zone: z.string(), runs: z.array(journeyRun) })
      .optional()
      .describe("A journey question's runs, for the owner's inbox only"),
    trip: trip
      .optional()
      .describe("A trip question's span — days, countries, km; no position and no map"),
  })
  .describe(
    "The evidence key, the evidence, the point digests and a journey's stored line never leave the server"
  );

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
    "Country and journey questions, for accounts whose location provider is TravTrack. A country question: a country TravTrack saw on at least two ground days in a row that the passport does not hold and the user gave no verdict on. A journey question: movement TravTrack saw on a finished local day that no ride, crossing, cruise, rental or roadtrip in the logbook holds — one question per day, its runs inside. A trip question: a run of days TravTrack saw the user more than 50 km from their confirmed residence that no trip holds (`trip.away`), or that touches a trip (`trip.extend`) — at most three new per nightly run as cards, the rest `aggregated`. Up to 200 rows, oldest first. An accept in progress lists as `pending`.",
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
  summary: "Answer a country or trip question, or link one run of a journey question",
  description:
    "The body follows the question's kind. **Country** `{ verdict }`: writes the user's country override (`visited` or `ground`, dated at the run's first day) after re-checking that TravTrack still names the country on two ground days; a repeat answers the first decision; an override the user set meanwhile is kept and named. **Journey** `{ runIndex, entryKind, entryId }`: the entry (a rail ride, a bus ride or a roadtrip) is made by the user through its form; this links it. It must be the user's and hold at least half the run (else 400 `VALIDATION_FAILED` — the entry stays, the run stays open); the same entry again answers the same, another entry on a linked run is 409 `SUGGESTION_ALREADY_RESOLVED`; the question is accepted once every run is answered. **Trip** `{ action: \"create\", name }` makes a trip over the run's days; `{ action: \"extend\", tripId }` widens that trip of the user's to hold them — its dates and nothing else (another account's trip: 400 `VALIDATION_FAILED`); a repeat answers the trip made first. All are re-checked against the history as it is now and published under the account's TravTrack lock. 409 `SUGGESTION_ACCEPT_IN_PROGRESS` (retry), `SUGGESTION_ALREADY_RESOLVED`, `EVIDENCE_INVALIDATED` (the history went; recorded before the answer), `HISTORY_CHANGED` (the history kept changing while it was checked — the question stays open; retry), `EVIDENCE_UNVERIFIABLE` (cannot be checked now) or `TRAVTRACK_UNAVAILABLE` (TravTrack is no longer the account's location source — the question stays). 403 `TRAVTRACK_DISABLED` while TravTrack is off — the question stays. 404 `SUGGESTION_NOT_FOUND`: no such question — or it went with the location history it came from.",
  request: {
    params: idParams,
    body: {
      content: {
        "application/json": {
          schema: z.union([
            z.object({ verdict: z.enum(["visited", "ground"]) }).strict(),
            z
              .object({
                runIndex: z.number().int().min(0),
                entryKind: z.enum(["rail", "bus", "roadtrip"]),
                entryId: z.string(),
              })
              .strict(),
            z.object({ action: z.literal("create"), name: z.string().min(1).max(200) }).strict(),
            z.object({ action: z.literal("extend"), tripId: z.string() }).strict(),
          ]),
        },
      },
    },
  },
  responses: {
    200: ok(suggestion),
    400: failure("Invalid body for the question's kind, run or entry"),
    403: failure("TravTrack is switched off"),
    404: failure("Not this account's question"),
    409: failure("Being accepted, answered already, or its evidence changed"),
  },
});

registry.registerPath({
  method: "post",
  path: "/location-suggestions/{id}/reject",
  tags,
  summary:
    'Answer a country question "not there", a trip question "no trip", or close journey runs',
  description:
    "Writes nothing but the answer and works with TravTrack off. **Country** and **trip**: the run is never asked again; an accepted question answers 409 `SUGGESTION_ALREADY_RESOLVED`. **Journey** `{ runIndex? }`: the run needs no entry; without `runIndex` every open run is closed. Every run closed rejects the question (never asked again); a linked run among them accepts it; closing a linked run is 409 `SUGGESTION_ALREADY_RESOLVED`. Repeating either is fine.",
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
