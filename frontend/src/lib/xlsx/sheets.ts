/**
 * The sheets themselves — one per table, in the order they appear as tabs.
 *
 * Two rules run through all of them:
 *
 * 1. **Column A is the id, locked.** It is how a re-imported row finds its
 *    record. Blank means "new".
 * 2. **A pointer to another sheet is written as "Name [id]".** Readable, and
 *    still resolvable after someone edits the readable half.
 *
 * Child tables (cruise stops, lodging stays, place visits) get their OWN
 * sheets rather than being flattened into their parent's row: a cruise has as
 * many stops as it has, and a spreadsheet column cannot hold "as many". Each
 * child row points back at its parent by id.
 */

import type { Cruise, CruiseStop } from "../../types/cruise";
import type { Lodging, LodgingStay } from "../../types/lodging";
import type { Place, PlaceVisit } from "../../types/place";
import { refCell, type SheetSpec } from "./sheetSpec";

/** Translator shape, so this module needs no react-i18next import. */
type T = (key: string) => string;

const id = <R extends { id: string }>(header: string) => ({
  key: "id",
  header,
  kind: "text" as const,
  width: 38,
  locked: true,
  value: (r: R) => r.id,
});

// ---------------------------------------------------------------- cruises

export function cruiseSheet(t: T): SheetSpec<Cruise> {
  return {
    key: "cruises",
    name: t("xlsx:sheets.cruises"),
    hint: t("xlsx:hints.cruises"),
    columns: [
      id<Cruise>(t("xlsx:columns.id")),
      { key: "cruiseLine", header: t("xlsx:columns.cruiseLine"), kind: "text", width: 22,
        value: (c) => c.cruiseLine },
      { key: "ship", header: t("xlsx:columns.ship"), kind: "text", width: 22,
        // The override wins where set — it is what the user chose to call it.
        value: (c) => c.shipNameOverride ?? c.ship?.name ?? null },
      { key: "routeName", header: t("xlsx:columns.routeName"), kind: "text", width: 26,
        value: (c) => c.routeName },
      { key: "startDate", header: t("xlsx:columns.startDate"), kind: "date", width: 14,
        value: (c) => c.startDate },
      { key: "endDate", header: t("xlsx:columns.endDate"), kind: "date", width: 14,
        value: (c) => c.endDate },
      { key: "status", header: t("xlsx:columns.status"), kind: "text", width: 12,
        value: (c) => c.status },
      { key: "departurePort", header: t("xlsx:columns.departurePort"), kind: "text", width: 20,
        value: (c) => c.departurePort?.name ?? null },
      { key: "arrivalPort", header: t("xlsx:columns.arrivalPort"), kind: "text", width: 20,
        value: (c) => c.arrivalPort?.name ?? null },
      { key: "cabinNumber", header: t("xlsx:columns.cabinNumber"), kind: "text", width: 12,
        value: (c) => c.cabinNumber },
      { key: "cabinType", header: t("xlsx:columns.cabinType"), kind: "text", width: 14,
        value: (c) => c.cabinType },
      { key: "deck", header: t("xlsx:columns.deck"), kind: "number", width: 8,
        value: (c) => c.deck },
      { key: "price", header: t("xlsx:columns.price"), kind: "number", width: 12,
        value: (c) => c.price },
      { key: "currency", header: t("xlsx:columns.currency"), kind: "text", width: 10,
        value: (c) => c.currency },
      { key: "bookingReference", header: t("xlsx:columns.bookingReference"), kind: "text", width: 16,
        value: (c) => c.bookingReference },
      { key: "tripId", header: t("xlsx:columns.trip"), kind: "text", width: 28, reference: true,
        value: (c) => refCell(c.trip?.name, c.tripId) },
      { key: "companions", header: t("xlsx:columns.companions"), kind: "text", width: 24,
        value: (c) => c.companions.join(", ") },
      { key: "tags", header: t("xlsx:columns.tags"), kind: "text", width: 20,
        value: (c) => c.tags.join(", ") },
      { key: "notes", header: t("xlsx:columns.notes"), kind: "text", width: 40,
        value: (c) => c.notes },
    ],
  };
}

