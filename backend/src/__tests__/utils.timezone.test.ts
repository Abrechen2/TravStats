/**
 * Unit tests for the Aviationstack time-string parser. Focused on the format
 * coverage regression: the "YYYY-MM-DD HH:mm" variant (no seconds) was silently
 * failing before 0.24.2, returning null from `actual_departure` on the flight
 * record.
 *
 * We assert **that** the parser accepts/rejects formats correctly; we don't
 * assert the exact UTC result — that depends on the airport timezone lookup
 * which has its own dedicated unit tests.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockGetCachedAirport = jest.fn();
jest.mock("../services/airportCache", () => ({
  getCachedAirport: mockGetCachedAirport,
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { convertAviationstackTimeToUtc } from "../utils/timezone";

describe("convertAviationstackTimeToUtc — format acceptance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A known timezone for successful-parse cases. The tests don't pin the
    // exact UTC conversion result; they verify the format was accepted.
    mockGetCachedAirport.mockResolvedValue({ iata: "FRA", timezone: "Europe/Berlin" });
  });

  it("returns null for missing inputs", async () => {
    expect(await convertAviationstackTimeToUtc(null, "FRA")).toBeNull();
    expect(await convertAviationstackTimeToUtc("2026-04-14T10:00:00", null)).toBeNull();
  });

  it("accepts ISO-ish format with seconds and T separator", async () => {
    const result = await convertAviationstackTimeToUtc("2026-04-14T14:30:00", "FRA");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-04-14T\d{2}:30:00\.000Z$/);
  });

  it("accepts space-separator format with seconds", async () => {
    const result = await convertAviationstackTimeToUtc("2026-04-14 14:30:00", "FRA");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-04-14T\d{2}:30:00\.000Z$/);
  });

  it("accepts space-separator format WITHOUT seconds (the 2026-04-14 bug)", async () => {
    // Before the fix, this returned null and logged
    // "Failed to parse Aviationstack time string format", leading to
    // permanently-missing actual_departure on the flight record.
    const result = await convertAviationstackTimeToUtc("2026-04-14 14:35", "FRA");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-04-14T\d{2}:35:00\.000Z$/);
  });

  it("strips trailing Z before parsing", async () => {
    // Aviationstack occasionally appends a bogus Z even on local times.
    const result = await convertAviationstackTimeToUtc("2026-04-14T14:35:00Z", "FRA");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-04-14T\d{2}:35:00\.000Z$/);
  });

  it("rejects garbage input that matches no format", async () => {
    expect(await convertAviationstackTimeToUtc("14:35", "FRA")).toBeNull();
    expect(await convertAviationstackTimeToUtc("not-a-date", "FRA")).toBeNull();
  });

  it("falls back to parsing as UTC when airport has no timezone", async () => {
    // When airport timezone can't be resolved, we still try parsing as UTC so
    // we don't lose the data entirely. Just verify we get a non-null ISO result.
    mockGetCachedAirport.mockResolvedValue({ iata: "XYZ", timezone: null });
    const result = await convertAviationstackTimeToUtc("2026-04-14T14:35:00Z", "XYZ");
    expect(result).toMatch(/^2026-04-14T14:35:00\.000Z$/);
  });
});
