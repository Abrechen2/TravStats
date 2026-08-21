import { describe, it, expect, vi, beforeEach } from "vitest";
import { cruiseApi, portsApi, shipsApi } from "../cruise";
import { api } from "../client";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("cruiseApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list() fetches /cruises and unwraps envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [{ id: "c1" }] } });
    const result = await cruiseApi.list({ cruiseLine: "AIDA" });
    expect(api.get).toHaveBeenCalledWith("/cruises", { params: { cruiseLine: "AIDA" } });
    expect(result).toEqual([{ id: "c1" }]);
  });

  it("get() fetches /cruises/:id", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: { id: "c1" } } });
    const result = await cruiseApi.get("c1");
    expect(api.get).toHaveBeenCalledWith("/cruises/c1");
    expect(result).toEqual({ id: "c1" });
  });

  it("create() posts /cruises", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: "c1" } } });
    const result = await cruiseApi.create({ cruiseLine: "AIDA" });
    expect(api.post).toHaveBeenCalledWith("/cruises", { cruiseLine: "AIDA" });
    expect(result).toEqual({ id: "c1" });
  });

  it("update() patches /cruises/:id", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { success: true, data: { id: "c1" } } });
    await cruiseApi.update("c1", { notes: "n" });
    expect(api.patch).toHaveBeenCalledWith("/cruises/c1", { notes: "n" });
  });

  it("remove() deletes /cruises/:id", async () => {
    vi.mocked(api.delete).mockResolvedValue({});
    await cruiseApi.remove("c1");
    expect(api.delete).toHaveBeenCalledWith("/cruises/c1");
  });

  it("getGeometry() fetches /cruises/:id/geometry and unwraps envelope", async () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: [[1, 2] as [number, number]] },
          properties: {
            fromPortId: 1,
            toPortId: 2,
            routed: true,
          },
        },
      ],
    };
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: fc } });
    const result = await cruiseApi.getGeometry("c1");
    expect(api.get).toHaveBeenCalledWith("/cruises/c1/geometry");
    expect(result).toEqual(fc);
  });
});

describe("route override", () => {
  beforeEach(() => vi.clearAllMocks());

  const key = { fromKind: "port" as const, fromRef: "10", toKind: "port" as const, toRef: "11" };

  it("PUTs the waypoints for one leg", async () => {
    vi.mocked(api.put).mockResolvedValue({});
    const waypoints: Array<[number, number]> = [
      [9.99, 53.55],
      [-9.14, 38.72],
    ];
    await cruiseApi.saveRouteOverride("c1", key, waypoints);
    expect(api.put).toHaveBeenCalledWith("/cruises/c1/route-override", {
      fromKind: "port",
      fromRef: "10",
      toKind: "port",
      toRef: "11",
      waypoints: [
        [9.99, 53.55],
        [-9.14, 38.72],
      ],
    });
  });

  it("DELETEs with the key as query parameters, not a body", async () => {
    vi.mocked(api.delete).mockResolvedValue({});
    await cruiseApi.clearRouteOverride("c1", key);
    expect(api.delete).toHaveBeenCalledWith("/cruises/c1/route-override", {
      params: { fromKind: "port", fromRef: "10", toKind: "port", toRef: "11" },
    });
  });
});

describe("portsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("search() sends q as query param", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await portsApi.search("hamburg");
    expect(api.get).toHaveBeenCalledWith("/ports", { params: { q: "hamburg" } });
  });

  it("search() includes region filter when provided", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await portsApi.search("", "mediterranean");
    expect(api.get).toHaveBeenCalledWith("/ports", { params: { region: "mediterranean" } });
  });

  it("create() posts a new port", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: 99 } } });
    await portsApi.create({ name: "X", lat: 0, lon: 0 });
    expect(api.post).toHaveBeenCalledWith("/ports", { name: "X", lat: 0, lon: 0 });
  });
});

describe("shipsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("search() sends q as query param", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await shipsApi.search("aida");
    expect(api.get).toHaveBeenCalledWith("/ships", { params: { q: "aida" } });
  });

  it("create() posts a new ship", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: 99 } } });
    await shipsApi.create({ name: "MS X", cruiseLine: "TL" });
    expect(api.post).toHaveBeenCalledWith("/ships", { name: "MS X", cruiseLine: "TL" });
  });
});
