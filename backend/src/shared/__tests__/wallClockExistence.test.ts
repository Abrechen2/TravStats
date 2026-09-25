import { wallClockExists } from "../wallClockExistence";

/**
 * SRV-TIMEZONE-GAP-001 (audit 2026-09-20): MUC 30.03.2025 02:30 was accepted
 * with a 201 and stored as 00:30Z; the detail page then read it back as
 * 01:30, an hour the user never typed.
 */
describe("wallClockExists", () => {
  it("says the skipped spring-forward hour does not exist (Europe/Berlin)", () => {
    // Berlin goes 02:00 CET -> 03:00 CEST on 2025-03-30.
    expect(wallClockExists("2025-03-30T02:30", "Europe/Berlin")).toBe(false);
    expect(wallClockExists("2025-03-30T02:00", "Europe/Berlin")).toBe(false);
    expect(wallClockExists("2025-03-30T02:59:59", "Europe/Berlin")).toBe(false);
  });

  it("keeps the hours on either side of the gap", () => {
    expect(wallClockExists("2025-03-30T01:59", "Europe/Berlin")).toBe(true);
    expect(wallClockExists("2025-03-30T03:00", "Europe/Berlin")).toBe(true);
  });

  it("accepts the autumn repeated hour — ambiguous is not impossible", () => {
    // 02:30 happens twice on 2025-10-26 in Berlin. One of the two readings is
    // stored; refusing the user's input would be the larger surprise.
    expect(wallClockExists("2025-10-26T02:30", "Europe/Berlin")).toBe(true);
  });

  it("finds the same gap where the clocks move at a different hour", () => {
    // Lord Howe shifts by 30 minutes, at 02:00 on 2025-10-05.
    expect(wallClockExists("2025-10-05T02:15", "Australia/Lord_Howe")).toBe(false);
    // Havana moves AT midnight — the case that makes a 00:00 placeholder
    // dangerous, and why DATE_ONLY rows are exempt in `schemas/flight.ts`.
    expect(wallClockExists("2025-03-09T00:30", "America/Havana")).toBe(false);
  });

  it("leaves an ordinary time in a zone with no DST alone", () => {
    expect(wallClockExists("2025-03-30T02:30", "Asia/Tokyo")).toBe(true);
    expect(wallClockExists("2025-03-30T02:30", "UTC")).toBe(true);
  });

  it("abstains rather than accusing when the zone itself is unusable", () => {
    expect(wallClockExists("2025-03-30T02:30", "Not/AZone")).toBe(true);
  });
});
