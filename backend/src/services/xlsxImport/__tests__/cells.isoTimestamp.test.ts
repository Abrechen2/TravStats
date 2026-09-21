import { isoDate, isoTimestamp } from "../cells";

/**
 * SRV-EXPORT-001 (P2, beta audit 2026-09-20).
 *
 * A German Excel export re-imported BYTE FOR BYTE — merge mode, preview
 * clean — moved both visits of a place from 12:00 UTC to 00:00, and
 * `lastVisitAt` followed. Nothing in the file was wrong: exceljs writes a
 * real date cell and the reader hands it back as a full ISO timestamp. The
 * importer ran every date column through `isoDate`, which cuts the string at
 * ten characters, and `new Date("2025-07-10")` is midnight.
 *
 * Pure string handling, so this holds it without a database. The importer's
 * own suite needs one and lives next door.
 */
describe("a date cell that carries a clock", () => {
  it("keeps 12:00 through the round trip that used to flatten it to midnight", () => {
    expect(isoTimestamp("2025-07-10T12:00:00.000Z")).toBe("2025-07-10T12:00:00.000Z");
    // What the old code did, kept here so the difference is the test.
    expect(isoDate("2025-07-10T12:00:00.000Z")).toBe("2025-07-10");
  });

  it("reads a bare date as midnight, which is what a dateless visit means", () => {
    expect(isoTimestamp("2025-07-10")).toBe("2025-07-10T00:00:00.000Z");
  });

  it("still reads a hand-typed German date day-first, not month-first", () => {
    // 3 April, never 4 March. The UI's locale decides, and guessing the other
    // way would move a row by eleven months without complaining.
    expect(isoTimestamp("03.04.2024")).toBe("2024-04-03T00:00:00.000Z");
    expect(isoTimestamp("3.4.2024")).toBe("2024-04-03T00:00:00.000Z");
  });

  it("takes the clock a German cell puts after the date", () => {
    expect(isoTimestamp("03.04.2024 12:30")).toBe("2024-04-03T12:30:00.000Z");
    expect(isoTimestamp("03.04.2024 12:30:45")).toBe("2024-04-03T12:30:45.000Z");
  });

  it("says nothing about an empty cell, and refuses an unreadable one", () => {
    // undefined is "not mentioned" — an update leaves the stored value alone.
    // null is "this cell is wrong", which makes the caller refuse the row.
    expect(isoTimestamp("")).toBeUndefined();
    expect(isoTimestamp(undefined)).toBeUndefined();
    expect(isoTimestamp("   ")).toBeUndefined();
    expect(isoTimestamp("not a date")).toBeNull();
  });
});
