/**
 * The order of the rail logbook's connections (a ride with changes is one
 * entry). The grouping is derived, so the order cannot be pushed into SQL: it
 * is decided here over the narrow grouping rows, BEFORE the page is sliced —
 * sort-then-slice, never slice-then-sort.
 */
export const CONNECTION_SORT_FIELDS = [
  "departure",
  "operator",
  "route",
  "duration",
  "distance",
  "status",
  "trip",
] as const;
export type ConnectionSortField = (typeof CONNECTION_SORT_FIELDS)[number];

/** The columns the sort reads, on top of what the grouping needs. */
export interface SortableLeg {
  id: string;
  departureTime: Date;
  arrivalTime: Date | null;
  depStationName: string;
  arrStationName: string;
  operator: string | null;
  distanceKm: number | null;
  status: string;
  trip: { name: string } | null;
}

type SortValue = string | number | null;

/**
 * One value per connection. `null` means "nothing to order by" (no operator,
 * no trip, an unmeasured distance, an unknown arrival) and sorts LAST in both
 * directions, so an absent value is never read as the smallest one.
 */
function sortValue(group: readonly SortableLeg[], field: ConnectionSortField): SortValue {
  const first = group[0];
  const last = group[group.length - 1];
  switch (field) {
    case "departure":
      return first.departureTime.getTime();
    case "operator":
      return first.operator?.trim().toLowerCase() || null;
    case "route":
      return `${first.depStationName} ${last.arrStationName}`.toLowerCase();
    case "duration": {
      if (last.arrivalTime === null) return null;
      return last.arrivalTime.getTime() - first.departureTime.getTime();
    }
    case "distance": {
      // A ride with one unmeasured leg has no known total: a partial sum
      // would rank it as shorter than it is.
      if (group.some((leg) => leg.distanceKm === null)) return null;
      return group.reduce((sum, leg) => sum + (leg.distanceKm ?? 0), 0);
    }
    case "status":
      return first.status;
    case "trip":
      return first.trip?.name.trim().toLowerCase() || null;
  }
}

function compareValues(a: SortValue, b: SortValue, direction: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (a === b) return 0;
  return (a < b ? -1 : 1) * direction;
}

/**
 * Orders `groups` by `field`. The tie-breaker (first departure, then the first
 * leg's id, both in the requested direction) makes the order TOTAL, so a page
 * boundary can neither skip nor repeat a ride.
 */
export function sortConnections<T extends SortableLeg>(
  groups: readonly (readonly T[])[],
  field: ConnectionSortField,
  order: "asc" | "desc"
): T[][] {
  const direction = order === "asc" ? 1 : -1;
  const keyed = groups.map((group) => ({
    group,
    value: sortValue(group, field),
    departure: group[0].departureTime.getTime(),
    id: group[0].id,
  }));
  keyed.sort(
    (a, b) =>
      compareValues(a.value, b.value, direction) ||
      compareValues(a.departure, b.departure, direction) ||
      compareValues(a.id, b.id, direction)
  );
  return keyed.map((k) => [...k.group]);
}