/** A stop row carries its cruise's id, because a stop only means something
 *  under one cruise — and the sheet is sorted by it for readability. */
export interface CruiseStopRow extends CruiseStop {
  cruiseId: string;
  cruiseLabel: string;
}

export function cruiseStopSheet(t: T): SheetSpec<CruiseStopRow> {
  return {
    key: "cruiseStops",
    name: t("xlsx:sheets.cruiseStops"),
    hint: t("xlsx:hints.cruiseStops"),
    columns: [
      id<CruiseStopRow>(t("xlsx:columns.id")),
      { key: "cruiseId", header: t("xlsx:columns.cruise"), kind: "text", width: 30, reference: true,
        value: (s) => refCell(s.cruiseLabel, s.cruiseId) },
      { key: "dayNumber", header: t("xlsx:columns.dayNumber"), kind: "number", width: 8,
        value: (s) => s.dayNumber },
      { key: "port", header: t("xlsx:columns.port"), kind: "text", width: 22,
        // The three-state invariant made readable: a matched port shows its
        // name, an unresolved one the name that could not be matched, a sea
        // day neither.
        value: (s) => s.port?.name ?? s.unresolvedPortName ?? null },
      { key: "isAtSea", header: t("xlsx:columns.isAtSea"), kind: "boolean", width: 10,
        value: (s) => s.isAtSea },
      { key: "arrivalTime", header: t("xlsx:columns.arrivalTime"), kind: "text", width: 12,
        value: (s) => s.arrivalTime },
      { key: "departureTime", header: t("xlsx:columns.departureTime"), kind: "text", width: 12,
        value: (s) => s.departureTime },
      { key: "excursionNote", header: t("xlsx:columns.excursionNote"), kind: "text", width: 34,
        value: (s) => s.excursionNote },
    ],
  };
}

// ---------------------------------------------------------------- lodging

export function lodgingSheet(t: T): SheetSpec<Lodging> {
  return {
    key: "lodging",
    name: t("xlsx:sheets.lodging"),
    hint: t("xlsx:hints.lodging"),
    columns: [
      id<Lodging>(t("xlsx:columns.id")),
      { key: "name", header: t("xlsx:columns.name"), kind: "text", width: 28,
        value: (l) => l.name },
      { key: "type", header: t("xlsx:columns.type"), kind: "text", width: 14,
        value: (l) => l.type },
      { key: "chain", header: t("xlsx:columns.chain"), kind: "text", width: 18,
        value: (l) => l.chain?.name ?? null },
      { key: "address", header: t("xlsx:columns.address"), kind: "text", width: 32,
        value: (l) => l.address },
      { key: "city", header: t("xlsx:columns.city"), kind: "text", width: 18,
        value: (l) => l.city },
      { key: "country", header: t("xlsx:columns.country"), kind: "text", width: 16,
        value: (l) => l.country },
      { key: "lat", header: t("xlsx:columns.lat"), kind: "number", width: 12,
        value: (l) => l.lat },
      { key: "lon", header: t("xlsx:columns.lon"), kind: "number", width: 12,
        value: (l) => l.lon },
      { key: "stars", header: t("xlsx:columns.stars"), kind: "number", width: 8,
        value: (l) => l.stars },
      { key: "visited", header: t("xlsx:columns.visited"), kind: "boolean", width: 10,
        value: (l) => l.visited },
      { key: "amenities", header: t("xlsx:columns.amenities"), kind: "text", width: 26,
        value: (l) => l.amenities.join(", ") },
      { key: "notes", header: t("xlsx:columns.notes"), kind: "text", width: 40,
        value: (l) => l.notes },
    ],
  };
}

export interface LodgingStayRow extends LodgingStay {
  lodgingId: string;
  lodgingLabel: string;
}

