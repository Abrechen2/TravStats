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
    "One entry per domain the user has enabled — next flight, cruise, stay — " +
    "plus the next trip, sorted by start. Domains the user has switched off are " +
    "absent rather than empty. An account with no settings row is treated as " +
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
                  domain: z.enum(["flight", "cruise", "lodging", "place", "trip"]),
                  id: z.string(),
                  detailId: z
                    .string()
                    .describe(
                      "The row a client should open. Equal to `id` except for a stay, " +
                        "whose page is its lodging's."
                    ),
                  startsAt: z.string().datetime(),
                  tripId: z.string().uuid().nullable(),
                  tripName: z.string().nullable(),
                  primary: z
                    .string()
                    .describe("Headline, e.g. 'MUC → VIE', a ship or a hotel name"),
                  secondary: z
                    .string()
                    .nullable()
                    .describe("Qualifier: flight number, cruise line, city"),
                })
              ),
            }),
          }),
        },
      },
    },
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
      key: z.string().min(1),
    }),
    query: z.object({
      period: z.enum(["allTime", "year", "rolling12m"]).optional(),
      year: z.coerce.number().int().optional().describe("Required when period=year"),
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
