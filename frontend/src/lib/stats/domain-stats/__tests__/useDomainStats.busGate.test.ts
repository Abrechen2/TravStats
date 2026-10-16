import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/bus", () => ({
  busApi: { listAll: vi.fn(async () => []) },
}));
// The real gate: `useEnabledDomains` over the store's beta flag.
vi.unmock("../../../../store/settingsStore");
const gate = {
  set offered(value: boolean) {
    useSettingsStore.setState({ enabledDomains: ["bus"], betaFeaturesEnabled: value });
  },
};

import { busApi } from "../../../api/bus";
import { useDomainStats } from "../useDomainStats";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { Flight } from "../../../../types";

/**
 * forgejo#265 — bus is fetched for the overview only behind its beta switch,
 * so with the switch off no card, chip or sum can carry a ride.
 */
describe("useDomainStats — bus beta gate", () => {
  beforeEach(() => vi.mocked(busApi.listAll).mockClear());

  it("does not load bus while the switch is off", async () => {
    gate.offered = false;
    const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(busApi.listAll).not.toHaveBeenCalled();
    expect(result.current.stats.bus).toBeUndefined();
  });

  it("loads the completed rides once the switch is on", async () => {
    gate.offered = true;
    const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(busApi.listAll).toHaveBeenCalledWith({ status: "completed" });
    expect(result.current.stats.bus).toEqual({ domain: "bus", hasData: false });
  });
});
