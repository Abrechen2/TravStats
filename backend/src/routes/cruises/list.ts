import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { cruiseQuerySchema } from "../../schemas/cruise";
import { CRUISE_INCLUDE } from "./include";
import {
  applyCruisePeriod,
  buildCruiseWhere,
  loadCruiseOrderRows,
  selectCruisePage,
} from "./queryFilters";

/**
 * `GET /cruises` — one page of the cruise logbook.
 *
 * It was not a page before. The handler took `limit`/`offset` but the browser
 * called it with neither, so it answered the server default of 500 rows with
 * no `meta` at all: from 501 cruises on, the list simply stopped and said
 * nothing — no count to contradict it, no further page to walk to. `meta` is
 * always present now, and `meta.total` is the size of the FILTERED set, which
 * is the number a pager and a "N treffen zu" both need.
 *
 * Two reads, and the asymmetry is the point. The narrow one covers every
 * cruise that matches the filters and carries only what ordering and the
 * calendar filter need; the wide one — stops, ports, legs, ship, trip — is
 * paid for the page alone. It used to be paid for every cruise in the
 * account, because the browser did the sorting.
 *
 * Sort THEN slice. Four of the six sort keys are not columns
 * (`shared/cruiseListOrder.ts` names them), so ordering cannot be pushed into
 * Prisma; `routes/lodging.ts` met the same wall and wrote down the failure
 * mode — "a 'sort the already-fetched page' bug silently reorders a truncated
 * slice instead of the true global order".
 */
export const cruiseListHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Not authenticated", 401);

    const parsed = cruiseQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? 500;
    const offset = query.offset ?? 0;

    const { where, noResults } = buildCruiseWhere(query, userId);
    if (noResults) {
      res.json({ success: true, data: [], meta: { total: 0, limit, offset } });
      return;
    }

    const rows = applyCruisePeriod(await loadCruiseOrderRows(where), {
      year: query.year,
      month: query.month,
    });
    const pageIds = selectCruisePage(rows, query.sort, query.order, limit, offset);
    if (pageIds.length === 0) {
      res.json({ success: true, data: [], meta: { total: rows.length, limit, offset } });
      return;
    }

    const cruises = await prisma.cruise.findMany({
      where: { id: { in: pageIds } },
      include: CRUISE_INCLUDE,
    });
    // `findMany` answers in ITS order, not in the order of the id list, so the
    // page is re-laid against the order that produced it. Trusting the query
    // would quietly re-sort each page by whatever the planner chose.
    const byId = new Map(cruises.map((cruise) => [cruise.id, cruise]));
    const data = pageIds.flatMap((id) => {
      const cruise = byId.get(id);
      return cruise ? [cruise] : [];
    });

    res.json({ success: true, data, meta: { total: rows.length, limit, offset } });
  } catch (err) {
    next(err);
  }
};
