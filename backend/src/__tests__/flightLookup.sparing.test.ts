/**
 * Unit tests for the v0.24.4 API-sparing logic: live-window detection and the
 * in-memory daily Aviationstack budget counter.
 *
 * We don't exercise the full lookup pipeline here — that involves real HTTP
 * calls and is covered by integration tests. Instead we verify the two
 * decision points that guard Aviationstack consumption.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockAdminFindFirst = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    adminSettings: { findFirst: mockAdminFindFirst },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// We don't want the airport lookup / airlabs / axios pulled in just to test
// the pure helpers — mock them as empty.
jest.mock("../services/airportLookup", () => ({ findOrCreateAirport: jest.fn() }));
jest.mock("../services/apiKeyResolver", () => ({
  getApiKey: jest.fn(),
  getOpenSkyCredentials: jest.fn(),
}));
jest.mock("../utils/timezone", () => ({
  convertAviationstackTimeToUtc: jest.fn(),
  convertAirlabsTimeToUtc: jest.fn(),
}));
jest.mock("axios");
jest.mock("node-cache", () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  }));
});

import {
  isInLiveWindow,
  getAviationstackCallCountToday,
  __resetAviationstackBudgetForTests,
} from "../services/flightLookup";

// ─── isInLiveWindow ─────────────────────────────────────────────────────────

describe("isInLiveWindow", () => {
  const fixedNow = new Date("2026-04-14T18:00:00.000Z");

  it("returns false when departureTime is missing", () => {
    expect(isInLiveWindow(null, null, fixedNow)).toBe(false);
    expect(isInLiveWindow(undefined, undefined, fixedNow)).toBe(false);
  });

  it("returns true for a flight departing now", () => {
    expect(isInLiveWindow(fixedNow, null, fixedNow)).toBe(true);
  });

  it("returns true for a flight departing in 2h 30min (inside 3h window)", () => {
    const dep = new Date("2026-04-14T20:30:00.000Z");
    expect(isInLiveWindow(dep, null, fixedNow)).toBe(true);
  });

  it("returns false for a flight departing in 5h (outside 3h window)", () => {
    const dep = new Date("2026-04-14T23:00:00.000Z");
    expect(isInLiveWindow(dep, null, fixedNow)).toBe(false);
  });

  it("returns true for a flight that departed 1h ago (in-flight, no arrival given)", () => {
    const dep = new Date("2026-04-14T17:00:00.000Z");
    expect(isInLiveWindow(dep, null, fixedNow)).toBe(true);
  });

  it("returns true for in-flight with arrival in 3h (still en route)", () => {
    const dep = new Date("2026-04-14T14:00:00.000Z"); // 4h ago
    const arr = new Date("2026-04-14T21:00:00.000Z"); // 3h from now
    expect(isInLiveWindow(dep, arr, fixedNow)).toBe(true);
  });

  it("returns true within 2h after scheduled arrival (catch actual arrival/delay)", () => {
    const dep = new Date("2026-04-14T10:00:00.000Z");
    const arr = new Date("2026-04-14T17:00:00.000Z"); // 1h ago
    expect(isInLiveWindow(dep, arr, fixedNow)).toBe(true);
  });

  it("returns false more than 2h after arrival", () => {
    const dep = new Date("2026-04-14T08:00:00.000Z");
    const arr = new Date("2026-04-14T14:00:00.000Z"); // 4h ago — past 2h buffer
    expect(isInLiveWindow(dep, arr, fixedNow)).toBe(false);
  });

  it("returns false for garbage date strings", () => {
    expect(isInLiveWindow("not-a-date", null, fixedNow)).toBe(false);
  });

  it("accepts ISO date strings as well as Date objects", () => {
    expect(isInLiveWindow("2026-04-14T18:30:00.000Z", null, fixedNow)).toBe(true);
  });
});

// ─── Daily budget counter ───────────────────────────────────────────────────

describe("Aviationstack daily budget", () => {
  beforeEach(() => {
    __resetAviationstackBudgetForTests();
    mockAdminFindFirst.mockResolvedValue({ aviationstackDailyBudget: 3 });
  });

  it("starts at 0 calls for the current UTC day", () => {
    expect(getAviationstackCallCountToday()).toBe(0);
  });

  it("budget reset helper clears the counter", () => {
    __resetAviationstackBudgetForTests();
    expect(getAviationstackCallCountToday()).toBe(0);
  });
});
