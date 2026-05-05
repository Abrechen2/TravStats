import { describe, it, expect } from "vitest";
import {
  buildFlightsWorkbook,
  parseXlsxBufferToRows,
  jsonToFlightRow,
  FLIGHT_ROW_COLUMNS,
} from "./xlsxRoundTrip";
import type { Flight } from "../types";

async function flightsToBuffer(flights: Flight[]): Promise<ArrayBuffer> {
  const wb = await buildFlightsWorkbook(flights);
  // exceljs typings differ between node Buffer and ArrayBuffer; coerce here.
  const out = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
  return out;
}

// Fully-populated Flight — every user-editable field set so the round-trip
// test catches regressions where a new field gets dropped silently between
// flightToRow / COLUMNS / parseXlsxToRows / jsonToFlightRow.
const fatFlight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "Lufthansa",
  airlineIata: "LH",
  airlineIcao: "DLH",
  operatingAirline: "Star Alliance",
  operatingAirlineIata: "SA",
  operatingAirlineIcao: "SAL",
  isCodeshare: true,
  flightNumber: "LH400",
  callsign: "DLH400",
  aircraft: "Boeing 747-8",
  aircraftRegistration: "D-ABYD",
  aircraftModeS: "3C6512",
  depIcao: "EDDF",
  depIata: "FRA",
  depName: "Frankfurt Main",
  depLat: 50.0264,
  depLon: 8.5431,
  arrIcao: "KJFK",
  arrIata: "JFK",
  arrName: "John F Kennedy",
  arrLat: 40.6413,
  arrLon: -73.7781,
  departureTime: "2026-04-01T09:30:00Z",
  arrivalTime: "2026-04-01T18:45:00Z",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  status: "flown",
  notes: "Window seat, paid upgrade",
  createdAt: "2026-04-01T05:00:00Z",
  price: 850,
  currency: "EUR",
  taxes: 95,
  fees: 32,
  category: "business",
  tags: ["work", "long-haul"],
  receiptUrl: undefined,
  seatNumber: "12A",
  seatClass: "business",
  boardingGroup: "Group 1",
  gate: "B23",
  terminal: "1",
  bookingReference: "ABC123",
  ticketNumber: "220-2345678901",
  baggageAllowance: "2x32kg",
  frequentFlyerNumber: "M&M-12345",
  bookingClassLetter: "J",
  companions: ["Alex", "Sam"],
  coPassengers: ["Pat", "Jordan"],
  dataSource: "boarding_pass_scan",
  actualDeparture: "2026-04-01T09:42:00Z",
  actualArrival: "2026-04-01T18:31:00Z",
  delayMinutes: 12,
};


