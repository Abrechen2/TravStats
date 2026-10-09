import { describe, it, expect } from "@jest/globals";
import { applyTransforms, TRANSFORMS } from "../transforms";

/**
 * The format-specific transforms that let the compiled-in lodging and airline
 * readers become template files (plan 2026-10-09 P4a). Each reads exactly one
 * layout and answers null for anything else — never a guess.
 */
describe("v2 document transforms", () => {
  it("englishDate reads month-first and day-first, and a year-less date only with a context year", () => {
    expect(TRANSFORMS.englishDate("November 25, 2022")).toBe("2022-11-25");
    expect(TRANSFORMS.englishDate("25 November 2022")).toBe("2022-11-25");
    expect(TRANSFORMS.englishDate("01, Oct. 2018")).toBe("2018-10-01");
    expect(TRANSFORMS.englishDate("Oct 01")).toBeNull();
    expect(TRANSFORMS.englishDate("Oct 01", { year: 2018 })).toBe("2018-10-01");
    expect(TRANSFORMS.englishDate("November 31, 2022")).toBeNull();
    expect(applyTransforms("Oct 01", "englishDate", { year: 2019 })).toBe("2019-10-01");
  });

  it("germanDate, numericDate and slashDayFirstDate each read their own layout only", () => {
    expect(TRANSFORMS.germanDate("10. März 2026")).toBe("2026-03-10");
    expect(TRANSFORMS.germanDate("31. April 2026")).toBeNull();
    expect(TRANSFORMS.numericDate("01.10.2026")).toBe("2026-10-01");
    expect(TRANSFORMS.numericDate("vom 01.10.2026")).toBeNull();
    expect(TRANSFORMS.numericDate("31.04.2026")).toBeNull();
    expect(TRANSFORMS.slashDayFirstDate("14/02/2017")).toBe("2017-02-14");
    expect(TRANSFORMS.slashDayFirstDate("02/14/2017")).toBeNull();
    expect(TRANSFORMS.slashDayFirstDate("14.02.2017")).toBeNull();
  });

  it("dateTime reads the airline forms and refuses a month it does not know", () => {
    expect(TRANSFORMS.dateTime("18 Sep 2025T07:25")).toBe("2025-09-18T07:25");
    expect(TRANSFORMS.dateTime("18. Oktober 2023 12:45")).toBe("2023-10-18T12:45");
    expect(TRANSFORMS.dateTime("23.05.2025T12:25")).toBe("2025-05-23T12:25");
    expect(TRANSFORMS.dateTime("17-Feb-14T09:10")).toBe("2014-02-17T09:10");
    expect(TRANSFORMS.dateTime("16. Mrz. 26T19:25")).toBe("2026-03-16T19:25");
    expect(TRANSFORMS.dateTime("18 Foo 2025T07:25")).toBeNull();
    expect(TRANSFORMS.dateTime("2025-09-18T07:25")).toBe("2025-09-18T07:25");
    expect(TRANSFORMS.dateTime("23.05.2025T25:99")).toBeNull();
  });

  it("airportName maps a known name and abstains on an unknown one", () => {
    expect(TRANSFORMS.airportName("München")).toBe("MUC");
    expect(TRANSFORMS.airportName("Atlantis")).toBeNull();
  });

  it("text helpers: capsTitleCase, firstDigits, dropFirstWord, stripTrailingSeparator, removeSpaces", () => {
    expect(TRANSFORMS.capsTitleCase("MUSTERSTADT")).toBe("Musterstadt");
    expect(TRANSFORMS.capsTitleCase("BAD-HOMBURG")).toBe("Bad-Homburg");
    expect(TRANSFORMS.capsTitleCase("McAllen")).toBe("McAllen");
    expect(TRANSFORMS.firstDigits("0260308 (gebucht am Mo. 9. Mrz 2026)")).toBe("0260308");
    expect(TRANSFORMS.firstDigits("keine")).toBeNull();
    expect(TRANSFORMS.dropFirstWord("Di. 10. März 2026")).toBe("10. März 2026");
    expect(TRANSFORMS.dropFirstWord("Di.")).toBe("Di.");
    expect(TRANSFORMS.stripTrailingSeparator("Musterstadt,")).toBe("Musterstadt");
    expect(TRANSFORMS.stripTrailingSeparator(";")).toBeNull();
    expect(TRANSFORMS.removeSpaces("LH  2316")).toBe("LH2316");
  });
});
