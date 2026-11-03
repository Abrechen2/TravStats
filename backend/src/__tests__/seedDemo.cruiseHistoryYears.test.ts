import { CRUISE_TEMPLATES, historyYear } from "../seedDemo/coverageCruises";

describe("demo cruise history years are relative to the seed date", () => {
  const n = CRUISE_TEMPLATES.length;

  it("moves with the run's year instead of staying at 2017-2025", () => {
    const in2026 = historyYear(0, n, new Date("2026-11-03T00:00:00Z"));
    const in2030 = historyYear(0, n, new Date("2030-01-01T00:00:00Z"));
    expect(in2026).toBe(2017);
    expect(in2030).toBe(2021);
  });

  it("always ends before the run's own year, so no finished cruise can be in the future", () => {
    const now = new Date("2031-06-15T00:00:00Z");
    for (let i = 0; i < n; i += 1) {
      expect(historyYear(i, n, now)).toBeLessThan(2031);
      expect(historyYear(i, n, now)).toBeGreaterThanOrEqual(2022);
    }
  });
});
