/**
 * The flight tab's nine section requests are ONE request (forgejo#49).
 *
 * The assertion that matters is the count, and it is made against the HTTP
 * client rather than against `statsApi`: a hook that called
 * nine per-section getters would satisfy a mock of `getStatsPage` and still
 * issue nine requests. (Those getters have since been deleted — see the note in
 * `lib/api/stats.ts` — but the endpoints they called are all still served, so
 * the assertion is still about behaviour, not about what exists.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { FLIGHT_TAB_SECTIONS, useStatsPageSections } from "../useStatsPageSections";

const get = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
  },
}));

vi.mock("../../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const PAYLOAD = {
  fun: { co2FootprintKg: 42 },
  business: { costPerKm: 0.12 },
  unique: { equatorCrossings: 2 },
  airports: { uniqueAirports: 11 },
  seats: { windowCount: 5 },
  countries: { total: 7, countries: [] },
  airlines: { total: 9, airlines: [], flightsWithoutAirline: 1 },
  aircraft: { total: 2, aircraft: [] },
  punctuality: { sampleSize: 6 },
};

describe("useStatsPageSections", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: PAYLOAD });
  });

  it("issues ONE request for all nine sections, not nine", async () => {
    const { result } = renderHook(() => useStatsPageSections());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/stats/page", {
      params: { include: FLIGHT_TAB_SECTIONS.join(",") },
    });
  });

  it("asks for every section the flight tab draws", () => {
    // Nine, and named: a section quietly dropped from the list would render as
    // "still loading" forever rather than fail anything.
    expect([...FLIGHT_TAB_SECTIONS]).toEqual([
      "fun",
      "business",
      "unique",
      "airports",
      "seats",
      "countries",
      "airlines",
      "aircraft",
      "punctuality",
    ]);
  });

  it("hands every section through unchanged", async () => {
    const { result } = renderHook(() => useStatsPageSections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sections).toEqual(PAYLOAD);
    expect(result.current.error).toBeNull();
  });

  it("reports the failure once instead of leaving nine sections silently empty", async () => {
    get.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStatsPageSections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  // The first cut left the sections ABSENT on failure, which a card cannot tell
  // apart from a request still in flight — so nine cards read "loading" forever
  // and nothing on the page said why.
  it("hands every section `null` on failure, never absent", async () => {
    get.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStatsPageSections());
    await waitFor(() => expect(result.current.loading).toBe(false));

    for (const section of FLIGHT_TAB_SECTIONS) {
      expect(result.current.sections[section]).toBeNull();
    }
    // `null`, not `undefined`: the distinction IS the fix.
    expect(Object.keys(result.current.sections).sort()).toEqual([...FLIGHT_TAB_SECTIONS].sort());
  });

  it("retries the one request, and clears the error when the retry lands", async () => {
    get.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useStatsPageSections());
    await waitFor(() => expect(result.current.error).toBe("boom"));

    get.mockResolvedValue({ data: PAYLOAD });
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.sections).toEqual(PAYLOAD);
    // Two requests, not nine and not eighteen: one per attempt.
    expect(get).toHaveBeenCalledTimes(2);
  });
});
