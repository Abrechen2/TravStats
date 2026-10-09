import { describe, it, expect } from "vitest";

import { buildWorkbook, parseWorkbook } from "../workbook";
import { parseRefCell } from "../sheetSpec";
import { buildSheets } from "../exportAll";
import { rentalSheet } from "../rentalSheet";
import { importableSpecs, readWorkbookForImport } from "../importClient";
import { makeRental } from "../../../components/rental/__tests__/rentalFixture";
import type { RentalBooking } from "../../../types/rental";
import type { TimeValue } from "../../../shared/time";
import de from "../../../i18n/resources/de/xlsx.json";
import en from "../../../i18n/resources/en/xlsx.json";

/**
 * The rental sheet (forgejo#267): what the writer puts in a cell is what
 * `backend/src/services/xlsxImport/rentals.ts` reads — the backend test
 * `importRentals.test.ts` builds its rows in this same shape.
 */
const t = (key: string): string => key;

const lookup =
  (resources: Record<string, unknown>) =>
  (key: string): string => {
    const path = key.replace(/^xlsx:/, "").split(".");
    let node: unknown = resources;
    for (const p of path) node = (node as Record<string, unknown>)?.[p];
    return typeof node === "string" ? node : key;
  };

const at = (utc: string, local: string, offset: string, precision = "minute"): TimeValue =>
  ({ utc, zone: "Europe/Berlin", offset, local, precision, zoneSource: "stored" }) as TimeValue;

const rental = (over: Partial<RentalBooking> = {}): RentalBooking =>
  makeRental({
    id: "rental-1",
    price: 120,
    currency: "EUR",
    finalAmount: 150.5,
    finalCurrency: "EUR",
    finalAmountSource: "invoice",
    depositAmount: 300,
    depositCurrency: "USD",
    depositPaidOn: "2025-10-24",
    depositReturnedOn: "2025-11-02",
    depositReturnedAmount: 250,
    inclusions: ["cdw", "gps"],
    tripId: "trip-7",
    trip: { id: "trip-7", name: "Herbst", color: "#fff" },
    times: {
      pickup: at("2025-10-24T08:00:00.000Z", "2025-10-24T10:00:00", "+02:00"),
      return: at("2025-10-27T08:30:00.000Z", "2025-10-27T09:30:00", "+01:00"),
      actualPickup: null,
      // 02:30 happened twice that night; this is the second (CET).
      actualReturn: at("2025-10-26T01:30:00.000Z", "2025-10-26T02:30:00", "+01:00"),
    },
    ...over,
  });

async function roundTrip(rentals: RentalBooking[]): Promise<Record<string, string>[]> {
  const wb = await buildWorkbook(buildSheets(t, { rentals }));
  const buffer = await wb.xlsx.writeBuffer();
  const [sheet] = await parseWorkbook(buffer as ArrayBuffer, [rentalSheet(t)] as never[]);
  return sheet.rows;
}

describe("rental sheet", () => {
  it("writes one row per rental with its id and the trip as a reference", async () => {
    const [row] = await roundTrip([rental()]);
    expect(row.id).toBe("rental-1");
    expect(row.provider).toBe("Testcar");
    expect(parseRefCell(row.tripId)).toBe("trip-7");
  });

  it("writes each time on its station's clock with its precision and occurrence", async () => {
    const [row] = await roundTrip([rental()]);
    expect(row.pickupLocal).toBe("2025-10-24T10:00:00.000Z");
    expect(row.pickupPrecision).toBe("minute");
    expect(row.pickupFold).toBe("");
    expect(row.actualReturnLocal).toBe("2025-10-26T02:30:00.000Z");
    expect(row.actualReturnFold).toBe("later");
    expect(row.actualPickupLocal).toBe("");
  });

  it("says a day-only time is only a day", async () => {
    const [row] = await roundTrip([
      rental({
        times: {
          ...rental().times,
          return: at("2025-10-26T23:00:00.000Z", "2025-10-27T00:00:00", "+01:00", "day"),
        },
      }),
    ]);
    expect(row.returnPrecision).toBe("day");
    expect(row.returnFold).toBe("");
  });

  it("keeps money, its sources and the deposit apart, and unknown values empty", async () => {
    const [row] = await roundTrip([rental({ odometerOutKm: null, distanceKm: null })]);
    expect(row).toMatchObject({
      price: "120",
      finalAmount: "150.5",
      finalAmountSource: "invoice",
      depositAmount: "300",
      depositCurrency: "USD",
      depositReturnedAmount: "250",
      inclusions: "cdw, gps",
      odometerOutKm: "",
      distanceKm: "",
    });
    expect(row.depositPaidOn.slice(0, 10)).toBe("2025-10-24");
  });

  it("names every column uniquely in both languages, so a column is found by its header", () => {
    for (const resources of [de, en]) {
      const headers = rentalSheet(lookup(resources)).columns.map((c) => c.header);
      expect(new Set(headers).size).toBe(headers.length);
      expect(headers.some((h) => h.startsWith("columns."))).toBe(false);
    }
  });
});

describe("rental sheet in the workbook", () => {
  it("is the only sheet of a rental-only account", () => {
    expect(buildSheets(t, { rentals: [rental()] }).map((s) => s.spec.key)).toEqual(["rental"]);
  });

  it("sits beside the other domains' sheets", () => {
    const keys = buildSheets(t, {
      rentals: [rental()],
      rail: [{ id: "r" } as never],
    }).map((s) => s.spec.key);
    expect(keys).toEqual(["rail", "rental"]);
  });

  it("is not written, nor read, while the rental domain is hidden", async () => {
    expect(buildSheets(t, { rentals: [] })).toEqual([]);
    expect(importableSpecs(t).map((s) => s.key)).not.toContain("rental");
    expect(importableSpecs(t, { rental: true }).map((s) => s.key)).toContain("rental");
    const wb = await buildWorkbook(buildSheets(t, { rentals: [rental()] }));
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const file = { arrayBuffer: async () => buffer } as unknown as File;
    expect(await readWorkbookForImport(t, file, { rental: false })).toEqual([]);
    expect((await readWorkbookForImport(t, file, { rental: true })).map((s) => s.key)).toEqual([
      "rental",
    ]);
  });
});