export function lodgingStaySheet(t: T): SheetSpec<LodgingStayRow> {
  return {
    key: "lodgingStays",
    name: t("xlsx:sheets.lodgingStays"),
    hint: t("xlsx:hints.lodgingStays"),
    columns: [
      id<LodgingStayRow>(t("xlsx:columns.id")),
      { key: "lodgingId", header: t("xlsx:columns.lodging"), kind: "text", width: 30, reference: true,
        value: (s) => refCell(s.lodgingLabel, s.lodgingId) },
      { key: "checkIn", header: t("xlsx:columns.checkIn"), kind: "date", width: 14,
        value: (s) => s.checkIn },
      { key: "checkOut", header: t("xlsx:columns.checkOut"), kind: "date", width: 14,
        value: (s) => s.checkOut },
      { key: "nights", header: t("xlsx:columns.nights"), kind: "number", width: 8, locked: true,
        // Derived from the dates by the server; shown so a sheet can be summed,
        // locked so an edited total cannot contradict the dates beside it.
        value: (s) => s.nights },
      { key: "status", header: t("xlsx:columns.status"), kind: "text", width: 12,
        value: (s) => s.status },
      { key: "roomNumber", header: t("xlsx:columns.roomNumber"), kind: "text", width: 12,
        value: (s) => s.roomNumber },
      { key: "roomCategory", header: t("xlsx:columns.roomCategory"), kind: "text", width: 16,
        value: (s) => s.roomCategory },
      { key: "board", header: t("xlsx:columns.board"), kind: "text", width: 14,
        value: (s) => s.board },
      { key: "pricePerNight", header: t("xlsx:columns.pricePerNight"), kind: "number", width: 14,
        value: (s) => s.pricePerNight },
      { key: "totalPrice", header: t("xlsx:columns.totalPrice"), kind: "number", width: 12,
        value: (s) => s.totalPrice },
      { key: "currency", header: t("xlsx:columns.currency"), kind: "text", width: 10,
        value: (s) => s.currency },
    ],
  };
}

// ---------------------------------------------------------------- places

export function placeSheet(t: T): SheetSpec<Place> {
  return {
    key: "places",
    name: t("xlsx:sheets.places"),
    hint: t("xlsx:hints.places"),
    columns: [
      id<Place>(t("xlsx:columns.id")),
      { key: "name", header: t("xlsx:columns.name"), kind: "text", width: 30,
        value: (p) => p.name },
      { key: "category", header: t("xlsx:columns.category"), kind: "text", width: 16,
        value: (p) => p.category },
      { key: "address", header: t("xlsx:columns.address"), kind: "text", width: 32,
        value: (p) => p.address },
      { key: "city", header: t("xlsx:columns.city"), kind: "text", width: 18,
        value: (p) => p.city },
      { key: "country", header: t("xlsx:columns.country"), kind: "text", width: 16,
        value: (p) => p.country },
      { key: "lat", header: t("xlsx:columns.lat"), kind: "number", width: 12,
        value: (p) => p.lat },
      { key: "lon", header: t("xlsx:columns.lon"), kind: "number", width: 12,
        value: (p) => p.lon },
      { key: "visited", header: t("xlsx:columns.visited"), kind: "boolean", width: 10,
        value: (p) => p.visited },
      { key: "notes", header: t("xlsx:columns.notes"), kind: "text", width: 40,
        value: (p) => p.notes },
    ],
  };
}

export interface PlaceVisitRow extends PlaceVisit {
  placeId: string;
  placeLabel: string;
}

export function placeVisitSheet(t: T): SheetSpec<PlaceVisitRow> {
  return {
    key: "placeVisits",
    name: t("xlsx:sheets.placeVisits"),
    hint: t("xlsx:hints.placeVisits"),
    columns: [
      id<PlaceVisitRow>(t("xlsx:columns.id")),
      { key: "placeId", header: t("xlsx:columns.place"), kind: "text", width: 30, reference: true,
        value: (v) => refCell(v.placeLabel, v.placeId) },
      { key: "visitedAt", header: t("xlsx:columns.visitedAt"), kind: "date", width: 14,
        value: (v) => v.visitedAt },
      { key: "rating", header: t("xlsx:columns.rating"), kind: "number", width: 8,
        value: (v) => v.rating },
      { key: "notes", header: t("xlsx:columns.notes"), kind: "text", width: 40,
        value: (v) => v.notes },
    ],
  };
}
