import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../client", () => ({ api: { get: getMock } }));

import { flightsApi } from "../flights";

interface PageCfg {
  params: { limit: number; offset: number };
}

// Serves `total` flights split into 500-flight pages, regardless of the
// request config — the offset is tracked internally so the mock is robust.
function pageServer(total: number): () => Promise<{ data: unknown }> {
  let offset = 0;
  return () => {
    const n = Math.max(0, Math.min(500, total - offset));
    const features = Array.from({ length: n }, (_, i) => ({ id: `f${offset + i}` }));
    offset += 500;
    return Promise.resolve({ data: { type: "FeatureCollection", features } });
  };
}

describe("flightsApi.getAllGeoJSON — paginates the whole collection", () => {
  beforeEach(() => getMock.mockReset());

  it("walks every 500-flight page until a short page and returns ALL features", async () => {
    getMock.mockImplementation(pageServer(1200)); // → 500, 500, 200 (short → stop)
    const res = await flightsApi.getAllGeoJSON();
    expect(res.features).toHaveLength(1200);
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it("does a single request when there are fewer than one page of flights", async () => {
    getMock.mockImplementation(pageServer(42));
    const res = await flightsApi.getAllGeoJSON();
    expect(res.features).toHaveLength(42);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("requests increasing offsets with a 500 page size", async () => {
    getMock.mockImplementation(pageServer(600)); // → 500, 100
    await flightsApi.getAllGeoJSON();
    const params = getMock.mock.calls.map((c) => (c[1] as PageCfg).params);
    expect(params.map((p) => p.offset)).toEqual([0, 500]);
    expect(params.every((p) => p.limit === 500)).toBe(true);
  });
});
