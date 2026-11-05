import { foldRecordedFields } from "../recordedFields";
import { row } from "./fixtures";

const d = (iso: string) => new Date(`${iso}:00.000Z`);

describe("foldRecordedFields", () => {
  it("abstains (null, not 0) when no counted flight carries any of the fields", () => {
    const out = foldRecordedFields([
      row("FRA", "LIS", "2024-01-01T08:00", "2024-01-01T11:00"),
      row("LIS", "FRA", "2024-01-05T08:00", "2024-01-05T11:00"),
    ]);
    expect(out).toEqual({ airborne: null, overflown: null, codeshare: null });
  });

  it("sums wheels-off to wheels-on only, and reports 'n of m' instead of extrapolating", () => {
    const out = foldRecordedFields([
      // block 3 h, airborne 2 h 30
      row("FRA", "LIS", "2024-01-01T08:00", "2024-01-01T11:00", {
        runwayDepartureTime: d("2024-01-01T08:20"),
        runwayArrivalTime: d("2024-01-01T10:50"),
      }),
      // no runway times: block time must NOT stand in for them
      row("LIS", "FRA", "2024-01-05T08:00", "2024-01-05T11:00"),
      // only one runway time: not measured
      row("FRA", "MUC", "2024-01-06T08:00", "2024-01-06T09:00", {
        runwayDepartureTime: d("2024-01-06T08:10"),
      }),
      // reversed order: not measured
      row("MUC", "FRA", "2024-01-07T08:00", "2024-01-07T09:00", {
        runwayDepartureTime: d("2024-01-07T08:50"),
        runwayArrivalTime: d("2024-01-07T08:10"),
      }),
    ]);
    expect(out.airborne).toEqual({ minutes: 150, flights: 1, of: 4 });
  });

  it("leaves a scheduled or cancelled flight out of every figure", () => {
    const out = foldRecordedFields([
      row("FRA", "LIS", "2030-01-01T08:00", "2030-01-01T11:00", {
        status: "scheduled",
        runwayDepartureTime: d("2030-01-01T08:20"),
        runwayArrivalTime: d("2030-01-01T10:50"),
        overflownCountries: ["Spain"],
        isCodeshare: true,
        operatingAirline: "TAP",
      }),
    ]);
    expect(out).toEqual({ airborne: null, overflown: null, codeshare: null });
  });

  it("counts distinct countries once across spellings and codes, and ignores blanks", () => {
    const out = foldRecordedFields([
      row("FRA", "LIS", "2024-01-01T08:00", "2024-01-01T11:00", {
        overflownCountries: ["Germany", "France", " ", "Spain"],
      }),
      row("LIS", "FRA", "2024-01-05T08:00", "2024-01-05T11:00", {
        overflownCountries: ["germany ", "Portugal", "DE", "Deutschland"],
      }),
      row("FRA", "MUC", "2024-01-06T08:00", "2024-01-06T09:00", { overflownCountries: [] }),
    ]);
    expect(out.overflown).toEqual({
      // "Germany", "germany", "DE" and "Deutschland" are one country, keyed by ISO code.
      countries: ["DE", "ES", "FR", "PT"],
      flights: 2,
      of: 3,
    });
  });

  it("shares codeshares over the flights whose provider said so, never over all", () => {
    const out = foldRecordedFields([
      row("FRA", "LIS", "2024-01-01T08:00", "2024-01-01T11:00", {
        isCodeshare: true,
        operatingAirline: "TAP Air Portugal",
      }),
      row("LIS", "FRA", "2024-01-05T08:00", "2024-01-05T11:00", {
        isCodeshare: true,
        operatingAirline: "tap air portugal",
      }),
      row("FRA", "MUC", "2024-01-06T08:00", "2024-01-06T09:00", {
        isCodeshare: true,
        operatingAirline: "Eurowings",
      }),
      row("MUC", "FRA", "2024-01-07T08:00", "2024-01-07T09:00", { isCodeshare: false }),
      // codeshare but the operator is unnamed: counted, not listed
      row("FRA", "MUC", "2024-01-08T08:00", "2024-01-08T09:00", { isCodeshare: true }),
      // provider never said: outside `known`
      row("MUC", "FRA", "2024-01-09T08:00", "2024-01-09T09:00"),
    ]);
    expect(out.codeshare).toEqual({
      codeshare: 4,
      known: 5,
      of: 6,
      operators: [
        { name: "TAP Air Portugal", flights: 2 },
        { name: "Eurowings", flights: 1 },
      ],
    });
  });

  it("reports a real 0 codeshare share when flights say they are not one", () => {
    const out = foldRecordedFields([
      row("FRA", "LIS", "2024-01-01T08:00", "2024-01-01T11:00", { isCodeshare: false }),
    ]);
    expect(out.codeshare).toEqual({ codeshare: 0, known: 1, of: 1, operators: [] });
  });
});
