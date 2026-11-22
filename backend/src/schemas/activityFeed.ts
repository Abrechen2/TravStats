import { z } from "./zod";
import { FEED_DOMAINS, type FeedDomain } from "../services/activityFeed/types";
import { FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT } from "../services/activityFeed/feed";

/** `GET /activity/feed` query. An unknown domain is a 400, not a silent no-op. */
export const activityFeedQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
  domains: z
    .string()
    .optional()
    .transform((v, ctx): FeedDomain[] | undefined => {
      if (v === undefined || v.trim() === "") return undefined;
      const names = v.split(",").map((s) => s.trim());
      const bad = names.find((n) => !(FEED_DOMAINS as readonly string[]).includes(n));
      if (bad !== undefined) {
        ctx.addIssue({ code: "custom", message: `unknown domain "${bad}"` });
        return z.NEVER;
      }
      return names as FeedDomain[];
    }),
});
