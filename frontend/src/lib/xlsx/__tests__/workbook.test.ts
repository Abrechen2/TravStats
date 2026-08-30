import { describe, it, expect } from "vitest";
import { buildWorkbook, parseWorkbook, safeSheetName } from "../workbook";
import { refCell, parseRefCell } from "../sheetSpec";
import { buildSheets, exportFilename } from "../exportAll";
import { cruiseSheet, lodgingSheet, placeSheet, placeVisitSheet } from "../sheets";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";

/** The i18n stub returns the KEY, not German words — a test that asserted on
 *  copy would pass while the sheet shipped untranslated. */
const t = (key: string): string => key;

function makeCruise(over: Partial<Cruise> = {}): Cruise {
  return {
    id: "cruise-1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: "AIDAcosma",
    cruiseLine: "AIDA",
    routeName: "Westliches Mittelmeer",
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-04-03",
    endDate: "2024-04-10",
    status: "flown",
    cabinNumber: "10234",
    cabinType: "balcony",
    deck: 10,
    bookingReference: "ABC123",
    price: 1899.5,
    currency: "EUR",
    notes: null,
    tags: ["Sommer"],
    companions: ["Anna"],
    tripId: "trip-7",
    trip: { id: "trip-7", name: "Japan 2024", color: "#fff" },
    bookingId: null,
    stops: [
      {
        id: "stop-1",
        cruiseId: "cruise-1",
        portId: 1,
        port: { id: 1, name: "Civitavecchia" },
        dayNumber: 1,
        isAtSea: false,
        arrivalTime: null,
        departureTime: "18:00",
        excursionNote: null,
        unresolvedPortName: null,
      },
      {
        id: "stop-2",
        cruiseId: "cruise-1",
        portId: null,
        port: null,
        dayNumber: 2,
        isAtSea: true,
        arrivalTime: null,
        departureTime: null,
        excursionNote: null,
        unresolvedPortName: null,
      },
    ],
    createdAt: "",
    updatedAt: "",
    ...over,
  } as unknown as Cruise;
}

function makePlace(over: Partial<Place> = {}): Place {
  return {
    id: "place-1",
    name: "Tokyo Skytree",
    category: "landmark",
    lat: 35.7101,
    lon: 139.8107,
    address: null,
    city: "Tokyo",
    country: "Japan",
    isoCountryCode: "JP",
    externalRef: null,
    curatedItemId: null,
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    visits: [
      { id: "visit-1", placeId: "place-1", tripId: null, visitedAt: "2024-04-05",
        orderIdx: 0, notes: "Abends", rating: 5, createdAt: "", updatedAt: "" },
    ],
    visitCount: 1,
    plannedVisitCount: 0,
    lastVisitAt: "2024-04-05",
    ...over,
  } as unknown as Place;
}

function makeLodging(over: Partial<Lodging> = {}): Lodging {
  return {
    id: "lodging-1",
    userId: "u1",
    type: "hotel",
    name: "Hotel Okura",
    chainId: null,
    chain: null,
    address: "2-10-4 Toranomon",
    city: "Tokyo",
    country: "Japan",
    isoCountryCode: "JP",
    lat: 35.6672,
    lon: 139.7452,
    stars: 5,
    amenities: ["wifi"],
    notes: null,
    visited: true,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    stays: [],
    overallRating: null,
    stayCount: 0,
    nights: 0,
    totalSpendBase: 0,
    totalSpendBaseByCurrency: {},
    ...over,
  } as unknown as Lodging;
}

describe("reference cells", () => {
  it("writes a readable name with the resolvable id behind it", () => {
    expect(refCell("Japan 2024", "trip-7")).toBe("Japan 2024 [trip-7]");
  });

  it("still carries the id when there is no name to show", () => {
    expect(refCell(null, "trip-7")).toBe("[trip-7]");
  });

  it("reads the id back after the name half was edited", () => {
    // The whole point: someone renames the readable part in Excel and the row
    // must still resolve to the same trip.
    expect(parseRefCell("Japan-Reise, umbenannt [trip-7]")).toBe("trip-7");
  });

  it("yields null for a cell with no brackets rather than guessing from a name", () => {
    // Guessing by name is how one trip silently becomes two.
    expect(parseRefCell("Japan 2024")).toBeNull();
  });

  it("yields null for an empty cell", () => {
    expect(parseRefCell("")).toBeNull();
    expect(parseRefCell(null)).toBeNull();
  });
});

