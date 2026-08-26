import { formatDateInTimezone } from "../../../lib/dateUtils";
import { latestStayDayOf } from "../../../lib/lodgingLatestStay";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";

/**
 * One row of the dashboard activity sidebar, in a shape no domain owns.
 *
 * The panel used to build these inline and knew only flights and cruises,
 * which is why lodgings and places had bespoke sidebars of their own and the
 * "Alle" tab silently listed half the account. Everything domain-specific
 * lives in the mappers below; the panel renders `label / sublabel / meta /
 * displayDate` and never asks what kind of thing it is drawing.
 */
/**
 * The mappers TRANSLATE, they do not return finished German.
 *
 * Each of the four bespoke sidebars this file replaced went through `t` for
 * its meta line — `dashboard:sidebar.ports`, `lodging:field.nightsCount`. When
 * the four collapsed into one mapper the strings came along as literals, and
 * a literal here is German text on an English reader's dashboard. The shape is
 * the project wrapper's `t` so a component can pass its own straight through.
 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ActivityKind = "flight" | "cruise" | "lodging" | "poi";

export type ActivityPayload =
  | { flightId: string }
  | { cruise: Cruise }
  | { lodging: Lodging }
  | { place: Place };

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  label: string;
  sublabel: string | null;
  /**
   * One extra fact per domain, as TEXT rather than domain-specific markup:
   * flight duration, cruise ports, lodging nights, place visits. Keeping it a
   * plain string is what lets one row render four domains — dropping it
   * altogether would have thrown away what the cruise and lodging sidebars
   * already showed.
   */
  meta: string | null;
  /** ISO-sortable "YYYY-MM-DD"; empty means the row carries no date at all. */
  sortDate: string;
  /** Human-readable date for the row; "—" when there is none. */
  displayDate: string;
  /**
   * Whether the map can focus this row. False for a lodging with no resolved
   * location; a row that cannot be focused still opens its detail page, which
   * is where the missing location gets fixed.
   */
  mappable: boolean;
  payload: ActivityPayload;
}

function readProp<T>(obj: Record<string, unknown>, key: string): T | undefined {
  return obj[key] as T | undefined;
}

/** "2026-05-20T08:00:00Z" -> "2026-05-20"; anything unusable -> "". */
function isoDay(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
}

function display(sortDate: string, iso: string | null): string {
  return sortDate ? formatDateInTimezone(iso ?? sortDate, "UTC") : "—";
}

function joinParts(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(" · ") : null;
}

export function flightToItem(feature: GeoJSONFeature, index: number, t: Translate): ActivityItem {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const dep = readProp<{ iata?: string }>(props, "departureAirport");
  const arr = readProp<{ iata?: string }>(props, "arrivalAirport");
  const airline = readProp<string>(props, "airline") ?? "";
  const flightNumber = readProp<string>(props, "flightNumber") ?? "";
  const flightId = readProp<string>(props, "id") ?? "";
  const status = readProp<string>(props, "status");
  // Historical flights can have no departure time; leaving sortDate empty puts
  // them at the bottom instead of pretending they happened at the epoch.
  const departureTime = readProp<string | null>(props, "departureTime") ?? "";
  const sortDate = isoDay(departureTime);

  return {
    id: `f-${flightId || index}`,
    kind: "flight",
    label: `${dep?.iata ?? "?"} → ${arr?.iata ?? "?"}`,
    sublabel: joinParts(airline, flightNumber),
    meta: status === "scheduled" ? t("flights:status.scheduled") : null,
    sortDate,
    displayDate: display(sortDate, departureTime),
    mappable: true,
    payload: { flightId },
  };
}

export function cruiseToItem(cruise: Cruise, t: Translate): ActivityItem {
  const sortDate = isoDay(cruise.startDate);
  const ports = cruise.stops?.filter((s) => !s.isAtSea).length ?? 0;
  return {
    id: `c-${cruise.id}`,
    kind: "cruise",
    label:
      cruise.ship?.name ??
      cruise.shipNameOverride ??
      cruise.cruiseLine ??
      t("cruise:map.fallbackTitle"),
    sublabel: cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? null,
    meta: ports > 0 ? `${ports} ${t("dashboard:sidebar.ports")}` : null,
    sortDate,
    displayDate: display(sortDate, cruise.startDate ?? null),
    mappable: true,
    payload: { cruise },
  };
}

/**
 * A hotel carries no date of its own — the STAY does. The row therefore shows
 * the newest stay, and "newest" deliberately includes stays that have not
 * happened yet: a hotel booked for next month belongs above one left last
 * year. That is why this cannot reuse a "last completed stay" style field.
 *
 * The stay dates are read through `resolveStayTiming` rather than off
 * `checkIn` directly, because a stay may be dated to a month or a year only,
 * and that reader is where the project keeps the rules for it.
 */
export function lodgingToItem(lodging: Lodging, t: Translate): ActivityItem {
  const newest = latestStayDayOf(lodging);

  const nights = lodging.nights ?? 0;
  return {
    id: `l-${lodging.id}`,
    kind: "lodging",
    label: lodging.name,
    sublabel: joinParts(lodging.chain?.name, lodging.city),
    meta: nights > 0 ? t("lodging:field.nightsCount", { count: nights }) : null,
    sortDate: newest,
    displayDate: display(newest, newest || null),
    // A hotel whose location never resolved has no pin to focus. The row stays
    // in the list and still leads to its detail page — see LodgingListPanel,
    // which has marked this case since #259.
    mappable: lodging.lat !== null && lodging.lon !== null,
    payload: { lodging },
  };
}

/**
 * `Place.lastVisitAt` is documented as the most recent COMPLETED visit and
 * excludes future ones, so it cannot answer "newest including planned". The
 * visits are walked instead. A wishlist place with no dated visit gets no
 * date and sorts to the bottom, like an undated flight.
 */
export function placeToItem(place: Place, t: Translate): ActivityItem {
  let newest = "";
  for (const visit of place.visits ?? []) {
    const day = isoDay(visit.visitedAt);
    if (day && day > newest) newest = day;
  }

  const visits = place.visitCount ?? 0;
  return {
    id: `p-${place.id}`,
    kind: "poi",
    label: place.name,
    sublabel: joinParts(place.city, place.country),
    meta:
      visits > 0
        ? t("places:list.visitsCount", { count: visits })
        : place.visited
          ? null
          : t("places:list.status.wishlist"),
    sortDate: newest,
    displayDate: display(newest, newest || null),
    // lat/lon are NOT NULL on Place — a place that cannot be drawn is not creatable.
    mappable: true,
    payload: { place },
  };
}

/**
 * Newest first, undated last.
 *
 * Undated rows go to the BOTTOM rather than sorting as the epoch, so they do
 * not take over the first screenful. Future-dated rows are NOT special-cased:
 * the owner's rule is that what is coming up belongs above what is past, and
 * a plain descending sort already does that.
 */
export function sortActivityItems(items: readonly ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    if (a.sortDate === b.sortDate) return 0;
    if (a.sortDate === "") return 1;
    if (b.sortDate === "") return -1;
    return a.sortDate < b.sortDate ? 1 : -1;
  });
}
