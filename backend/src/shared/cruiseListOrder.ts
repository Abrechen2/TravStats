/**
 * How the cruise logbook is ordered — the one rule.
 *
 * It used to live in the browser (`frontend/src/components/Cruise/
 * sortCruises.ts`), which is why the page could not page: sorting over rows
 * it held meant holding all of them, and `cruiseApi.list()` asked for none of
 * the 500-row cap's pages, so from 501 cruises on the list simply stopped
 * without saying so. The rule moves here whole rather than being reinvented,
 * and the truth table it always had moves with it.
 *
 * MIRRORED to `frontend/src/shared/cruiseListOrder.ts`, which carries the key
 * names ONLY — the comparator has no second home, because after this change
 * nothing in the browser sorts cruises. Change the keys on both sides
 * together; a key the header offers and the server rejects is a 400 on a
 * click.
 *
 * Four of the six keys are not columns, which is the whole reason this is a
 * comparator and not a Prisma `orderBy`:
 *
 *   ship   `ship.name` falling back to `shipNameOverride` — a coalesce across
 *          a relation, and the override is what a parsed booking writes when
 *          the catalogue does not know the vessel.
 *   line   `cruiseLine` falling back to `ship.cruiseLine`, same shape.
 *   ports  counted from the stops, the departure port and the arrival port.
 *   status a lifecycle rank (scheduled -> in_progress -> flown), not the
 *          alphabetical order of the stored string.
 *
 * `routes/lodging.ts` met the same wall and answered it the same way:
 * sort-then-slice, never slice-then-sort, "a 'sort the already-fetched page'
 * bug silently reorders a truncated slice instead of the true global order".
 */

export const CRUISE_SORT_FIELDS = ["date", "ship", "line", "ports", "status", "price"] as const;
export type CruiseSortField = (typeof CRUISE_SORT_FIELDS)[number];

/**
 * Upcoming first when ascending; an unknown status sorts last rather than
 * first, because a status nobody has taught this table about is not "the most
 * imminent thing you have booked".
 */
const STATUS_RANK: Record<string, number> = {
  scheduled: 0,
  in_progress: 1,
  flown: 2,
  historical: 3,
  cancelled: 4,
};
const UNKNOWN_STATUS_RANK = 99;

/**
 * Exactly what ordering needs to know about a cruise — deliberately far less
 * than the list returns. The page fetches this for every cruise that matches
 * the filters and the full row only for the page, so the heavy read
 * (stops, ports, legs, ship, trip) is paid once per visible row instead of
 * once per cruise in the account.
 */
export interface CruiseOrderRow {
  id: string;
  startDate: Date | null;
  price: number | null;
  status: string;
  shipName: string | null;
  shipNameOverride: string | null;
  cruiseLine: string | null;
  shipCruiseLine: string | null;
  /** `countUniquePorts` — departure, arrival and every matched port call. */
  uniquePortCount: number;
}

/** The ship a row is FOR, by the rule the row cell draws. */
export const cruiseShipName = (row: CruiseOrderRow): string =>
  (row.shipName ?? row.shipNameOverride ?? "").trim();

/** The line a row belongs to, by the rule the row cell draws. */
export const cruiseLineName = (row: CruiseOrderRow): string =>
  (row.cruiseLine ?? row.shipCruiseLine ?? "").trim();

interface SortKey {
  /** Blank/absent values sort last in BOTH directions — see `compareCruises`. */
  absent: boolean;
  num?: number;
  str?: string;
}

function keyOf(row: CruiseOrderRow, sort: CruiseSortField): SortKey {
  switch (sort) {
    case "date": {
      const value = row.startDate ? row.startDate.getTime() : NaN;
      return { absent: Number.isNaN(value), num: value };
    }
    case "price":
      return { absent: row.price === null || row.price === undefined, num: row.price ?? NaN };
    case "ports":
      return { absent: false, num: row.uniquePortCount };
    case "status":
      return { absent: false, num: STATUS_RANK[row.status] ?? UNKNOWN_STATUS_RANK };
    case "ship": {
      const name = cruiseShipName(row);
      return { absent: name === "", str: name };
    }
    case "line": {
      const name = cruiseLineName(row);
      return { absent: name === "", str: name };
    }
  }
}

/**
 * A TOTAL order, which the browser version was not obliged to be and this one
 * is: rows are sliced into pages here, and two rows the comparator calls
 * equal can swap between two requests for two adjacent pages — the reader
 * then sees one cruise twice and never sees another. `status` makes that
 * concrete: five values across a whole logbook. The id breaks every tie.
 *
 * "Absent last" means last in both directions. A page of blank cells is a
 * worse first page than a page of cruises, whichever way the arrow points.
 */
export function compareCruises(
  a: CruiseOrderRow,
  b: CruiseOrderRow,
  sort: CruiseSortField,
  order: "asc" | "desc"
): number {
  const ka = keyOf(a, sort);
  const kb = keyOf(b, sort);
  if (ka.absent !== kb.absent) return ka.absent ? 1 : -1;

  if (!ka.absent) {
    const direction = order === "asc" ? 1 : -1;
    if (ka.str !== undefined && kb.str !== undefined) {
      const byName = ka.str.localeCompare(kb.str, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName * direction;
    } else {
      const byValue = (ka.num as number) - (kb.num as number);
      if (byValue !== 0) return byValue * direction;
    }
  }
  return a.id.localeCompare(b.id);
}

/** The calendar year and month of a sailing's start, or null when undated. */
export function cruiseStartPeriod(row: CruiseOrderRow): { year: number; month: number } | null {
  if (!row.startDate) return null;
  // UTC, because `startDate` is a calendar DAY carried at UTC midnight, not an
  // instant. `CruiseRow` says the same where it formats the cell — "the value
  // is a calendar day, not an instant, and the viewer's own zone would move a
  // sailing by a day" — and `/stats` buckets the cruise series on the stored
  // value unchanged. Reading it on the embarkation port's clock would be the
  // one thing that breaks all three: midnight UTC in Los Angeles is 16:00 the
  // PREVIOUS day.
  return { year: row.startDate.getUTCFullYear(), month: row.startDate.getUTCMonth() + 1 };
}