describe("safeSheetName", () => {
  // Found by these very tests: exceljs THROWS on a name containing any of
  // * ? : \ / [ ], and the name comes from a translation file. A translator
  // writing "Orte / Besuche" would break the export in that language only,
  // while every test stayed green reading English keys.
  it.each([
    ["Orte / Besuche", "Orte - Besuche"],
    ["Doppel:punkt", "Doppel-punkt"],
    ["Fl[ü]ge", "Fl-ü-ge"],
    ["Frage?", "Frage-"],
    ["Stern*", "Stern-"],
    ["A\\B", "A-B"],
  ])("replaces the characters Excel refuses: %s", (raw, expected) => {
    expect(safeSheetName(raw, new Set())).toBe(expected);
  });

  it("leaves an ordinary name alone", () => {
    expect(safeSheetName("Flüge", new Set())).toBe("Flüge");
  });

  it("truncates past Excel's 31-character limit", () => {
    const long = "Ein sehr langer Blattname der weit über das Limit geht";
    expect(safeSheetName(long, new Set()).length).toBeLessThanOrEqual(31);
  });

  it("deduplicates names that collide after truncation", () => {
    const taken = new Set<string>();
    const a = safeSheetName("Flüge", taken);
    const b = safeSheetName("Flüge", taken);
    expect(a).not.toBe(b);
  });

  it("falls back rather than producing an empty name", () => {
    expect(safeSheetName("///", new Set())).not.toBe("");
  });
});

describe("workbook round trip", () => {
  it("writes a sheet per domain and reads every row back", async () => {
    const sheets = buildSheets(t, {
      cruises: [makeCruise()],
      lodging: [makeLodging()],
      places: [makePlace()],
    });

    const wb = await buildWorkbook(sheets);
    const buffer = await wb.xlsx.writeBuffer();

    const parsed = await parseWorkbook(buffer as ArrayBuffer, [
      cruiseSheet(t),
      lodgingSheet(t),
      placeSheet(t),
      placeVisitSheet(t),
    ] as never[]);

    const byKey = new Map(parsed.map((p) => [p.key, p.rows]));
    expect(byKey.get("cruises")).toHaveLength(1);
    expect(byKey.get("lodging")).toHaveLength(1);
    expect(byKey.get("places")).toHaveLength(1);
    expect(byKey.get("placeVisits")).toHaveLength(1);
  });

  it("keeps the id, so a re-imported row can find its record", async () => {
    const sheets = buildSheets(t, { places: [makePlace()] });
    const wb = await buildWorkbook(sheets);
    const buffer = await wb.xlsx.writeBuffer();

    const [places] = await parseWorkbook(buffer as ArrayBuffer, [placeSheet(t)] as never[]);
    expect(places.rows[0].id).toBe("place-1");
    expect(places.rows[0].name).toBe("Tokyo Skytree");
  });

  it("keeps a reference resolvable across the round trip", async () => {
    const sheets = buildSheets(t, { cruises: [makeCruise()] });
    const wb = await buildWorkbook(sheets);
    const buffer = await wb.xlsx.writeBuffer();

    const [cruises] = await parseWorkbook(buffer as ArrayBuffer, [cruiseSheet(t)] as never[]);
    expect(parseRefCell(cruises.rows[0].tripId)).toBe("trip-7");
  });

  it("gives child tables their own sheet instead of flattening them", async () => {
    // A cruise has as many stops as it has; a column cannot hold "as many".
    const sheets = buildSheets(t, { cruises: [makeCruise()] });
    const keys = sheets.map((s) => (s.spec as { key: string }).key);
    expect(keys).toContain("cruises");
    expect(keys).toContain("cruiseStops");
  });

  it("writes a sea day and a port call distinguishably", async () => {
    const sheets = buildSheets(t, { cruises: [makeCruise()] });
    const wb = await buildWorkbook(sheets);
    // Look it up the way the writer named it — the raw key contains a colon,
    // which sanitisation replaces.
    const ws = wb.getWorksheet(safeSheetName("xlsx:sheets.cruiseStops", new Set()));
    expect(ws).toBeDefined();
    // hint row + header + 2 stops
    expect(ws?.rowCount).toBe(4);
  });

  it("omits a domain that has no rows rather than shipping an empty tab", () => {
    const sheets = buildSheets(t, { places: [makePlace()] });
    const keys = sheets.map((s) => (s.spec as { key: string }).key);
    expect(keys).not.toContain("cruises");
    expect(keys).not.toContain("lodging");
  });

  it("returns no sheets at all when there is nothing to export", () => {
    expect(buildSheets(t, {})).toHaveLength(0);
  });

  it("skips a sheet the specs do not know instead of failing the whole read", async () => {
    const sheets = buildSheets(t, { places: [makePlace()] });
    const wb = await buildWorkbook(sheets);
    wb.addWorksheet("Meine eigenen Notizen").addRow(["irgendwas"]);
    const buffer = await wb.xlsx.writeBuffer();

    const parsed = await parseWorkbook(buffer as ArrayBuffer, [placeSheet(t)] as never[]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("places");
  });
});

describe("exportFilename", () => {
  it("carries the date so files sort chronologically", () => {
    expect(exportFilename(t, new Date("2026-08-28T10:00:00Z"))).toBe(
      "xlsx:export.filename-2026-08-28.xlsx",
    );
  });
});
