import { describe, expect, it, vi, beforeEach } from "vitest";

import { toursApi } from "../tours";
import { api } from "../client";

// The brief's mock targeted `apiClient`, but the shared axios instance
// `frontend/src/lib/api/client.ts` exports is named `api` (see the
// `catalogue.api.test.ts` mock for the same pattern) — corrected here.
vi.mock("../client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("toursApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists sections of one trip", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { routes: [{ id: "r1", name: "S" }] } });
    const routes = await toursApi.list("t1");
    expect(api.get).toHaveBeenCalledWith("/trips/t1/routes");
    expect(routes).toHaveLength(1);
  });

  it("creates a section", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { route: { id: "r1", name: "S" } } });
    const route = await toursApi.create("t1", { name: "S", mode: "road" });
    expect(api.post).toHaveBeenCalledWith("/trips/t1/routes", { name: "S", mode: "road" });
    expect(route).toEqual({ id: "r1", name: "S" });
  });

  it("updates a section, allowing null to clear color", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { route: { id: "r1" } } });
    await toursApi.update("t1", "r1", { color: null });
    expect(api.patch).toHaveBeenCalledWith("/trips/t1/routes/r1", { color: null });
  });

  it("removes a section", async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: undefined });
    await toursApi.remove("t1", "r1");
    expect(api.delete).toHaveBeenCalledWith("/trips/t1/routes/r1");
  });

  it("sends the full ordered id list when assigning stops", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { route: {}, stops: [], legs: [] } });
    await toursApi.assignStops("t1", "r1", ["a", "b"]);
    expect(api.put).toHaveBeenCalledWith("/trips/t1/routes/r1/stops", { stopIds: ["a", "b"] });
  });

  it("puts a leg override on the endpoint-pair path", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { leg: { id: "l1" } } });
    await toursApi.setLeg("t1", "r1", "a", "b", {
      source: "drawn",
      waypoints: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(api.put).toHaveBeenCalledWith("/trips/t1/routes/r1/legs/a/b", {
      source: "drawn",
      waypoints: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it("clears a leg override on the endpoint-pair path", async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: undefined });
    await toursApi.clearLeg("t1", "r1", "a", "b");
    expect(api.delete).toHaveBeenCalledWith("/trips/t1/routes/r1/legs/a/b");
  });

  it("fetches geometry as a FeatureCollection", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { type: "FeatureCollection", features: [] } });
    const geometry = await toursApi.geometry("t1", "r1");
    expect(api.get).toHaveBeenCalledWith("/trips/t1/routes/r1/geometry");
    expect(geometry).toEqual({ type: "FeatureCollection", features: [] });
  });
});
