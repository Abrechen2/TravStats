import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/rail", () => ({
  railApi: { list: vi.fn(async () => ({ journeys: [], total: 0 })) },
}));
const ENABLED = ["rail"];
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ENABLED }),
}));
const gate = { offered: false };
vi.mock("../../../../hooks/useRailVisible", () => ({
  useRailOffered: () => gate.offered,
}));

import { railApi } from "../../../api/rail";
import { useDomainStats } from "../useDomainStats";
import type { Flight } from "../../../../types";

const NO_FLIGHTS: Flight[] = [];

/**
 * Rail stays behind the `railDomain` beta gate after phase 2 (owner rule,
 * 2026-09-25). With the gate off its rides are not even fetched, so no card,
 * chip or sum on the overview can carry them.
 */
describe("useDomainStats — rail beta gate", () => {
  beforeEach(() => vi.mocked(railApi.list).mockClear());

  it("does not load rail while the gate is off", async () => {
    gate.offered = false;
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(railApi.list).not.toHaveBeenCalled();
    expect(result.current.stats.rail).toBeUndefined();
  });

  it("loads the completed rides once the gate is on", async () => {
    gate.offered = true;
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(railApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(result.current.stats.rail).toEqual({ domain: "rail", hasData: false });
  });
});
