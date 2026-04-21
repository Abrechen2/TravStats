import { describe, it, expect, beforeEach } from "vitest";
import { useDashboardFilterStore, intervalOverlapsRange } from "../dashboardFilterStore";

describe("dashboardFilterStore", () => {
  beforeEach(() => {
    useDashboardFilterStore.getState().reset();
  });

  it("time range is empty by default", () => {
    const { time } = useDashboardFilterStore.getState();
    expect(time.from).toBeNull();
    expect(time.to).toBeNull();
  });

  it("setTimeRange updates the shared time slice", () => {
    useDashboardFilterStore.getState().setTimeRange("2024-01-01", "2024-12-31");
    const { time } = useDashboardFilterStore.getState();
    expect(time.from).toBe("2024-01-01");
    expect(time.to).toBe("2024-12-31");
  });

  it("setFlightFilter updates only the flight slice", () => {
    useDashboardFilterStore.getState().setFlightFilter({ airline: "LH" });
    const { flight, cruise } = useDashboardFilterStore.getState();
    expect(flight.airline).toBe("LH");
    expect(cruise.cruiseLine).toBeUndefined();
  });

  it("setCruiseFilter updates only the cruise slice", () => {
    useDashboardFilterStore.getState().setCruiseFilter({ cruiseLine: "AIDA", status: "scheduled" });
    const { flight, cruise } = useDashboardFilterStore.getState();
    expect(cruise.cruiseLine).toBe("AIDA");
    expect(cruise.status).toBe("scheduled");
    expect(flight.airline).toBeUndefined();
  });
});

describe("intervalOverlapsRange", () => {
  it("true when cruise interval falls entirely inside filter range", () => {
    expect(intervalOverlapsRange("2024-06-01", "2024-06-14", "2024-01-01", "2024-12-31")).toBe(
      true
    );
  });
  it("true when cruise interval partially overlaps filter range (left)", () => {
    expect(intervalOverlapsRange("2023-12-20", "2024-01-10", "2024-01-01", "2024-12-31")).toBe(
      true
    );
  });
  it("true when cruise interval partially overlaps filter range (right)", () => {
    expect(intervalOverlapsRange("2024-12-20", "2025-01-10", "2024-01-01", "2024-12-31")).toBe(
      true
    );
  });
  it("false when cruise interval is entirely before filter range", () => {
    expect(intervalOverlapsRange("2023-01-01", "2023-12-31", "2024-01-01", "2024-12-31")).toBe(
      false
    );
  });
  it("false when cruise interval is entirely after filter range", () => {
    expect(intervalOverlapsRange("2025-01-01", "2025-12-31", "2024-01-01", "2024-12-31")).toBe(
      false
    );
  });
  it("null cruise endDate treated as open-ended (overlaps if start is in range)", () => {
    expect(intervalOverlapsRange("2024-06-01", null, "2024-01-01", "2024-12-31")).toBe(true);
  });
  it("filter range null (from or to) disables that bound", () => {
    expect(intervalOverlapsRange("2020-01-01", "2020-01-31", null, "2024-12-31")).toBe(true);
    expect(intervalOverlapsRange("2030-01-01", "2030-01-31", "2024-01-01", null)).toBe(true);
  });
});
