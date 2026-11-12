/**
 * Cross-domain odds and ends: achievements, the "next up" strip, and the
 * currency list.
 *
 * They share no data model, only the property of belonging to no single
 * domain. Keeping them here rather than inventing a module each is what
 * keeps the per-domain files honest.
 */

import { z } from "zod";

import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import { errorContent } from "./shared";
import { evidenceResponseSchema } from "../../../schemas/evidence";
import { busTimesSchema } from "../../../schemas/times";
import { localDateValueSchema } from "../../../shared/time/wire";
import { EVIDENCE_PAGE_SIZE } from "../../../shared/evidence";

const achievement = registry.register(
  "Achievement",
  z
    .object({
      ...prismaColumns("Achievement"),
      isUnlocked: z
        .boolean()
        .describe(
          "Held right now: progress has reached the requirement. `unlockedAt` is the first " +
            "time it did and is never cleared."
        ),
      isRetired: z
        .boolean()
        .describe(
          "The definition was removed; listed only because this user earned it. " +
            "Its points count, but it is outside totalAchievements/unlockedAchievements."
        ),
      unlockedAt: z
        .string()
        .datetime()
        .nullable()
        .describe(
          "The first time the requirement was met, or null if it never was. Sent even when " +
            "`isUnlocked` is false — the badge is then one the user no longer holds, and this " +
            "is when they last did."
        ),
      progress: z
        .number()
        .describe(
          "Absolute progress in the requirement's own unit (flights, km, countries …), not a fraction"
        ),
      progressPercentage: z
        .number()
        .int()
        .describe("progress / requirement, as 0–100, capped at 100"),
    })
    .describe(
      "Identifiers and rank values are stable slugs, never display copy — " +
        "clients localise them. Do not show them to users verbatim."
    )
    .openapi("Achievement")
);

