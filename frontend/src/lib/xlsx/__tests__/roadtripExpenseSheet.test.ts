import { describe, expect, it } from "vitest";

import { buildWorkbook, parseWorkbook } from "../workbook";
import { parseRefCell } from "../sheetSpec";
import { buildSheets } from "../exportAll";
import { importableSpecs } from "../importClient";
import { roadtripExpenseSheet } from "../roadtripExpenseSheet";
import type { RoadtripDetail } from "../../../types/roadtrip";
import type { TripExpense } from "../../../types/expense";

const t = (key: string): string => key;

const expense = (over: Partial<TripExpense>): TripExpense => ({
  id: "e1",
  tripId: null,
  routeId: "rt-1",
  stopId: null,
  legFromStopId: null,
  legToStopId: null,
  kind: "fuel",
  amount: 10,
  currency: "EUR",
  date: null,
  note: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

const station = (id: string, title: string) =>
  ({ id, title, lat: 60, lon: 7, state: "free" }) as RoadtripDetail["stations"][number];

const detail = (expenses: TripExpense[]): RoadtripDetail =>
  ({
    roadtrip: { id: "rt-1", name: "Fjorde 2026", drivenKm: 0, distanceKm: 0 },
    trip: null,
    startDate: null,
    endDate: null,
    nights: { stayNights: 0, freeNights: 0, nights: 0, nightsKnown: true, placesSlept: 0 },
    stations: [station("s1", "Hirtshals"), station("s2", "Kristiansand")],
    legs: [],
    tours: [],
    routingAvailable: false,
    countries: [],
    expenses,
    costs: { total: {}, byStation: [], byLeg: [], unpinned: {} },
  }) as unknown as RoadtripDetail;

describe("roadtrip cost sheet (forgejo#140)", () => {
  it("writes each cost with its roadtrip, station or leg, day and amount, and reads them back", async () => {
    const wb = await buildWorkbook(
      buildSheets(t, {
        roadtrips: [
          detail([
            expense({
              id: "pitch",
              kind: "pitch",
              amount: 35.5,
              currency: "DKK",
              stopId: "s1",
              date: "2026-07-15",
            }),
            expense({
              id: "toll",
              kind: "toll",
              amount: 12.5,
              legFromStopId: "s1",
              legToStopId: "s2",
              note: "Brücke",
            }),
          ]),
        ],
      })
    );
    const buffer = await wb.xlsx.writeBuffer();
    const [costs] = await parseWorkbook(
      buffer as ArrayBuffer,
      [roadtripExpenseSheet(t)] as never[]
    );

    expect(costs.rows.map((r) => [r.id, r.kind, r.amount, r.currency])).toEqual([
      ["pitch", "pitch", "35.5", "DKK"],
      ["toll", "toll", "12.5", "EUR"],
    ]);
    expect(parseRefCell(costs.rows[0].roadtripId)).toBe("rt-1");
    expect(parseRefCell(costs.rows[0].stopId)).toBe("s1");
    expect(costs.rows[0].date.slice(0, 10)).toBe("2026-07-15");
    expect(parseRefCell(costs.rows[1].legFromStopId)).toBe("s1");
    expect(parseRefCell(costs.rows[1].legToStopId)).toBe("s2");
    expect(costs.rows[1].note).toBe("Brücke");
  });

  it("writes no cost sheet for roadtrips without costs", () => {
    const keys = buildSheets(t, { roadtrips: [detail([])] }).map((s) => s.spec.key);
    expect(keys).not.toContain("roadtripExpenses");
  });

  it("is read back on import, right after the stations it points at", () => {
    const keys = importableSpecs(t).map((s) => (s as { key: string }).key);
    expect(keys.indexOf("roadtripExpenses")).toBe(keys.indexOf("roadtripStations") + 1);
  });
});
