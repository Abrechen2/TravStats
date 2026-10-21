import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDashboardRail } from "../useDashboardRail";
import { useDashboardRentals } from "../../components/Dashboard/tabs/rentalMapOverlay";
const mocks = vi.hoisted(() => ({ rail: vi.fn(), rental: vi.fn() }));
vi.mock("../../lib/api/rail", () => ({ railApi: { list: mocks.rail } }));
vi.mock("../../lib/api/rental", () => ({ rentalApi: { list: mocks.rental } }));
beforeEach(() => {
  mocks.rail.mockReset();
  mocks.rental.mockReset();
});
describe("complete map pagination", () => {
  it("loads rail journeys beyond the old silent 5000-entry ceiling", async () => {
    mocks.rail.mockImplementation(async ({ offset, limit }) => ({
      total: 5501,
      journeys: Array.from({ length: Math.min(limit, 5501 - offset) }, (_, i) => ({
        id: `j${offset + i}`,
      })),
    }));
    const { result } = renderHook(() => useDashboardRail(true, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.journeys).toHaveLength(5501);
    expect(mocks.rail).toHaveBeenCalledTimes(12);
  });
  it("loads rentals beyond the old ceiling", async () => {
    mocks.rental.mockImplementation(async ({ offset, limit }) => ({
      total: 5501,
      rentals: Array.from({ length: Math.min(limit, 5501 - offset) }, (_, i) => ({
        id: `r${offset + i}`,
      })),
    }));
    const { result } = renderHook(() => useDashboardRentals(true, null));
    await waitFor(() => expect(result.current.rentals).toHaveLength(5501));
    expect(mocks.rental).toHaveBeenCalledTimes(12);
  });
  it("does not fetch disabled domains", () => {
    renderHook(() => useDashboardRail(false, null));
    renderHook(() => useDashboardRentals(false, null));
    expect(mocks.rail).not.toHaveBeenCalled();
    expect(mocks.rental).not.toHaveBeenCalled();
  });
});
