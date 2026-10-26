import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const gates = vi.hoisted(() => ({ rental: false, bus: false }));
const api = vi.hoisted(() => ({ rentalStats: vi.fn(), busStats: vi.fn() }));
vi.mock("../../../hooks/useDomainVisible", () => ({
  useDomainVisible: (key: string): boolean =>
    (
      (({ rental: () => gates.rental, bus: () => gates.bus }) as Record<string, () => boolean>)[
        key
      ] ?? (() => false)
    )(),
}));
vi.mock("../../api/rentalLinks", () => ({ rentalLinksApi: { stats: api.rentalStats } }));
vi.mock("../../api/bus", () => ({ busApi: { stats: api.busStats } }));
vi.mock("../../logger", () => ({ logger: { error: vi.fn() } }));

import { mergeYears, useRentalBusYears } from "../useRentalBusYears";

/**
 * forgejo#265 — a rental- or bus-only account gets years to pick on the
 * statistics page; a hidden domain is not even asked.
 */
describe("useRentalBusYears", () => {
  beforeEach(() => {
    gates.rental = false;
    gates.bus = false;
    api.rentalStats.mockReset();
    api.busStats.mockReset();
  });

  it("offers the years rentals and bus rides hold", async () => {
    gates.rental = true;
    gates.bus = true;
    api.rentalStats.mockResolvedValue({ byYear: [{ year: 2023 }, { year: 2025 }] });
    api.busStats.mockResolvedValue({ byYear: [{ year: 2024 }, { year: 2025 }] });
    const { result } = renderHook(() => useRentalBusYears());
    await waitFor(() => expect(result.current).toEqual([2023, 2024, 2025]));
  });

  it("does not ask a hidden domain, and survives a failed load", async () => {
    gates.bus = true;
    api.busStats.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useRentalBusYears());
    await waitFor(() => expect(api.busStats).toHaveBeenCalled());
    expect(api.rentalStats).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it("merges two year lists without duplicates", () => {
    expect(mergeYears([2022, 2024], [2023, 2024])).toEqual([2022, 2023, 2024]);
  });
});