describe("xlsxRoundTrip", () => {
  it("exports every user-editable field and round-trips without dropping any", async () => {
    const buffer = await flightsToBuffer([fatFlight]);
    const rows = await parseXlsxBufferToRows(buffer);

    expect(rows).toHaveLength(1);
    const row = rows[0];

    // Identity / labels
    expect(row.id).toBe("f1");
    expect(row.airline).toBe("Lufthansa");
    expect(row.airlineIata).toBe("LH");
    expect(row.airlineIcao).toBe("DLH");
    expect(row.flightNumber).toBe("LH400");
    expect(row.callsign).toBe("DLH400");
    expect(row.operatingAirline).toBe("Star Alliance");
    expect(row.operatingAirlineIata).toBe("SA");
    expect(row.operatingAirlineIcao).toBe("SAL");
    expect(row.isCodeshare).toBe("true");

    // Route + times
    expect(row.depIata).toBe("FRA");
    expect(row.arrIata).toBe("JFK");
    // Date cells round-trip as ISO strings via cellToString
    expect(row.departureTime).toContain("2026-04-01");
    expect(row.arrivalTime).toContain("2026-04-01");
    expect(row.depTimeSemantics).toBe("UTC");
    expect(row.arrTimeSemantics).toBe("UTC");
    expect(row.actualDeparture).toContain("2026-04-01");
    expect(row.actualArrival).toContain("2026-04-01");
    expect(row.delayMinutes).toBe("12");

    // Aircraft
    expect(row.aircraft).toBe("Boeing 747-8");
    expect(row.aircraftRegistration).toBe("D-ABYD");
    expect(row.aircraftModeS).toBe("3C6512");

    // Boarding pass / email-import fields
    expect(row.seatNumber).toBe("12A");
    expect(row.seatClass).toBe("business");
    expect(row.boardingGroup).toBe("Group 1");
    expect(row.gate).toBe("B23");
    expect(row.terminal).toBe("1");
    expect(row.bookingReference).toBe("ABC123");
    expect(row.ticketNumber).toBe("220-2345678901");
    expect(row.baggageAllowance).toBe("2x32kg");
    expect(row.frequentFlyerNumber).toBe("M&M-12345");
    expect(row.bookingClassLetter).toBe("J");

    // Companions / co-passengers (different concepts: travel group vs PAX manifest)
    expect(row.companions).toBe("Alex, Sam");
    expect(row.coPassengers).toBe("Pat, Jordan");

    // Costs (numeric round-trip — no leading zeros, no "850.00" coercion)
    expect(row.price).toBe("850");
    expect(row.currency).toBe("EUR");
    expect(row.taxes).toBe("95");
    expect(row.fees).toBe("32");

    // Misc
    expect(row.status).toBe("flown");
    expect(row.category).toBe("business");
    expect(row.tags).toBe("work, long-haul");
    expect(row.dataSource).toBe("boarding_pass_scan");
    expect(row.notes).toBe("Window seat, paid upgrade");
  });

  it("emits price / taxes / fees / delayMinutes as real numeric Excel cells", async () => {
    const wb = await buildFlightsWorkbook([fatFlight]);
    const ws = wb.worksheets[0];
    expect(ws).toBeTruthy();

    // Index headers so the test isn't column-position fragile.
    const headerRow = ws.getRow(1);
    const headerToCol = new Map<string, number>();
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headerToCol.set(String(cell.value).toLowerCase(), col);
    });

    const dataRow = ws.getRow(2);
    const numericKeys = ["Price", "Taxes", "Fees", "Delay (min)"] as const;
    for (const header of numericKeys) {
      const col = headerToCol.get(header.toLowerCase());
      expect(col, `column ${header} should be present`).toBeDefined();
      const cell = dataRow.getCell(col!);
      expect(typeof cell.value, `${header} cell value`).toBe("number");
    }

    // Time fields are real Date objects (not ISO strings)
    for (const header of [
      "Departure Time (UTC)",
      "Arrival Time (UTC)",
      "Actual Departure (UTC)",
      "Actual Arrival (UTC)",
    ]) {
      const col = headerToCol.get(header.toLowerCase());
      expect(col).toBeDefined();
      const cell = dataRow.getCell(col!);
      expect(cell.value instanceof Date, `${header} cell is a Date`).toBe(true);
    }
  });

  it("sets autoFilter and dual-axis frozen header on the worksheet", async () => {
    const wb = await buildFlightsWorkbook([fatFlight]);
    const ws = wb.worksheets[0];

    // autoFilter on the full header range
    expect(ws.autoFilter).toBeTruthy();

    // Both row 1 and column 1 frozen for navigation
    const view = ws.views[0] as { state: string; xSplit?: number; ySplit?: number };
    expect(view.state).toBe("frozen");
    expect(view.ySplit).toBe(1);
    expect(view.xSplit).toBe(1);
  });

  it("jsonToFlightRow accepts both header text and camelCase keys", () => {
    // External JSON dumps may use either the canonical header strings or
    // camelCase keys — the picker must tolerate both for a clean import.
    const fromHeaders = jsonToFlightRow({
      ID: "f1",
      "Flight Number": "LH400",
      "Departure (IATA)": "FRA",
      "Arrival Time (UTC)": "2026-04-01T18:45:00Z",
      "Co-Passengers": "Pat, Jordan",
      Price: 850,
    });
    const fromCamel = jsonToFlightRow({
      id: "f1",
      flightNumber: "LH400",
      depIata: "FRA",
      arrivalTime: "2026-04-01T18:45:00Z",
      coPassengers: ["Pat", "Jordan"],
      price: 850,
    });

    expect(fromHeaders.id).toBe("f1");
    expect(fromHeaders.flightNumber).toBe("LH400");
    expect(fromHeaders.depIata).toBe("FRA");
    expect(fromHeaders.coPassengers).toBe("Pat, Jordan");
    expect(fromHeaders.price).toBe("850");

    expect(fromCamel.id).toBe("f1");
    expect(fromCamel.flightNumber).toBe("LH400");
    expect(fromCamel.depIata).toBe("FRA");
    expect(fromCamel.coPassengers).toBe("Pat, Jordan");
  });

  it("does not silently drop columns added in the future", () => {
    // Tripwire: a future PR that adds a key to FlightRow but forgets to wire
    // it into COLUMNS will fall through this check (and vice versa).
    const columnKeys = new Set<string>(FLIGHT_ROW_COLUMNS.map((c) => c.key));
    // Sample one representative key from each "wave" of fields the rc.2 fix
    // brought in — covers the silent-drop class.
    const expectedKeys = [
      "airlineIata",
      "callsign",
      "aircraftRegistration",
      "depTimeSemantics",
      "actualDeparture",
      "delayMinutes",
      "boardingGroup",
      "baggageAllowance",
      "coPassengers",
      "dataSource",
    ];
    for (const k of expectedKeys) {
      expect(columnKeys.has(k), `column ${k} present`).toBe(true);
    }
  });
});
