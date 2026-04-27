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

import {
  convertAviationstackTimeToUtc,
  legacyFakeUtcToRealUtc,
  normalizeFlightTimeUtc,
  tzAwareDurationMinutes,
} from "../utils/timezone";

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

describe("legacyFakeUtcToRealUtc — wall-clock-as-fake-UTC reinterpretation", () => {
  it("shifts a CEST wall-clock back by 2 hours to real UTC", () => {
    // Fake-UTC: 2026-05-01T10:30:00Z encodes "10:30 Berlin local" in summer.
    // CEST is UTC+2 → real instant is 2026-05-01T08:30:00Z.
    const stored = new Date("2026-05-01T10:30:00.000Z");
    const real = legacyFakeUtcToRealUtc(stored, "Europe/Berlin");
    expect(real.toISOString()).toBe("2026-05-01T08:30:00.000Z");
  });

  it("shifts a CET wall-clock back by 1 hour in winter", () => {
    // CET (UTC+1, January) → 1h offset, no DST.
    const stored = new Date("2026-01-15T09:00:00.000Z");
    const real = legacyFakeUtcToRealUtc(stored, "Europe/Berlin");
    expect(real.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("handles a far-east timezone correctly", () => {
    // JST is UTC+9, no DST. 14:00 Tokyo wall-clock → 05:00 UTC.
    const stored = new Date("2026-06-15T14:00:00.000Z");
    const real = legacyFakeUtcToRealUtc(stored, "Asia/Tokyo");
    expect(real.toISOString()).toBe("2026-06-15T05:00:00.000Z");
  });
});

describe("normalizeFlightTimeUtc — semantics-aware UTC resolution", () => {
  const stored = new Date("2026-05-01T10:30:00.000Z");

  it("returns the stored value unchanged for canonical UTC rows", () => {
    expect(normalizeFlightTimeUtc(stored, "UTC", "Europe/Berlin")?.toISOString()).toBe(
      stored.toISOString(),
    );
  });

  it("re-interprets LEGACY_FAKE_UTC rows via the airport tz", () => {
    expect(normalizeFlightTimeUtc(stored, "LEGACY_FAKE_UTC", "Europe/Berlin")?.toISOString()).toBe(
      "2026-05-01T08:30:00.000Z",
    );
  });

  it("returns null for LEGACY_FAKE_UTC when no tz is available", () => {
    expect(normalizeFlightTimeUtc(stored, "LEGACY_FAKE_UTC", null)).toBeNull();
  });

  it("leaves UNKNOWN rows alone (no automated tz shift, even with tz known)", () => {
    // UNKNOWN must not act as a synonym for LEGACY: real-UTC rows imported
    // by the API would be wrongly shifted in the post-deploy / pre-backfill
    // window. The backfill script is responsible for tagging rows correctly.
    expect(normalizeFlightTimeUtc(stored, "UNKNOWN", "Europe/Berlin")?.toISOString()).toBe(
      stored.toISOString(),
    );
    expect(normalizeFlightTimeUtc(stored, "UNKNOWN", null)?.toISOString()).toBe(
      stored.toISOString(),
    );
  });

  it("returns null when stored is null", () => {
    expect(normalizeFlightTimeUtc(null, "UTC", "Europe/Berlin")).toBeNull();
  });
});

describe("tzAwareDurationMinutes — semantics short-circuit", () => {
  it("uses naive diff for canonical UTC rows (no double conversion)", () => {
    // Both endpoints are real UTC instants — naive diff is exact.
    const dep = new Date("2026-05-01T08:30:00.000Z");
    const arr = new Date("2026-05-01T11:00:00.000Z");
    const minutes = tzAwareDurationMinutes(dep, arr, "Europe/Berlin", "Europe/Berlin", "UTC", "UTC");
    expect(minutes).toBe(150);
  });

  it("re-interprets LEGACY rows via airport tz to recover real elapsed time", () => {
    // 17:30 LAX (PDT, UTC-7) → 17:30 JFK (EDT, UTC-4) is a 2h flight in
    // wall-clock but actually lasts 5 hours in real time.
    const dep = new Date("2026-06-01T17:30:00.000Z"); // fake-UTC for LAX 17:30
    const arr = new Date("2026-06-01T22:30:00.000Z"); // fake-UTC for JFK 22:30
    const minutes = tzAwareDurationMinutes(
      dep,
      arr,
      "America/Los_Angeles",
      "America/New_York",
      "LEGACY_FAKE_UTC",
      "LEGACY_FAKE_UTC",
    );
    // LAX 17:30 PDT = 00:30 UTC next day; JFK 22:30 EDT = 02:30 UTC next day.
    // Real elapsed = 2h.
    expect(minutes).toBe(120);
  });
});
