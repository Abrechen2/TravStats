import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";

const getGeometryBatch = vi.fn();
vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { getGeometryBatch: (ids: string[]) => getGeometryBatch(ids) },
}));

import { useCruiseGeometry } from "../useCruiseGeometry";

const fc = (id: string): CruiseRouteFeatureCollection =>
  ({ type: "FeatureCollection", features: [], id }) as unknown as CruiseRouteFeatureCollection;

const cruise = (id: string): Cruise => ({ id }) as unknown as Cruise;

describe("useCruiseGeometry", () => {
  beforeEach(() => {
    getGeometryBatch.mockReset();
  });

  it("does not call the API for an empty cruise list", () => {
    const { result } = renderHook(() => useCruiseGeometry([]));
    expect(result.current.size).toBe(0);
    expect(getGeometryBatch).not.toHaveBeenCalled();
  });

  it("fetches every cruise once and only asks for ids it does not hold yet", async () => {
    getGeometryBatch.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, fc(id)]))
    );
    const first = [cruise("a"), cruise("b")];
    const { result, rerender } = renderHook(({ cruises }) => useCruiseGeometry(cruises), {
      initialProps: { cruises: first },
    });

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(getGeometryBatch).toHaveBeenCalledTimes(1);
    expect(getGeometryBatch).toHaveBeenCalledWith(["a", "b"]);

    rerender({ cruises: [...first, cruise("c")] });
    await waitFor(() => expect(result.current.size).toBe(3));
    expect(getGeometryBatch).toHaveBeenCalledTimes(2);
    expect(getGeometryBatch).toHaveBeenLastCalledWith(["c"]);
    expect(result.current.get("a")).toEqual(fc("a"));
  });

  it("leaves the map untouched when the batch fails, so the chord fallback stays", async () => {
    getGeometryBatch.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCruiseGeometry([cruise("a")]));
    await waitFor(() => expect(getGeometryBatch).toHaveBeenCalledTimes(1));
    expect(result.current.size).toBe(0);
  });
});
