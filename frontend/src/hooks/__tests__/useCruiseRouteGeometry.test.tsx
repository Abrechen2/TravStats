import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCruiseRouteGeometry } from "../useCruiseRouteGeometry";

const getGeometry = vi.fn();
vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { getGeometry: (id: string) => getGeometry(id) },
}));

// forgejo#385 (RULE-36): a failed read only logged, and the map drew straight
// chords as if they were the route.
describe("useCruiseRouteGeometry", () => {
  beforeEach(() => {
    getGeometry.mockReset();
  });

  it("reports failed when the route cannot be loaded", async () => {
    getGeometry.mockImplementation(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useCruiseRouteGeometry("c1"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.geometry).toBeNull();
  });

  it("does not report failed when the route loads", async () => {
    const fc = { type: "FeatureCollection", features: [] };
    getGeometry.mockResolvedValue(fc);
    const { result } = renderHook(() => useCruiseRouteGeometry("c1"));
    await waitFor(() => expect(result.current.geometry).toEqual(fc));
    expect(result.current.failed).toBe(false);
  });
});
