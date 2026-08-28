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

const achievement = registry.register(
  "Achievement",
  z
    .object({
      id: z.string(),
      category: z.string(),
      points: z.number().int(),
      unlocked: z.boolean(),
      unlockedAt: z.string().datetime().nullable(),
      progress: z.number().describe("0–1 completion toward unlocking"),
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
              categories: z.record(z.number().int()),
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
  description: "Ranks the users of this instance by points. Small, self-hosted instances may return a single row.",
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
                  startsAt: z.string().datetime(),
                  tripId: z.string().uuid().nullable(),
                  tripName: z.string().nullable(),
                  primary: z.string().describe("Headline, e.g. 'MUC → VIE', a ship or a hotel name"),
                  secondary: z.string().nullable().describe("Qualifier: flight number, cruise line, city"),
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
