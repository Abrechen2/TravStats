import { Prisma } from "../../prisma";
import type { FlightSortField } from "../../schemas/flight";

/**
 * `sort` + `order` -> a Prisma `orderBy` with a total order.
 *
 * The tie-breaker is the whole reason this is a function rather than an
 * object literal at the call site. `departureTime` is nullable and not
 * unique, so paginating on it alone skips and duplicates rows at page
 * boundaries — the comment in `routes/flights.ts` has said so since the page
 * cap was introduced. Every other sort key here is nullable and not unique
 * TOO, and several are far coarser: `status` has five distinct values across
 * an entire logbook, so ordering by it alone leaves the position of almost
 * every row undefined. Each key therefore falls back to departure time and
 * then to the id, which is unique — the order is total under all six.
 *
 * `nulls: "last"` wherever the column is nullable: a page of empty cells is a
 * worse first page than a page of rows, in either direction.
 *
 * `duration` sorts on the stored `durationMinutes`, which is NULL for the two
 * cases `schema.prisma` documents — a row whose duration is unmeasurable, and
 * the closed LEGACY_FAKE_UTC class whose duration the API derives from the
 * airport catalogue on read. Those rows therefore sort last rather than by
 * the figure the table shows them. That class only shrinks (nothing creates
 * it, and `scripts/fixMistaggedDurations.ts` retags it), and the alternative
 * — sorting in the browser — is what made the page load every flight it owns.
 */
export function buildFlightOrderBy(
  sort: FlightSortField,
  order: "asc" | "desc"
): Prisma.FlightOrderByWithRelationInput[] {
  const tail: Prisma.FlightOrderByWithRelationInput[] = [{ departureTime: "desc" }, { id: "asc" }];

  switch (sort) {
    case "departureTime":
      return [{ departureTime: { sort: order, nulls: "last" } }, { id: "asc" }];
    case "airline":
      return [{ airline: { sort: order, nulls: "last" } }, ...tail];
    case "status":
      return [{ status: order }, ...tail];
    case "duration":
      return [{ durationMinutes: { sort: order, nulls: "last" } }, ...tail];
    case "price":
      return [{ price: { sort: order, nulls: "last" } }, ...tail];
    case "route":
      // Two columns, because "route" is what the cell draws from them and no
      // single column holds it.
      return [
        { depIata: { sort: order, nulls: "last" } },
        { arrIata: { sort: order, nulls: "last" } },
        ...tail,
      ];
  }
}
