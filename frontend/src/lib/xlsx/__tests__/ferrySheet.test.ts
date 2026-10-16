import { describe, it, expect } from "vitest";

import { buildWorkbook, parseWorkbook } from "../workbook";
import { parseRefCell } from "../sheetSpec";
import { buildSheets } from "../exportAll";
import { ferrySheet } from "../ferrySheet";
import { importableSpecs } from "../importClient";
import type { FerryJourney } from "../../../types/ferry";

/**
 * Ferry was the one transport domain the workbook neither wrote nor read back.
 * The sheet carries the columns the server's ferry importer reads
 * (`backend/src/services/xlsxImport/ferry.ts`), each port's own clock and its
 * position.
 */
const t = (key: string): string => key;

const crossing = (over: Partial<FerryJourney> = {}): FerryJourney =>
  ({
    id: "ferry-1",
    operator: "Stena Line",
    vesselName: "Stena Germanica",
    vehicleType: "Pkw",
    vehicleRegistration: "KI-AB 123",
    passengerCount: 2,
    cabinType: "Außenkabine",
    ticketReference: "SL-998",
    depStationName: "Kiel",
    depAddress: null,
    depLat: 54.3233,
    depLon: 10.1394,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "Göteborg",
    arrAddress: null,
    arrLat: 57.7089,
    arrLon: 11.9746,
    arrCountry: "SE",
    arrTimezone: "Europe/Stockholm",
    // 18:45 in Kiel is 16:45 UTC; 09:15 in Göteborg is 07:15 UTC.
    departureTime: "2026-10-07T16:45:00.000Z",
    arrivalTime: "2026-10-08T07:15:00.000Z",
    status: "completed",
    distanceKm: 432.6,
    distanceSource: "great_circle",
    delayMinutes: null,
    fareClass: null,
    seat: null,
    price: 389,
    currency: "EUR",
    bookingReference: "ABC123",
    tripId: "trip-3",
    trip: { id: "trip-3", name: "Schweden", color: "#fff" },
    companions: ["Anna"],
    tags: [],
    notes: null,
    ...over,
  }) as FerryJourney;

async function roundTrip(rows: FerryJourney[]): Promise<Record<string, string>[]> {
  const wb = await buildWorkbook(buildSheets(t, { ferry: rows }));
  const buffer = await wb.xlsx.writeBuffer();
  const [sheet] = await parseWorkbook(buffer as ArrayBuffer, [ferrySheet(t)] as never[]);
  return sheet.rows;
}

describe("ferry sheet", () => {
  it("writes one row per crossing with its id and its ferry columns", async () => {
    const [row] = await roundTrip([crossing()]);
    expect(row.id).toBe("ferry-1");
    expect([row.vesselName, row.vehicleType, row.cabinType, row.passengerCount]).toEqual([
      "Stena Germanica",
      "Pkw",
      "Außenkabine",
      "2",
    ]);
    expect([row.depLat, row.arrLon]).toEqual(["54.3233", "11.9746"]);
    expect(parseRefCell(row.tripId)).toBe("trip-3");
  });

  it("writes times on each port's own clock, not in UTC", async () => {
    const [row] = await roundTrip([crossing()]);
    expect(row.departureTime).toBe("2026-10-07T18:45:00.000Z");
    expect(row.arrivalTime).toBe("2026-10-08T09:15:00.000Z");
  });

  it("writes no ferry sheet when there are no crossings", () => {
    expect(buildSheets(t, { ferry: [] }).map((s) => s.spec.key)).not.toContain("ferry");
  });

  it("is read back only where ferry is visible", () => {
    expect(importableSpecs(t).map((s) => s.key)).not.toContain("ferry");
    expect(importableSpecs(t, { ferry: true }).map((s) => s.key)).toContain("ferry");
  });
});
