import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client", () => ({ api: { get: vi.fn() } }));

import { api } from "../client";
import { travTrackApi } from "../travtrack";

const get = vi.mocked(api.get);
const refused = (status: number, code: string) =>
  Object.assign(new Error("refused"), { response: { status, data: { code } } });

describe("travTrackApi.sharedRoutes", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("reads the routes through the reader's own copy", async () => {
    get.mockResolvedValue({ data: { routes: [{ version: 1, sharedBy: "A", geometry: [] }] } });
    await expect(travTrackApi.sharedRoutes("copy 1")).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith("/trips/copy%201/shared-route");
  });

  it("answers nobody sharing one with an empty list", async () => {
    get.mockRejectedValue(refused(404, "SHARED_ROUTE_NOT_FOUND"));
    await expect(travTrackApi.sharedRoutes("copy-1")).resolves.toEqual([]);
  });

  it("passes every other failure on", async () => {
    get.mockRejectedValue(refused(429, "RATE_LIMITED"));
    await expect(travTrackApi.sharedRoutes("copy-1")).rejects.toThrow("refused");
    get.mockRejectedValue(refused(404, "TRIP_NOT_FOUND"));
    await expect(travTrackApi.sharedRoutes("copy-1")).rejects.toThrow("refused");
  });
});
