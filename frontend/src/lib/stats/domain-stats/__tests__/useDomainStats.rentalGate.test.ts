import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/rental", () => ({
  rentalApi: { listAll: vi.fn(async () => []) },
}));
// The real gate: `useEnabledDomains` over the store's beta flag.
vi.unmock("../../../../store/settingsStore");
const gate = {
  set offered(value: boolean) {
    useSettingsStore.setState({ enabledDomains: ["rental"], betaFeaturesEnabled: value });
  },
};

import { rentalApi } from "../../../api/rental";
import { useDomainStats } from "../useDomainStats";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { Flight } from "../../../../types";

/**
 * Rentals reach the overview (board item rental-missing-from-stats-overview),
 * and only behind their beta switch, so with it off no card, chip or sum can
 * carry one.
 */
describe("useDomainStats — rental beta gate", () => {
  beforeEach(() => vi.mocked(rentalApi.listAll).mockClear());

  it("does not load rentals while the switch is off", async () => {
    gate.offered = false;
    const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rentalApi.listAll).not.toHaveBeenCalled();
    expect(result.current.stats.rental).toBeUndefined();
  });

  it("loads the returned rentals once the switch is on", async () => {
    gate.offered = true;
    const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rentalApi.listAll).toHaveBeenCalledWith({ status: "completed" });
    expect(result.current.stats.rental).toEqual({ domain: "rental", hasData: false });
  });
});
