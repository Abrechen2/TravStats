/**
 * Four read-only overview sheets: trips, bookings, place lists (with their
 * entries) and documents.
 *
 * Unlike the entry sheets these are NOT imported back. A trip, a booking or a
 * list is edited where it lives in the app (moving a booking between trips, or
 * a document between entries, has rules a cell cannot hold), and the importer
 * has no reader for them and skips a tab it does not know. So every column is
 * locked and each hint says so — the point of these tabs is that the file now
 * describes the whole logbook, not only the entries.
 *
 * Documents are METADATA ONLY: name, kind, size, the entry they are filed with.
 * The bytes stay behind `/documents/:id/file`; a spreadsheet is not a backup.
 */

import type { Trip } from "../../types";
import type { Booking } from "../../types/booking";
import type { PlaceList, PlaceListEntry } from "../../types/placeList";
import type { TravelDocument } from "../api/documents";
import { refCell, type ColumnSpec, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

/** `YYYY-MM-DD` of a stored day or instant; null when there is none. */
const day = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null;

const idColumn = <R extends { id: string }>(t: T): ColumnSpec<R> => ({
  key: "id",
  header: t("xlsx:columns.id"),
  kind: "text",
  width: 38,
  locked: true,
  value: (r) => r.id,
});

/** A locked text column — every column on these sheets is read-only. */
function col<R>(
  key: string,
  header: string,
  width: number,
  value: (r: R) => string | number | boolean | null,
  kind: ColumnSpec<R>["kind"] = "text"
): ColumnSpec<R> {
  return { key, header, kind, width, locked: true, value };
}

// ------------------------------------------------------------------ trips

export function tripSheet(t: T): SheetSpec<Trip> {
  const c = (key: string, header: string, width: number, value: (r: Trip) => string | null) =>
    col<Trip>(key, header, width, value);
  return {
    key: "trips",
    name: t("xlsx:sheets.trips"),
    hint: t("xlsx:hints.trips"),
    columns: [
      idColumn<Trip>(t),
      c("name", t("xlsx:columns.name"), 30, (r) => r.name),
      col<Trip>(
        "startDate",
        t("xlsx:columns.startDate"),
        12,
        (r) => day(r.times?.start?.date ?? r.startDate),
        "date"
      ),
      col<Trip>(
        "endDate",
        t("xlsx:columns.endDate"),
        12,
        (r) => day(r.times?.end?.date ?? r.endDate),
        "date"
      ),
      c("status", t("xlsx:columns.status"), 12, (r) => r.status),
      c("category", t("xlsx:columns.category"), 12, (r) => r.category),
      c("origin", t("xlsx:columns.tripOrigin"), 20, (r) => r.originLabel),
      c("destination", t("xlsx:columns.tripDestination"), 20, (r) => r.destinationLabel),
      c("countries", t("xlsx:columns.countries"), 20, (r) => (r.countries ?? []).join(", ")),
      c("companions", t("xlsx:columns.companions"), 24, (r) => (r.companions ?? []).join(", ")),
      c("tags", t("xlsx:columns.tags"), 20, (r) => (r.tags ?? []).join(", ")),
      c("summary", t("xlsx:columns.summary"), 36, (r) => r.summary),
      c("notes", t("xlsx:columns.notes"), 40, (r) => r.notes),
    ],
  };
}

// --------------------------------------------------------------- bookings

export interface BookingRow extends Booking {
  /** The trip's name, resolved by the caller; null for a booking on no trip. */
  tripName: string | null;
}

/** Attach each booking's trip name, so the sheet reads without a second lookup. */
export function bookingRows(
  bookings: readonly Booking[],
  trips: readonly Pick<Trip, "id" | "name">[]
): BookingRow[] {
  const names = new Map(trips.map((trip) => [trip.id, trip.name]));
  return bookings.map((b) => ({ ...b, tripName: b.tripId ? (names.get(b.tripId) ?? null) : null }));
}

export function bookingSheet(t: T): SheetSpec<BookingRow> {
  const c = (
    key: string,
    header: string,
    width: number,
    value: (r: BookingRow) => string | number | null,
    kind: ColumnSpec<BookingRow>["kind"] = "text"
  ) => col<BookingRow>(key, header, width, value, kind);
  return {
    key: "bookings",
    name: t("xlsx:sheets.bookings"),
    hint: t("xlsx:hints.bookings"),
    columns: [
      idColumn<BookingRow>(t),
      {
        key: "tripId",
        header: t("xlsx:columns.trip"),
        kind: "text",
        width: 28,
        reference: true,
        locked: true,
        value: (r) => refCell(r.tripName, r.tripId),
      },
      c("pnr", t("xlsx:columns.bookingReference"), 16, (r) => r.pnr),
      c("operator", t("xlsx:columns.bookingOperator"), 22, (r) => r.operator ?? null),
      c("travellers", t("xlsx:columns.travellers"), 10, (r) => r.travellers ?? null, "number"),
      c("price", t("xlsx:columns.price"), 12, (r) => r.price, "number"),
      c("currency", t("xlsx:columns.currency"), 10, (r) => r.currency),
      c("bookedOn", t("xlsx:columns.bookedOn"), 12, (r) => day(r.bookedOn), "date"),
      // The deadline as the place's wall clock, with its zone beside it — the
      // same "Ortszeit" convention the ride and stay sheets use, never a host clock.
      c(
        "freeCancellationLocal",
        t("xlsx:columns.freeCancellationLocal"),
        20,
        (r) => r.times?.freeCancellationUntil?.local ?? null
      ),
      c(
        "freeCancellationZone",
        t("xlsx:columns.freeCancellationZone"),
        20,
        (r) => r.times?.freeCancellationUntil?.zone ?? null
      ),
      c(
        "freeCancellationOn",
        t("xlsx:columns.freeCancellationOn"),
        14,
        (r) => day(r.times?.freeCancellationOn?.date),
        "date"
      ),
      c(
        "paymentDue",
        t("xlsx:columns.paymentDue"),
        14,
        (r) => day(r.times?.paymentDue?.date),
        "date"
      ),
    ],
  };
}

// ------------------------------------------------------------- place lists

export function placeListSheet(t: T): SheetSpec<PlaceList> {
  const c = (
    key: string,
    header: string,
    width: number,
    value: (r: PlaceList) => string | number | null,
    kind: ColumnSpec<PlaceList>["kind"] = "text"
  ) => col<PlaceList>(key, header, width, value, kind);
  return {
    key: "placeLists",
    name: t("xlsx:sheets.placeLists"),
    hint: t("xlsx:hints.placeLists"),
    columns: [
      idColumn<PlaceList>(t),
      c("name", t("xlsx:columns.name"), 28, (r) => r.name),
      c("description", t("xlsx:columns.description"), 36, (r) => r.description),
      c("color", t("xlsx:columns.color"), 10, (r) => r.color),
      c("icon", t("xlsx:columns.icon"), 10, (r) => r.icon),
      // A subscription to a shipped checklist, by its catalogue key.
      c("curatedKey", t("xlsx:columns.checklist"), 22, (r) => r.curatedKey),
      c("placeCount", t("xlsx:columns.placeCount"), 10, (r) => r.placeCount, "number"),
      c("visitedCount", t("xlsx:columns.visitedCount"), 10, (r) => r.visitedCount, "number"),
      c("countryCount", t("xlsx:columns.countryCount"), 10, (r) => r.countryCount, "number"),
    ],
  };
}

export interface PlaceListEntryRow extends PlaceListEntry {
  listLabel: string;
}

/** One row per list entry, in list order, each carrying its list's id. */
export function placeListEntryRows(lists: readonly PlaceList[]): PlaceListEntryRow[] {
  return lists.flatMap((list) =>
    [...(list.entries ?? [])]
      .sort((a, b) => a.sortIdx - b.sortIdx || a.id.localeCompare(b.id))
      .map((entry) => ({ ...entry, listId: list.id, listLabel: list.name }))
  );
}

export function placeListEntrySheet(t: T): SheetSpec<PlaceListEntryRow> {
  const c = (
    key: string,
    header: string,
    width: number,
    value: (r: PlaceListEntryRow) => string | number | boolean | null,
    kind: ColumnSpec<PlaceListEntryRow>["kind"] = "text"
  ) => col<PlaceListEntryRow>(key, header, width, value, kind);
  return {
    key: "placeListEntries",
    name: t("xlsx:sheets.placeListEntries"),
    hint: t("xlsx:hints.placeListEntries"),
    columns: [
      idColumn<PlaceListEntryRow>(t),
      {
        key: "listId",
        header: t("xlsx:columns.placeList"),
        kind: "text",
        width: 28,
        reference: true,
        locked: true,
        value: (r) => refCell(r.listLabel, r.listId),
      },
      c("position", t("xlsx:columns.position"), 8, (r) => r.sortIdx + 1, "number"),
      {
        key: "placeId",
        header: t("xlsx:columns.place"),
        kind: "text",
        width: 30,
        reference: true,
        locked: true,
        value: (r) => refCell(r.place?.name, r.placeId),
      },
      c("city", t("xlsx:columns.city"), 18, (r) => r.place?.city ?? null),
      c("country", t("xlsx:columns.country"), 16, (r) => r.place?.country ?? null),
      c("visited", t("xlsx:columns.visited"), 10, (r) => r.place?.visited ?? null, "boolean"),
      c("addedOn", t("xlsx:columns.addedOn"), 12, (r) => day(r.createdAt), "date"),
    ],
  };
}

// -------------------------------------------------------------- documents

export function documentSheet(t: T): SheetSpec<TravelDocument> {
  const c = (
    key: string,
    header: string,
    width: number,
    value: (r: TravelDocument) => string | number | null,
    kind: ColumnSpec<TravelDocument>["kind"] = "text"
  ) => col<TravelDocument>(key, header, width, value, kind);
  return {
    key: "documents",
    name: t("xlsx:sheets.documents"),
    hint: t("xlsx:hints.documents"),
    columns: [
      idColumn<TravelDocument>(t),
      c("name", t("xlsx:columns.name"), 32, (r) => r.displayName),
      c("kind", t("xlsx:columns.documentKind"), 14, (r) => r.kind),
      c("format", t("xlsx:columns.documentFormat"), 10, (r) => r.format),
      c("sizeBytes", t("xlsx:columns.sizeBytes"), 12, (r) => r.sizeBytes, "number"),
      c("issuedOn", t("xlsx:columns.issuedOn"), 12, (r) => day(r.issuedOn), "date"),
      c("entryType", t("xlsx:columns.entryType"), 16, (r) => r.entry?.type ?? null),
      c("entryId", t("xlsx:columns.entryId"), 38, (r) => r.entry?.id ?? null),
      c("source", t("xlsx:columns.documentSource"), 10, (r) => r.source),
      c("addedOn", t("xlsx:columns.addedOn"), 12, (r) => day(r.createdAt), "date"),
      c("filedOn", t("xlsx:columns.filedOn"), 12, (r) => day(r.linkedAt), "date"),
    ],
  };
}