registry.registerPath({
  method: "get",
  path: "/achievements",
  summary: "List achievements with your progress",
  tags: ["Achievements"],
  responses: {
    200: {
      description: "Achievements and a summary",
      content: {
        "application/json": {
          schema: z.object({
            achievements: z.array(achievement),
            summary: z.object({
              totalAchievements: z.number().int(),
              unlockedAchievements: z.number().int(),
              totalPoints: z.number().int(),
              categories: z.record(z.string(), z.number().int()),
              rank: z.string().describe("Stable slug, not display copy"),
              nextRankPoints: z.number().int().nullable(),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/achievements/recent",
  summary: "Recently unlocked achievements",
  tags: ["Achievements"],
  responses: {
    200: {
      description: "Recent unlocks",
      content: { "application/json": { schema: z.object({ achievements: z.array(achievement) }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/achievements/check",
  summary: "Re-evaluate achievements now",
  description:
    "Recomputes unlock state against your current data and returns what changed. " +
    "The app calls this after an import; it is idempotent.",
  tags: ["Achievements"],
  responses: {
    200: {
      description: "Newly unlocked achievements, if any",
      content: {
        "application/json": {
          schema: z.object({ newlyUnlocked: z.array(achievement) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/achievements/leaderboard",
  summary: "Instance leaderboard",
  description:
    "Ranks the users of this instance by points. Small, self-hosted instances may return a single row.",
  tags: ["Achievements"],
  responses: {
    200: {
      description: "Leaderboard",
      content: {
        "application/json": {
          schema: z.object({
            leaderboard: z.array(
              z.object({
                username: z.string(),
                totalPoints: z.number().int(),
                unlockedAchievements: z.number().int(),
              })
            ),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/upcoming",
  summary: "The next item across every enabled domain",
  description:
    "One entry per domain the user has enabled — next flight, cruise, stay, train, bus, ferry, rental — " +
    "plus the next trip, sorted by start. Domains the user cannot see are absent " +
    "rather than empty: switched off by the user, OR hidden by the instance's beta " +
    "switch (roadtrip while `betaFeaturesEnabled` is false) — a client need not apply " +
    "that check itself. An account with no settings row is treated as " +
    "flights-only, matching the column default.",
  tags: ["Dashboard"],
  responses: {
    200: {
      description: "Upcoming entries",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              entries: z.array(
                z.object({
                  domain: z.enum([
                    "flight",
                    "cruise",
                    "lodging",
                    "place",
                    "rail",
                    "bus",
                    "ferry",
                    "rental",
                    "trip",
                  ]),
                  id: z.string(),
                  detailId: z
                    .string()
                    .describe(
                      "The row a client should open. Equal to `id` except for a stay, " +
                        "whose page is its lodging's."
                    ),
                  startsAt: z.string().datetime(),
                  startsAtPrecision: z
                    .enum(["minute", "day"])
                    .optional()
                    .describe(
                      "Rail, bus and ferry. `day` for a ride logged without a clock: `startsAt` is " +
                        "the start of that day at the station, not a departure time, and " +
                        "the entry stays upcoming until the day is over."
                    ),
                  times: busTimesSchema
                    .optional()
                    .describe(
                      "Rail, bus and ferry: departure and arrival on the station/terminal " +
                        "clocks (a ride with changes ends at its last train's arrival). " +
                        "Not yet carried by the other domains, whose `startsAt` is " +
                        "still a bare instant."
                    ),
                  tripId: z.string().uuid().nullable(),
                  tripName: z.string().nullable(),
                  primary: z
                    .string()
                    .describe(
                      "Headline, e.g. 'MUC → VIE', a ship or a hotel name. A rail ride " +
                        "with changes runs from the next train's departure station to the " +
                        "ride's LAST arrival station (forgejo#210)"
                    ),
                  secondary: z
                    .string()
                    .nullable()
                    .describe(
                      "Qualifier: flight number, cruise line, city; for rail the ride's " +
                        "trains, joined by ' · '"
                    ),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

const searchDomainEnum = z.enum([
  "flight",
  "cruise",
  "lodging",
  "poi",
  "rail",
  "bus",
  "ferry",
  "rental",
  "roadtrip",
  "tour",
  "trip",
]);

registry.registerPath({
  method: "get",
  path: "/search",
  summary: "Search every domain at once",
  description:
    "One query across flights (number, airline, airports, `MUC-VIE`), cruises (ship, line, ports), " +
    "stays (name, town, chain), places and place lists, rail/bus/ferry rides, rentals, roadtrips, " +
    "tours and trips. Only the caller's own entries, and only domains the account may see " +
    "(enabled, and not hidden by the instance's beta switch — tours share the roadtrip key); " +
    "`domains` can narrow that further but never widen it. Case-insensitive substring match. " +
    "Bounded: `limit` hits per domain (default 5, max 20), 60 in total, each domain newest " +
    "first with its id as tie-breaker, domains in the order of the enum. `more` names domains " +
    "holding further matches. `failed` names domains whose search errored: for those the answer " +
    "is incomplete, not empty. Needs server 2.8.0-rc.10 or newer.",
  tags: ["Dashboard"],
  request: {
    query: z.object({
      q: z.string().min(2).max(100).describe("Search text, at least 2 characters"),
      limit: z.coerce.number().int().min(1).max(20).optional().describe("Per domain; default 5"),
      domains: z
        .string()
        .optional()
        .describe("Comma list of domain names to search; unknown names are a 400"),
    }),
  },
  responses: {
    200: {
      description: "Hits grouped by domain order",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              query: z.string(),
              hits: z.array(
                z.object({
                  domain: searchDomainEnum,
                  kind: z.enum([
                    "flight",
                    "cruise",
                    "lodging",
                    "place",
                    "placeList",
                    "rail",
                    "bus",
                    "ferry",
                    "rental",
                    "roadtrip",
                    "tour",
                    "trip",
                  ]),
                  id: z.string(),
                  title: z.string(),
                  subtitle: z.string().nullable(),
                  date: localDateValueSchema
                    .nullable()
                    .describe(
                      "The local day the entry starts on, in its own place's zone; null for a place or list"
                    ),
                  path: z.string().describe("Web route that opens the entry"),
                })
              ),
              more: z.array(searchDomainEnum),
              failed: z.array(searchDomainEnum),
              capped: z.boolean().describe("The 60-hit total cap cut hits off"),
            }),
          }),
        },
      },
    },
    400: { description: "Query too short or malformed", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/currencies/recent",
  summary: "Currencies you have used recently",
  description: "Feeds the currency picker so the codes a user actually books in come first.",
  tags: ["Dashboard"],
  responses: {
    200: {
      description: "ISO 4217 codes, most recently used first",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ codes: z.array(z.string().length(3)) }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/currencies/display-rate",
  summary: "The rate from your base currency to your display currency",
  description:
    "Totals are summed in the base currency; the display currency (Einstellungen › Einheiten) " +
    "only changes how they are shown. `rate` multiplies a base amount; it is `1` when both are the " +
    "same and `null` when no rate could be found (the client then shows the base amount in its own " +
    "currency, never a guessed one). Rates come from the same FX chain as stay conversions.",
  tags: ["Dashboard"],
  responses: {
    200: {
      description: "Base, display currency and the rate",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              base: z.string().length(3),
              display: z.string().length(3),
              rate: z.number().nullable(),
              rateDate: z.string().nullable().describe("YYYY-MM-DD of the rate; null when none"),
              source: z.string().nullable(),
            }),
          }),
        },
      },
    },
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});

/**
 * "Which entries produced this number" — see
 * `docs/superpowers/specs/2026-09-18-evidence-panel-design.md`. Plumbing
 * only as of this endpoint's introduction: `metric`/`ranking` answer 404 for
 * every key until a resolver is wired (release 1, Task 5); `record`/
 * `achievement` answer 501 until release 2.
 */
const evidenceResponse = registry.register(
  "EvidenceResponse",
  evidenceResponseSchema.openapi("EvidenceResponse")
);

registry.registerPath({
  method: "get",
  path: "/evidence/{kind}/{key}",
  summary: "Which entries produced this number",
  description:
    "Four answers, not one collapsed into the others: an unknown key is 404 " +
    "(never an empty 200 — that would hide a frontend bug); a key the user " +
    "simply has no data for is 200 with `value: 0`; a measure that cannot be " +
    "derived at all is 200 with `value: null` plus `unattributed`, never 0; " +
    "another user's row is 404, never 403. `record` and `achievement` answer " +
    "501 — release 2, not missing.",
  tags: ["Achievements"],
  request: {
    params: z.object({
      kind: z.enum(["metric", "ranking", "record", "achievement"]),
      key: z
        .string()
        .min(1)
        .describe(
          "metric: a key of shared/evidenceMeasures.ts — e.g. the passport headline " +
            "`passportCountryCount`, `passportAirportCount`, `passportEntryCount`, " +
            "`passportContinentCount` (all-time only). ranking: `<dimension>:<value>` — " +
            "`airline:iata:LH`, `airport:FRA`, `aircraftType:A320`, `country:<catalogue " +
            "country name>` (the flight distribution tile), `passportCountry:<ISO alpha-2>` " +
            "(one passport country's entries, counted as /stats/countries/{code} counts them), " +
            "`departureMonth:1`–`12` and `departureWeekday:0`–`6` (0 = Sunday; the flight " +
            "tab's seasonal and weekday charts, on the departure airport's clock), " +
            "`seat:position:window`, `seat:zone:front`, `seat:class:<seat class>`, " +
            "`seat:number:<seat>` and `seat:row:numbered` (the seat section's figures), " +
            "`flightStatus:<status>` and `boardingGroup:<group>` (the breakdown's rows)."
        ),
    }),
    query: z.object({
      period: z
        .enum(["allTime", "year", "rolling12m", "range"])
        .optional()
        .describe(
          "`range` is the days `from`..`to`, both included, each record on its own " +
            "calendar — what a same-span year comparison counted. Only measures whose " +
            "registry scopes list `range` accept it (rail rides, km and countries; rentals " +
            "and rental days; bus rides and km); every other answers 400."
        ),
      year: z.coerce.number().int().optional().describe("Required when period=year"),
      from: z.string().optional().describe("`YYYY-MM-DD`; required when period=range"),
      to: z
        .string()
        .optional()
        .describe("`YYYY-MM-DD`, not before `from`; required when period=range"),
      domains: z.string().optional().describe("Comma-separated domains, e.g. `flight,cruise`"),
      offset: z.coerce.number().int().min(0).optional(),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(EVIDENCE_PAGE_SIZE)
        .optional()
        .describe(`Default and max ${EVIDENCE_PAGE_SIZE} — one page per request`),
    }),
  },
  responses: {
    200: {
      description: "The measure and its evidence entries",
      content: { "application/json": { schema: evidenceResponse } },
    },
    401: { description: "Missing or invalid token", content: errorContent },
    404: {
      description: "Unknown key, or the row belongs to another user",
      content: errorContent,
    },
    501: {
      description: "`record` / `achievement` — served in release 2, not this one",
      content: errorContent,
    },
  },
});

const versionInfo = registry.register(
  "VersionInfo",
  z
    .object({
      version: z.string().describe("Runtime version shown to users; pre-release suffix stripped"),
      buildVersion: z.string().describe("Raw version baked into the image, for diagnostics"),
      latestAvailable: z
        .string()
        .nullable()
        .describe("Latest stable GitHub release, or null when it could not be fetched"),
      updateAvailable: z.boolean(),
      releaseUrl: z.string().nullable(),
      releaseNotes: z.string().nullable(),
      publishedAt: z.string().nullable(),
      tzdata: z
        .string()
        .nullable()
        .describe(
          "IANA tzdata release the server converts times with (e.g. `2025b`). A client whose " +
            "own zone data differs still displays the server's `local`/`offset` as sent " +
            "(ADR 0002 D3). Null only on a runtime built without ICU."
        ),
    })
    .openapi("VersionInfo")
);

registry.registerPath({
  method: "get",
  path: "/version",
  summary: "Server version, update availability and tzdata release",
  description: "Public — no token needed, so a client can read it before login.",
  tags: ["System"],
  security: [],
  responses: {
    200: {
      description: "Version information",
      content: { "application/json": { schema: versionInfo } },
    },
  },
});
