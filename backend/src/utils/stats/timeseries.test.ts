import { describe, it, expect } from "@jest/globals";
import { resolveWindow } from "./timeseries";

const NOW = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15

describe("resolveWindow", () => {
  it("rolling12m spans the 12 months ending with the current month", () => {
    const w = resolveWindow("rolling12m", undefined, undefined, undefined, NOW);
    // 'to' is the exclusive start-of-next-month; 'from' is 12 months before it
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.from.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2024-08-01T00:00:00.000Z");
  });

  it("year window covers the calendar year and previous year", () => {
    const w = resolveWindow("year", 2024, undefined, undefined, NOW);
    expect(w.from.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("all window has no previous window", () => {
    const w = resolveWindow("all", undefined, undefined, undefined, NOW);
    expect(w.from.getTime()).toBe(0);
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });

  it("explicit fromDate/toDate override the window and have no previous", () => {
    const w = resolveWindow("rolling12m", undefined, "2023-03-01", "2023-06-01", NOW);
    expect(w.from.toISOString()).toBe("2023-03-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2023-06-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });
});
