import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";

/**
 * `GET /lodging/entry-suggestions` — what the lodging and stay forms can offer
 * from the user's own lodgings: the amenities they have written down before,
 * for the house and for the room.
 *
 * Mounted inside the lodging router BEFORE `/:id`, which would otherwise read
 * "entry-suggestions" as a lodging id. Shares the stats bucket, like the
 * flight forms' counterpart: aggregations over the whole logbook, asked once
 * per opened form rather than per keystroke.
 */
const router = Router();

const AMENITY_CAP = 30;

export const lodgingEntrySuggestionsQuerySchema = z.object({});

export interface RankedValue {
  name: string;
  usageCount: number;
}

export interface LodgingEntrySuggestions {
  amenities: RankedValue[];
  roomAmenities: RankedValue[];
}

/** The two text[] columns this reads; a whitelist, because a column name cannot be a parameter. */
const ARRAY_COLUMNS = {
  amenities: Prisma.sql`SELECT btrim(v) AS v FROM lodgings, unnest(amenities) AS v WHERE user_id = `,
  roomAmenities: Prisma.sql`SELECT btrim(v) AS v FROM lodging_stays, unnest(room_amenities) AS v WHERE user_id = `,
} as const;

/**
 * Distinct entries of one of the user's text[] columns, most used first.
 * "WLAN" and "wlan" are one amenity, shown in the spelling used most — the
 * tag vocabulary's rule (`routes/tags.ts`).
 */
async function rankedArrayValues(
  column: keyof typeof ARRAY_COLUMNS,
  userId: string
): Promise<RankedValue[]> {
  return prisma.$queryRaw<RankedValue[]>`
    WITH used AS (${ARRAY_COLUMNS[column]}${userId}),
    spellings AS (
      SELECT lower(v) AS key, v, count(*)::int AS n
      FROM used
      WHERE v <> ''
      GROUP BY lower(v), v
    )
    SELECT (array_agg(v ORDER BY n DESC, v ASC))[1] AS name,
           sum(n)::int AS "usageCount"
    FROM spellings
    GROUP BY key
    ORDER BY "usageCount" DESC, key ASC
    LIMIT ${AMENITY_CAP}
  `;
}

router.get(
  "/entry-suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = lodgingEntrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const userId = req.userId!;

      const [amenities, roomAmenities] = await Promise.all([
        rankedArrayValues("amenities", userId),
        rankedArrayValues("roomAmenities", userId),
      ]);

      const data: LodgingEntrySuggestions = { amenities, roomAmenities };
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
