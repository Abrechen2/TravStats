import { describe, expect, it } from "vitest";

import { buildWorkbook, parseWorkbook } from "../workbook";
import { parseRefCell } from "../sheetSpec";
import { buildSheets } from "../exportAll";
import { roadtripSheet, roadtripStationSheet } from "../roadtripSheets";
import type { RoadtripDetail } from "../../../types/roadtrip";

const t = (key: string): string => key;

function detail(over: Partial<RoadtripDetail["nights"]> = {}): RoadtripDetail {
  const station = (id: string, title: string, state: "stay" | "free" | "pass", stay?: string) => ({
    id,
    title,
    lat: 60,
    lon: 7,
    startDate: "2026-09-18T00:00:00.000Z",
    endDate: null,
    notes: null,
    order: 0,
    state,
    lodgingStayId: stay ?? null,
    stay: stay
      ? {
          id: stay,
          lodgingId: "l1",
          lodgingName: "Mosvangen Camping",
          lodgingType: "campsite",
          city: null,
          country: null,
          checkIn: null,
          checkOut: null,
          nights: 3,
          status: "completed",
        }
      : null,
  });
  return {
    roadtrip: {
      id: "rt-1",
      name: "Fjorde 2026",
      vehicle: "campervan",
      vehicleName: "Bulli Fritz",
      drivenKm: 1370.4,
      distanceKm: 1542,
      startOdometerKm: 84210,
      endOdometerKm: null,
      notes: null,
    } as never,
    countries: ["NO"],
    trip: null,
    startDate: "2026-09-18T00:00:00.000Z",
    endDate: "2026-09-28T00:00:00.000Z",
    nights: {
      stayNights: 8,
      freeNights: 2,
      nights: 10,
      nightsKnown: true,
      placesSlept: 6,
      ...over,
    },
    stations: [
      station("s1", "Hamburg", "pass"),
      station("s2", "Stavanger", "stay", "stay-1"),
      station("s3", "Kaupanger", "free"),
    ],
    legs: [],
    tours: [],
    routingAvailable: true,
  };
}

describe("roadtrip sheets", () => {
  it("round-trips a roadtrip and its stations with order, night and stay reference", async () => {
    const wb = await buildWorkbook(buildSheets(t, { roadtrips: [detail()] }));
    const buffer = await wb.xlsx.writeBuffer();
    const [roadtrips, stations] = await parseWorkbook(
      buffer as ArrayBuffer,
      [roadtripSheet(t), roadtripStationSheet(t)] as never[]
    );

    expect(roadtrips.rows[0]).toMatchObject({
      id: "rt-1",
      name: "Fjorde 2026",
      vehicle: "campervan",
    });
    expect(stations.rows.map((r) => [r.order, r.title, r.night])).toEqual([
      ["1", "Hamburg", "pass"],
      ["2", "Stavanger", "stay"],
      ["3", "Kaupanger", "free"],
    ]);
    expect(parseRefCell(stations.rows[0].roadtripId)).toBe("rt-1");
    expect(parseRefCell(stations.rows[1].lodgingStayId)).toBe("stay-1");
  });

  it("leaves a night total that is only a lower bound empty rather than writing a number to sum", async () => {
    const wb = await buildWorkbook(buildSheets(t, { roadtrips: [detail({ nightsKnown: false })] }));
    const buffer = await wb.xlsx.writeBuffer();
    const [roadtrips] = await parseWorkbook(buffer as ArrayBuffer, [roadtripSheet(t)] as never[]);
    expect(roadtrips.rows[0].nights ?? "").toBe("");
  });
});
