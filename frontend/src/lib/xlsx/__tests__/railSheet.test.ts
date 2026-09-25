import { describe, it, expect } from "vitest";

import { buildWorkbook, parseWorkbook } from "../workbook";
import { parseRefCell } from "../sheetSpec";
import { buildSheets } from "../exportAll";
import { railSheet } from "../railSheet";
import { importableSpecs } from "../importClient";
import type { RailJourney } from "../../../types/rail";

const t = (key: string): string => key;

const ride = (over: Partial<RailJourney> = {}): RailJourney =>
  ({
    id: "rail-1",
    operator: "ÖBB",
    trainCategory: "NJ",
    trainNumber: "466",
    depStationName: "Wien Hbf",
    depLat: 48.1852,
    depLon: 16.3776,
    arrLat: 47.378,
    arrLon: 8.54,
    depStationCode: "8103000",
    arrStationName: "Zürich HB",
    arrStationCode: "8503000",
    // 22:58 on Vienna's clock is 21:58 UTC; 08:20 in Zurich is 07:20 UTC.
    departureTime: "2025-12-31T21:58:00.000Z",
    arrivalTime: "2026-01-01T07:20:00.000Z",
    depTimezone: "Europe/Vienna",
    arrTimezone: "Europe/Zurich",
    status: "completed",
    distanceKm: 598.4,
    distanceSource: "great_circle",
    delayMinutes: null,
    travelClass: "second",
    coach: "24",
    seat: "15",
    price: 89.9,
    currency: "EUR",
    bookingReference: "NJ1234",
    tripId: "trip-7",
    trip: { id: "trip-7", name: "Silvester", color: "#fff" },
    companions: ["Anna"],
    tags: ["Nachtzug"],
    notes: null,
    ...over,
  }) as RailJourney;

async function roundTrip(rides: RailJourney[]): Promise<Record<string, string>[]> {
  const wb = await buildWorkbook(buildSheets(t, { rail: rides }));
  const buffer = await wb.xlsx.writeBuffer();
  const [sheet] = await parseWorkbook(buffer as ArrayBuffer, [railSheet(t)] as never[]);
  return sheet.rows;
}

describe("rail sheet", () => {
  it("writes one row per ride and keeps its id", async () => {
    const [row] = await roundTrip([ride()]);
    expect(row.id).toBe("rail-1");
    expect(row.depStationName).toBe("Wien Hbf");
    expect(row.arrStationCode).toBe("8503000");
  });

  it("writes times on each station's own clock, not in UTC", async () => {
    const [row] = await roundTrip([ride()]);
    // The cell holds the wall clock; read back as a Date its UTC fields are it.
    expect(row.departureTime).toBe("2025-12-31T22:58:00.000Z");
    expect(row.arrivalTime).toBe("2026-01-01T08:20:00.000Z");
  });

  it("says what a distance measures", async () => {
    const [row] = await roundTrip([ride()]);
    expect(row.distanceKm).toBe("598");
    expect(row.distanceSource).toBe("great_circle");
  });

  it("keeps the trip reference resolvable", async () => {
    const [row] = await roundTrip([ride()]);
    expect(parseRefCell(row.tripId)).toBe("trip-7");
  });

  // The importer places a station by its code, else by its position — a ride
  // at a station outside the catalogue, or one moved into another account,
  // has nothing else to come back by.
  it("carries each station's position for the way back", async () => {
    const [row] = await roundTrip([ride()]);
    expect([row.depLat, row.depLon, row.arrLat, row.arrLon]).toEqual([
      "48.1852",
      "16.3776",
      "47.378",
      "8.54",
    ]);
  });

  // Owner rule 2026-09-25: rail stays behind its beta gate, the import too.
  it("is read back only where rail is visible", () => {
    const keys = (rail?: boolean) =>
      importableSpecs(t, rail === undefined ? {} : { rail }).map((s) => (s as { key: string }).key);
    expect(keys()).not.toContain("rail");
    expect(keys(false)).not.toContain("rail");
    expect(keys(true)).toContain("rail");
  });

  it("adds no rail sheet when there are no rides to write", () => {
    const keys = buildSheets(t, { rail: [] }).map((s) => (s.spec as { key: string }).key);
    expect(keys).not.toContain("rail");
  });
});
