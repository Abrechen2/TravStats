import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/rail", () => ({
  railApi: { listAll: vi.fn(async () => []) },
}));
// The real gate: `useEnabledDomains` over the store.
vi.unmock("../../../../store/settingsStore");

import { railApi } from "../../../api/rail";
import { useDomainStats } from "../useDomainStats";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { Flight } from "../../../../types";

const NO_FLIGHTS: Flight[] = [];

/**
 * Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22): the user's domain choice
 * alone decides whether its rides are fetched, not the instance's beta switch.
 */
describe("useDomainStats — rail follows the domain choice", () => {
  beforeEach(() => vi.mocked(railApi.listAll).mockClear());

  it("does not load rail while the user has the domain off", async () => {
    useSettingsStore.setState({ enabledDomains: [], betaFeaturesEnabled: true });
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(railApi.listAll).not.toHaveBeenCalled();
    expect(result.current.stats.rail).toBeUndefined();
  });

  it("loads the completed rides with the beta switch off", async () => {
    useSettingsStore.setState({ enabledDomains: ["rail"], betaFeaturesEnabled: false });
    const { result } = renderHook(() => useDomainStats({ flights: NO_FLIGHTS }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(railApi.listAll).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(result.current.stats.rail).toEqual({ domain: "rail", hasData: false });
  });
});
