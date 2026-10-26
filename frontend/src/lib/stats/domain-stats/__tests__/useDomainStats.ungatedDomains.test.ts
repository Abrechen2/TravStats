import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/rental", () => ({ rentalApi: { listAll: vi.fn(async () => []) } }));
vi.mock("../../../api/bus", () => ({ busApi: { listAll: vi.fn(async () => []) } }));
vi.mock("../../../api/ferry", () => ({ ferryApi: { listAll: vi.fn(async () => []) } }));
// The real gate: `useEnabledDomains` over the store.
vi.unmock("../../../../store/settingsStore");

import { rentalApi } from "../../../api/rental";
import { busApi } from "../../../api/bus";
import { ferryApi } from "../../../api/ferry";
import { useDomainStats } from "../useDomainStats";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { Flight } from "../../../../types";

const LIST_ALL = {
  rental: () => rentalApi.listAll,
  bus: () => busApi.listAll,
  ferry: () => ferryApi.listAll,
} as const;

/**
 * Rental, bus and ferry left beta on 2026-10-26 (owner): the statistics
 * overview loads them whenever the user has the domain on, with the instance's
 * beta switch closed, and never for a user who switched the domain off — so no
 * card, chip or sum can carry a hidden ride.
 */
describe("useDomainStats — rental, bus and ferry out of beta", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["rental", "bus", "ferry"] as const)(
    "loads %s with the beta switch off once the user has the domain on",
    async (domain) => {
      useSettingsStore.setState({ enabledDomains: [domain], betaFeaturesEnabled: false });
      const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(LIST_ALL[domain]()).toHaveBeenCalled();
      expect(result.current.stats[domain]).toEqual({ domain, hasData: false });
    }
  );

  it.each(["rental", "bus", "ferry"] as const)(
    "does not load %s for a user who has the domain off",
    async (domain) => {
      useSettingsStore.setState({ enabledDomains: [], betaFeaturesEnabled: true });
      const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(LIST_ALL[domain]()).not.toHaveBeenCalled();
      expect(result.current.stats[domain]).toBeUndefined();
    }
  );
});
