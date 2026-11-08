import { z } from "./zod";

/**
 * What each side of a user connection gives (spec 2026-11-02 §2): directional switches. Lives
 * apart from `tripSharePeer` so the comparison side can name the shape without importing the
 * trip-share protocol (`separation.test.ts`).
 */
export const STATS_LEVELS = ["off", "overview", "full"] as const;
export type StatsLevel = (typeof STATS_LEVELS)[number];

export const connectionSwitchesSchema = z.strictObject({
  plans: z.boolean(),
  stats: z.enum(STATS_LEVELS),
  achievements: z.boolean(),
  leaderboard: z.boolean(),
  tripOffers: z.boolean(),
});
export type ConnectionSwitches = z.infer<typeof connectionSwitchesSchema>;
