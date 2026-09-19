import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api", () => ({
  statsApi: {
    getCountryStats: vi.fn(async () => ({ countries: [], byYear: {} })),
    getCruiseStats: vi.fn(),
  },
}));
// Stable references, as the page passes: the effect keys on both arrays, so a
// fresh one per render re-fetches forever.
const ENABLED = ["flight"];
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ENABLED }),
}));

import { statsApi } from "../../../api";
import { useDomainStats } from "../useDomainStats";
import type { Flight } from "../../../../types";

const NO_FLIGHTS: Flight[] = [];

/**
 * The statistics page owns this hook from its first render, seconds before its
 * flights have loaded. Without the gate every domain was fetched against an
 * empty flight list and then again against the real one — and the period bar
 * picked its default year off the first, incomplete answer.
 */
describe("useDomainStats — ready gate", () => {
  beforeEach(() => {
    vi.mocked(statsApi.getCountryStats).mockClear();
  });

  it("fetches nothing and stays loading while not ready", async () => {
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS, ready: false }));

    // Give a would-be fetch every chance to have started.
    await new Promise((r) => setTimeout(r, 0));
    expect(statsApi.getCountryStats).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it("fetches once it becomes ready", async () => {
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useDomainStats({ flights: NO_FLIGHTS, ready }),
      { initialProps: { ready: false } }
    );
    rerender({ ready: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(statsApi.getCountryStats).toHaveBeenCalledTimes(1);
    expect(result.current.stats.flight).toBeDefined();
  });

  it("stays ready by default, for callers that already have their flights", async () => {
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(statsApi.getCountryStats).toHaveBeenCalledTimes(1);
  });
});
