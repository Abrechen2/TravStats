import { describe, it, expect } from "vitest";
import i18n from "../../../i18n/config";
import { buildWorkbook } from "../workbook";
import { buildSheets } from "../exportAll";
import { readWorkbookForImport } from "../importClient";
import type { Flight } from "../../../types";

/**
 * forgejo#175 with the REAL translations: an English export carries the tab
 * "Flights" and English headers, and a German interface must still read it.
 * The stubbed-t tests in workbook.test.ts prove the order of attempts; this
 * one proves the real sheet and header copy line up.
 */
describe("Excel import across interface languages (real i18n)", () => {
  const flight = {
    id: "f-1",
    airline: "Lufthansa",
    flightNumber: "LH400",
    depIata: "FRA",
    arrIata: "JFK",
    departureTime: "2025-05-01T10:00:00.000Z",
    arrivalTime: "2025-05-01T18:00:00.000Z",
    status: "flown",
  } as unknown as Flight;

  it("reads an English export with a German interface", async () => {
    const en = i18n.getFixedT("en", ["xlsx", "common"]);
    const de = i18n.getFixedT("de", ["xlsx", "common"]);
    expect(en("xlsx:sheets.flights")).not.toBe(de("xlsx:sheets.flights"));

    const wb = await buildWorkbook(buildSheets(en, { flights: [flight] }));
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const file = { arrayBuffer: async () => buffer } as unknown as File;

    expect(await readWorkbookForImport(de, file)).toEqual([]);
    const payload = await readWorkbookForImport(de, file, {}, [en]);
    expect(payload.map((p) => p.key)).toEqual(["flights"]);
    expect(payload[0].rows[0]).toMatchObject({ flightNumber: "LH400" });
  });
});
