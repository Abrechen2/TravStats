/**
 * The ONE order of a cruise's stops: day number, then arrival time, then
 * departure time (a stop without a time sorts after one with it), then id.
 *
 * Limit, on purpose: Prisma's `orderBy` cannot coalesce, so arrival and departure
 * are two keys, not `arrival ?? departure`. A stop with only a departure sorts
 * after a same-day stop that has an arrival. Both forms keep the SAME rule, so the
 * server and the maps still agree.
 *
 * Why all four: a river cruise calls at two ports on one day (Fengdu 07:00 and
 * Zhongxian 15:00 on day 2), and `orderBy: { dayNumber }` alone leaves those in
 * whatever order Postgres returns them. Two queries then disagreed, the sequence
 * the server routed and the one the dashboard drew differed, and the Yangtze
 * cruise showed a Zhongxian→Fengdu zig-zag of chords (forgejo#435). Every place
 * that turns stops into a sequence of legs — geometry, distances, leg-route
 * keys, the maps — uses this order.
 *
 * Change both together: this mirrors `backend/src/shared/cruise/stopOrder.ts`
 * (the Prisma `orderBy` form is backend-only). Each side has its own test of the same
 * Yangtze stop set.
 */

type TimeLike = string | Date | null | undefined;

export interface OrderableCruiseStop {
  dayNumber: number;
  arrivalTime?: TimeLike;
  departureTime?: TimeLike;
  id?: string | null;
}

function timeMs(value: TimeLike): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Ascending, nulls last — the same rule Prisma's `nulls: "last"` applies. */
function compareNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function compareCruiseStops(a: OrderableCruiseStop, b: OrderableCruiseStop): number {
  return (
    a.dayNumber - b.dayNumber ||
    compareNullsLast(timeMs(a.arrivalTime), timeMs(b.arrivalTime)) ||
    compareNullsLast(timeMs(a.departureTime), timeMs(b.departureTime)) ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

/** A sorted copy; the input is not touched. */
export function sortCruiseStops<T extends OrderableCruiseStop>(stops: readonly T[]): T[] {
  return [...stops].sort(compareCruiseStops);
}
