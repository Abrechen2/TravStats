/**
 * One page of a transport logbook (rail, bus, ferry, rental), the part the
 * four list routes spelled out four times (forgejo#382): the page, the total
 * and the whole-list summary are read together, and the answer is the same
 * `{ success, data, meta: { total, limit, offset, summary } }` envelope.
 *
 * The per-domain parts stay with the domain: its `where`, its ordering, its
 * row mapper and how its summary is built. Only the skeleton is shared.
 */
import { railListSummaryFromGroups } from "../../shared/listSummary";

/**
 * The summary of a station-based logbook (rail, bus, ferry): built from a
 * SQL `groupBy` over (operator, stations), so the work is the distinct
 * combinations rather than every row.
 */
export interface StationGroup {
  operator: string | null;
  depStationName: string;
  arrStationName: string;
  _count: { _all: number };
}

export const STATION_GROUP_BY = ["operator", "depStationName", "arrStationName"] as const;
export const STATION_GROUP_ORDER = [
  { operator: "asc" },
  { depStationName: "asc" },
  { arrStationName: "asc" },
] as const;

export function summariseStationGroups(groups: readonly StationGroup[]) {
  return railListSummaryFromGroups(
    groups.map(({ _count, ...names }) => ({ ...names, count: _count._all }))
  );
}

export interface LogbookPageReads<Row, Summarised> {
  count: () => Promise<number>;
  /** The page itself: `take`/`skip` and the total ordering belong in this query. */
  page: () => Promise<Row[]>;
  /** What the summary is computed from — the WHOLE filtered list, not the page. */
  summarised: () => Promise<Summarised>;
}

export interface LogbookPageShape<Row, Out, Summarised, Summary> {
  limit: number;
  offset: number;
  mapRow: (row: Row) => Out;
  summarise: (source: Summarised) => Summary;
}

export interface LogbookPageBody<Out, Summary> {
  success: true;
  data: Out[];
  meta: { total: number; limit: number; offset: number; summary: Summary };
}

export async function readLogbookPage<Row, Out, Summarised, Summary>(
  reads: LogbookPageReads<Row, Summarised>,
  shape: LogbookPageShape<Row, Out, Summarised, Summary>
): Promise<LogbookPageBody<Out, Summary>> {
  const [total, rows, summarised] = await Promise.all([
    reads.count(),
    reads.page(),
    reads.summarised(),
  ]);
  return {
    success: true,
    data: rows.map(shape.mapRow),
    meta: {
      total,
      limit: shape.limit,
      offset: shape.offset,
      summary: shape.summarise(summarised),
    },
  };
}
