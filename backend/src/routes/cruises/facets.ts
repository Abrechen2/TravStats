import type { NextFunction, Response } from "express";

import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { cruiseQuerySchema } from "../../schemas/cruise";
import { cruiseStartPeriod } from "../../shared/cruiseListOrder";
import { applyCruisePeriod, buildCruiseWhere } from "./queryFilters";

/**
 * `GET /cruises/facets` — the option lists and the headline figures the
 * cruise logbook draws around its table.
 *
 * Same reason the flights one exists: those two things, not the table, are
 * what kept the page holding every sailing it owns. The year and line
 * dropdowns were built from the COMPLETE row set and so was the
 * "N Kreuzfahrten · N Hafenanläufe · N Seetage · N Reedereien" strip, so
 * paging the rows underneath would have changed nothing.
 *
 * Standard faceting: each option list is counted under every OTHER filter but
 * not its own. Picking AIDA must not reduce the line list to AIDA — there
 * would be no way back out — while it should narrow the year list to the
 * years you sailed with them. The summary is the opposite case and applies
 * ALL filters, because it describes the table as the reader sees it; that is
 * the promise `ListSummaryStrip` makes in its own name.
 */

export interface CruiseFacetOption<T extends string | number> {
  value: T;
  count: number;
}

export interface CruiseFacets {
  /** Sailing years present under the current filters, newest first. */
  years: CruiseFacetOption<number>[];
  /** Lines, most sailings first then alphabetically. */
  lines: CruiseFacetOption<string>[];
  summary: {
    cruises: number;
    /** Port CALLS — how many times the ship tied up, sea days excluded. */
    portCalls: number;
    seaDays: number;
    /** Distinct lines, by the same rule the option list uses. */
    lines: number;
  };
}

/**
 * Cruises reduced to what the facets count.
 *
 * `line` is resolved HERE, once, by the rule the row cell draws — the
 * cruise's own `cruiseLine`, else its ship's. Counting the column alone would
 * produce a dropdown that omits every sailing whose line is only known
 * through its ship, and a "Reedereien" figure that disagrees with it.
 */
interface CruiseFacetRow {
  startDate: Date | null;
  line: string;
  portCalls: number;
  seaDays: number;
}

async function loadFacetRows(where: Prisma.CruiseWhereInput): Promise<CruiseFacetRow[]> {
  const rows = await prisma.cruise.findMany({
    where,
    select: {
      startDate: true,
      cruiseLine: true,
      ship: { select: { cruiseLine: true } },
      stops: { select: { isAtSea: true } },
    },
  });
  return rows.map((row) => ({
    startDate: row.startDate,
    line: (row.cruiseLine ?? row.ship?.cruiseLine ?? "").trim(),
    // `countPortCalls` / `countUniquePorts` are two different questions and
    // the strip asks the first: a round trip that leaves and returns to Kiel
    // called twice. A stop the importer could not resolve IS a call — the
    // ship tied up somewhere — which is why this counts stops rather than
    // distinct ports.
    portCalls: row.stops.filter((stop) => !stop.isAtSea).length,
    seaDays: row.stops.filter((stop) => stop.isAtSea).length,
  }));
}

const countBy = <T>(rows: readonly T[], key: (row: T) => string | null): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

export const cruiseFacetsHandler = async (
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
    const period = { year: query.year, month: query.month };

    const rowsFor = async (
      overrides: Partial<typeof query>,
      withPeriod: { year?: number; month?: number }
    ): Promise<CruiseFacetRow[]> => {
      const { where, noResults } = buildCruiseWhere({ ...query, ...overrides }, userId);
      if (noResults) return [];
      return applyCruisePeriod(await loadFacetRows(where), withPeriod);
    };

    const [all, withoutYear, withoutLine] = await Promise.all([
      rowsFor({}, period),
      // The year facet drops the YEAR but keeps the month: picking March
      // should narrow the year list to the years that have one.
      rowsFor({}, { month: query.month }),
      rowsFor({ cruiseLine: undefined, shipLine: undefined }, period),
    ]);

    const years = [
      ...countBy(withoutYear, (row) => {
        const started = cruiseStartPeriod(row.startDate);
        // An undated sailing is in no year, so it is in no bucket either.
        return started ? String(started.year) : null;
      }).entries(),
    ]
      .map(([value, count]) => ({ value: Number(value), count }))
      .sort((a, b) => b.value - a.value);

    const lines = [...countBy(withoutLine, (row) => (row.line === "" ? null : row.line)).entries()]
      .map(([value, count]) => ({ value, count }))
      // Frequency, then alphabetical — a total order, so two equally common
      // lines do not swap places between two loads of the same page.
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    const facets: CruiseFacets = {
      years,
      lines,
      summary: {
        cruises: all.length,
        portCalls: all.reduce((sum, row) => sum + row.portCalls, 0),
        seaDays: all.reduce((sum, row) => sum + row.seaDays, 0),
        lines: new Set(all.filter((row) => row.line !== "").map((row) => row.line)).size,
      },
    };
    res.json({ success: true, data: facets });
  } catch (err) {
    next(err);
  }
};
