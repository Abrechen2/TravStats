import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";

const getGeometryBatch = vi.fn();
vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { getGeometryBatch: (ids: string[]) => getGeometryBatch(ids) },
}));

const addToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));
vi.mock("../useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => `${key}:${opts?.count ?? ""}`,
  }),
}));

import { useCruiseGeometry } from "../useCruiseGeometry";

const fc = (id: string): CruiseRouteFeatureCollection =>
  ({ type: "FeatureCollection", features: [], id }) as unknown as CruiseRouteFeatureCollection;

const cruise = (id: string): Cruise => ({ id }) as unknown as Cruise;

describe("useCruiseGeometry", () => {
  beforeEach(() => {
    getGeometryBatch.mockReset();
    addToast.mockReset();
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

  it("leaves the map untouched when the batch fails, and says so", async () => {
    getGeometryBatch.mockRejectedValue(new Error("timeout of 10000ms exceeded"));
    const { result } = renderHook(() => useCruiseGeometry([cruise("a")]));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("warning", "map.geometryFailed:1"));
    expect(result.current.size).toBe(0);
  });

  // More than 100 cruises used to be ONE request the server answers with 400
  // (its cap), and every route became a straight line without a word.
  it("asks in batches of at most 100 and keeps the batches that worked", async () => {
    getGeometryBatch.mockImplementation(async (ids: string[]) => {
      if (ids.includes("c-150")) throw new Error("boom");
      return new Map(ids.map((id) => [id, fc(id)]));
    });
    const many = Array.from({ length: 150 }, (_, i) => cruise(`c-${i + 1}`));
    const { result } = renderHook(() => useCruiseGeometry(many));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("warning", "map.geometryFailed:50"));
    expect(getGeometryBatch).toHaveBeenCalledTimes(2);
    expect(getGeometryBatch.mock.calls.map(([ids]) => (ids as string[]).length)).toEqual([100, 50]);
    expect(result.current.size).toBe(100);
  });

  it("does not warn when every batch worked", async () => {
    getGeometryBatch.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, fc(id)]))
    );
    const { result } = renderHook(() => useCruiseGeometry([cruise("a")]));
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(addToast).not.toHaveBeenCalled();
  });
});
