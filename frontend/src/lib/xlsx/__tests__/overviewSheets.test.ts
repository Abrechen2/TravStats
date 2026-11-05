import { describe, it, expect } from "vitest";

import { buildSheets } from "../exportAll";
import { buildWorkbook } from "../workbook";
import { importableSpecs } from "../importClient";
import type { Trip } from "../../../types";
import type { Booking } from "../../../types/booking";
import type { PlaceList } from "../../../types/placeList";
import type { TravelDocument } from "../../api/documents";

const t = (key: string): string => key;

const trip = {
  id: "trip-1",
  name: "Japan 2024",
  startDate: "2024-04-01T00:00:00.000Z",
  endDate: "2024-04-14T00:00:00.000Z",
  status: "completed",
  category: "vacation",
  countries: ["JP"],
  companions: ["Mia"],
  tags: ["asia"],
  notes: null,
} as unknown as Trip;

const booking = {
  id: "bk-1",
  tripId: "trip-1",
  pnr: "ABC123",
  price: 1200,
  currency: "EUR",
  operator: "TUI",
  travellers: 2,
  bookedOn: "2024-01-05",
  times: {
    freeCancellationUntil: {
      utc: "2024-03-01T09:00:00Z",
      zone: "Europe/Berlin",
      offset: "+01:00",
      local: "2024-03-01T10:00:00",
      precision: "minute",
    },
    paymentDue: { date: "2024-02-01", zone: null, precision: "day" },
  },
} as unknown as Booking;

const list = {
  id: "list-1",
  name: "Cafés",
  description: null,
  color: "#fff",
  icon: null,
  curatedKey: null,
  placeCount: 1,
  visitedCount: 1,
  countryCount: 1,
  entries: [
    {
      id: "e-1",
      listId: "list-1",
      placeId: "pl-1",
      sortIdx: 0,
      createdAt: "2024-05-02T10:00:00.000Z",
      place: { id: "pl-1", name: "Café Central", city: "Wien", country: "AT", visited: true },
    },
  ],
} as unknown as PlaceList;

const doc = {
  id: "doc-1",
  format: "pdf",
  kind: "invoice",
  sizeBytes: 2048,
  displayName: "rechnung.pdf",
  issuedOn: "2024-05-01",
  source: "upload",
  createdAt: "2024-05-02T10:00:00.000Z",
  linkedAt: "2024-05-03T10:00:00.000Z",
  entry: { type: "trip", id: "trip-1" },
  url: "/api/v1/documents/doc-1/file",
} as unknown as TravelDocument;

const byKey = (sheets: ReturnType<typeof buildSheets>, key: string) =>
  sheets.find((s) => s.spec.key === key);

describe("the export carries a sheet for trips, bookings, place lists and documents", () => {
  const sheets = buildSheets(t, {
    trips: [trip],
    bookings: [booking],
    placeLists: [list],
    documents: [doc],
  });

  it("writes a trips sheet with its header and a row", () => {
    const s = byKey(sheets, "trips")!;
    expect(s.spec.columns.map((c) => c.key).slice(0, 5)).toEqual([
      "id",
      "name",
      "startDate",
      "endDate",
      "status",
    ]);
    const row = Object.fromEntries(s.spec.columns.map((c) => [c.key, c.value(s.rows[0] as never)]));
    expect(row).toMatchObject({
      id: "trip-1",
      name: "Japan 2024",
      startDate: "2024-04-01",
      endDate: "2024-04-14",
      countries: "JP",
    });
  });

  it("writes a bookings sheet pointing at its trip and carrying deadlines in local time", () => {
    const s = byKey(sheets, "bookings")!;
    const row = Object.fromEntries(s.spec.columns.map((c) => [c.key, c.value(s.rows[0] as never)]));
    expect(row).toMatchObject({
      id: "bk-1",
      tripId: "Japan 2024 [trip-1]",
      pnr: "ABC123",
      operator: "TUI",
      travellers: 2,
      bookedOn: "2024-01-05",
      freeCancellationLocal: "2024-03-01T10:00:00",
      freeCancellationZone: "Europe/Berlin",
      paymentDue: "2024-02-01",
    });
  });

  it("writes a booking that sits on no trip with an empty trip cell", () => {
    const loose = { ...booking, id: "bk-2", tripId: null } as Booking;
    const s = byKey(buildSheets(t, { bookings: [loose] }), "bookings")!;
    const tripCol = s.spec.columns.find((c) => c.key === "tripId")!;
    expect(tripCol.value(s.rows[0] as never)).toBe("");
  });

  it("writes place lists and, one row per place, their entries", () => {
    expect(byKey(sheets, "placeLists")!.rows).toHaveLength(1);
    const s = byKey(sheets, "placeListEntries")!;
    const row = Object.fromEntries(s.spec.columns.map((c) => [c.key, c.value(s.rows[0] as never)]));
    expect(row).toMatchObject({
      listId: "Cafés [list-1]",
      position: 1,
      placeId: "Café Central [pl-1]",
      city: "Wien",
    });
  });

  it("writes documents as metadata only, never the file", () => {
    const s = byKey(sheets, "documents")!;
    const row = Object.fromEntries(s.spec.columns.map((c) => [c.key, c.value(s.rows[0] as never)]));
    expect(row).toMatchObject({
      id: "doc-1",
      name: "rechnung.pdf",
      kind: "invoice",
      sizeBytes: 2048,
      entryType: "trip",
      entryId: "trip-1",
    });
    expect(s.spec.columns.map((c) => c.key)).not.toContain("url");
  });

  it("leaves all four sheets out when there is nothing, and skips empty child sheets", () => {
    expect(buildSheets(t, { trips: [], bookings: [], placeLists: [], documents: [] })).toEqual([]);
    const noEntries = buildSheets(t, { placeLists: [{ ...list, entries: [] }] });
    expect(noEntries.map((s) => s.spec.key)).toEqual(["placeLists"]);
  });

  it("is read-only and never offered to the importer, so a round trip ignores it", () => {
    const keys = ["trips", "bookings", "placeLists", "placeListEntries", "documents"];
    for (const key of keys) {
      expect(byKey(sheets, key)!.spec.columns.every((c) => c.locked)).toBe(true);
    }
    const importable = importableSpecs(t, {
      rail: true,
      bus: true,
      ferry: true,
      rental: true,
    }).map((s) => s.key);
    for (const key of keys) expect(importable).not.toContain(key);
  });

  it("builds a real workbook out of them", async () => {
    const wb = await buildWorkbook(sheets);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "xlsx-sheets.trips",
      "xlsx-sheets.bookings",
      "xlsx-sheets.placeLists",
      "xlsx-sheets.placeListEntries",
      "xlsx-sheets.documents",
    ]);
  });
});
