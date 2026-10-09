import { describe, it, expect } from "vitest";
import {
  exactDays,
  staysConflict,
  staysCoincide,
  staysOverlap,
  type StaySpan,
} from "../lodgingOverlap";

const stay = (
  checkIn: string | null,
  checkOut: string | null,
  over: Partial<StaySpan> = {}
): StaySpan => ({
  checkIn,
  checkOut,
  datePrecision: "DAY",
  cancelled: false,
  ...over,
});

describe("staysOverlap - the nights are [check-in, check-out)", () => {
  it("a check-out and a check-in on the SAME day are a hand-over, not an overlap", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-05"), stay("2026-07-05", "2026-07-08"))).toBe(
      false
    );
    expect(staysOverlap(stay("2026-07-05", "2026-07-08"), stay("2026-07-01", "2026-07-05"))).toBe(
      false
    );
  });

  it("shared nights overlap, whichever way round and whatever the containment", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-05"), stay("2026-07-04", "2026-07-08"))).toBe(
      true
    );
    expect(staysOverlap(stay("2026-07-04", "2026-07-08"), stay("2026-07-01", "2026-07-05"))).toBe(
      true
    );
    expect(staysOverlap(stay("2026-07-01", "2026-07-10"), stay("2026-07-03", "2026-07-04"))).toBe(
      true
    );
  });

  it("disjoint stays do not overlap", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-03"), stay("2026-07-10", "2026-07-12"))).toBe(
      false
    );
  });

  it("a single named day inside another stay overlaps it, on its edge it does not", () => {
    const week = stay("2026-07-01", "2026-07-08");
    expect(staysOverlap(week, stay("2026-07-04", "2026-07-04"))).toBe(true);
    expect(staysOverlap(week, stay("2026-07-08", "2026-07-08"))).toBe(false);
    expect(staysOverlap(week, stay("2026-07-01", null))).toBe(false);
    expect(staysOverlap(week, stay("2026-07-03", null))).toBe(true);
  });

  it("a cancelled stay occupies nothing, on either side", () => {
    const cancelled = stay("2026-07-01", "2026-07-05", { cancelled: true });
    const live = stay("2026-07-02", "2026-07-04");
    expect(staysOverlap(cancelled, live)).toBe(false);
    expect(staysOverlap(live, cancelled)).toBe(false);
    expect(staysConflict(cancelled, stay("2026-07-01", "2026-07-05", { cancelled: true }))).toBe(
      false
    );
  });

  it("only a stay that names exact days can overlap: month, year and undated never do", () => {
    const june = stay("2026-06-01", "2026-06-30");
    expect(staysOverlap(june, stay("2026-06-01", null, { datePrecision: "MONTH" }))).toBe(false);
    expect(staysOverlap(june, stay("2026-01-01", null, { datePrecision: "YEAR" }))).toBe(false);
    expect(staysOverlap(june, stay(null, null, { datePrecision: "NONE" }))).toBe(false);
    expect(staysOverlap(june, stay(null, null))).toBe(false);
  });

  it("two rooms for the same nights are flagged - the notice is a question, not a verdict", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-05"), stay("2026-07-01", "2026-07-05"))).toBe(
      true
    );
  });

  it("a reversed span names no days", () => {
    expect(exactDays(stay("2026-07-05", "2026-07-01"))).toBeNull();
  });
});

describe("staysCoincide / staysConflict - the duplicate case", () => {
  it("identical days coincide, including two identical single-day stays", () => {
    expect(staysCoincide(stay("2026-07-01", "2026-07-05"), stay("2026-07-01", "2026-07-05"))).toBe(
      true
    );
    const dayUse = stay("2026-07-01", "2026-07-01");
    expect(staysOverlap(dayUse, dayUse)).toBe(false);
    expect(staysConflict(dayUse, dayUse)).toBe(true);
  });

  it("different days do not coincide", () => {
    expect(staysCoincide(stay("2026-07-01", "2026-07-05"), stay("2026-07-01", "2026-07-06"))).toBe(
      false
    );
  });
});
