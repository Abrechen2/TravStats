import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { tagSuggestLimiter } from "../middleware/rateLimit";

/**
 * `GET /tags` — the tags the caller has already used, for the tag input of
 * every form that carries tags (flights incl. special flights, trips,
 * cruises, rail rides; lodging and places have no tags column). Tags are plain `text[]`
 * columns, not a table, so the vocabulary only exists as an aggregation.
 */
const router = Router();
router.use(authenticate);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const tagQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export interface TagSuggestion {
  name: string;
  usageCount: number;
}

router.get(
  "/",
  tagSuggestLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = tagQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const userId = req.userId!;
      const q = parsed.data.q ? parsed.data.q.toLowerCase() : null;
      const { limit } = parsed.data;

      // "Beach" and "beach" are one tag: counted together, shown in the
      // spelling used most (then the alphabetically first). `strpos` rather
      // than LIKE so a typed "%" or "_" is a character, not a wildcard.
      const rows = await prisma.$queryRaw<Array<{ name: string; usageCount: number }>>`
        WITH used AS (
          SELECT btrim(t) AS tag FROM flights, unnest(tags) AS t WHERE user_id = ${userId}
          UNION ALL
          SELECT btrim(t) FROM trips, unnest(tags) AS t WHERE user_id = ${userId}
          UNION ALL
          SELECT btrim(t) FROM cruises, unnest(tags) AS t WHERE user_id = ${userId}
          UNION ALL
          SELECT btrim(t) FROM rail_journeys, unnest(tags) AS t WHERE user_id = ${userId}
        ),
        spellings AS (
          SELECT lower(tag) AS key, tag, count(*)::int AS n
          FROM used
          WHERE tag <> ''
          GROUP BY lower(tag), tag
        )
        SELECT (array_agg(tag ORDER BY n DESC, tag ASC))[1] AS name,
               sum(n)::int AS "usageCount"
        FROM spellings
        WHERE ${q}::text IS NULL OR strpos(key, ${q}::text) > 0
        GROUP BY key
        ORDER BY "usageCount" DESC, key ASC
        LIMIT ${limit}
      `;

      const tags: TagSuggestion[] = rows.map((r) => ({
        name: r.name,
        usageCount: r.usageCount,
      }));
      res.json({ tags });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
