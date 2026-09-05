import type { Flight } from "../../types";

// Column-visibility ids (ColumnPicker) — header and row cells must agree.
export const FLIGHT_COLUMN_IDS = [
  "airline",
  "flightNumber",
  "route",
  "time",
  "status",
  "duration",
  "aircraft",
  "price",
  "trip",
  "actions",
] as const;
export const FLIGHT_ALWAYS_VISIBLE = ["route", "actions"] as const;

export type FlightColumnId = (typeof FLIGHT_COLUMN_IDS)[number];
export type FlightSortKey = "departureTime" | "airline" | "status" | "duration";

/**
 * Column id -> sort key. Columns without an entry are not sortable — which is
 * six of ten, the widest gap of the three list pages (cruises sort six of
 * eight, lodging all eight).
 */
export const FLIGHT_SORT_KEY_BY_COLUMN: Partial<Record<FlightColumnId, FlightSortKey>> = {
  airline: "airline",
  time: "departureTime",
  status: "status",
  duration: "duration",
};

/**
 * One label source for header, column picker and footer. The page used to
 * hold three separate copies of these names, which is how a column could end
 * up called one thing in the picker and another in the footer.
 */
export function flightColumnLabel(t: (key: string) => string, id: FlightColumnId): string {
  if (id === "trip") return t("trips:tab");
  if (id === "duration") return t("flights:table.flightTime");
  return t(`flights:table.${id}`);
}

export type FlightStatusFilter = Flight["status"] | "all";

/** The statuses a flight can carry. `historical` and `duplicated` are real
 *  states, not hidden ones — the old checkbox panel force-added them to every
 *  selection, so picking "nur geflogen" quietly kept them in the table. */
export const FLIGHT_STATUSES: ReadonlyArray<Flight["status"]> = [
  "flown",
  "scheduled",
  "cancelled",
  "historical",
  "duplicated",
];

export const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
