import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../api/rentalLinks", () => ({
  rentalLinksApi: { stats: vi.fn(async () => ({})), list: vi.fn(async () => []) },
}));
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["rental"] }),
}));
vi.mock("../../../../hooks/useBusVisible", () => ({ useBusOffered: () => false }));
vi.mock("../../../../hooks/useRailVisible", () => ({ useRailOffered: () => false }));

import { rentalLinksApi } from "../../../api/rentalLinks";
import { useDomainStats } from "../useDomainStats";
import type { Flight } from "../../../../types";

/**
 * forgejo#262/#265 — rental days are not added on top of travel days. The
 * overview's cross-domain fold (events, active days, countries) is fed by
 * this hook only, and it never loads rentals even with the domain switched
 * on: the rental days stay in the rental tab, the trip's days in the trip.
 */
describe("useDomainStats — rentals stay out of the cross-domain fold", () => {
  it("loads no rental figures, so no rental day reaches an overview sum", async () => {
    const { result } = renderHook(() => useDomainStats({ flights: [] as Flight[] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toEqual({});
    expect(rentalLinksApi.stats).not.toHaveBeenCalled();
  });
});
